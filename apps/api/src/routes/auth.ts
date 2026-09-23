import { randomUUID } from "node:crypto";
import { z } from "zod";
import { app, prisma, smsVerification } from "../context.js";
import { env } from "../env.js";
import { normalizePhoneNumber } from "../phone.js";
import { auth, currentId } from "../services/auth.js";

app.post("/auth/request-otp", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 100 : 3, timeWindow: "10 minutes" } } }, async (request) => {
  const input = z.object({ phone: z.string().min(8).max(30) }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  await smsVerification.sendCode(phone);
  if (smsVerification.mode === "mock") {
    await prisma.outboxMessage.create({ data: { channel: "SMS", recipient: phone, body: `Votre code Nūr Meet est ${env.DEV_OTP_CODE}` } });
  }
  return {
    sent: true,
    delivery: smsVerification.mode === "mock" ? "mock" : "sms",
    ...(smsVerification.mode === "mock" ? { devCode: env.DEV_OTP_CODE } : {}),
    expiresInSeconds: 600
  };
});

app.post("/auth/verify-otp", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 100 : 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const input = z.object({ phone: z.string().min(8).max(30), code: z.string().regex(/^\d{6}$/), displayName: z.string().min(2).optional() }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  if (!await smsVerification.checkCode(phone, input.code)) return reply.code(401).send({ error: "Code incorrect ou expiré" });
  let user = await prisma.user.findUnique({ where: { phone }, include: { profile: true } });
  // isNewUser sert au front à proposer, une seule fois, le choix « participant ou restaurateur »
  // juste après la création du compte — jamais recalculé ni stocké, seulement vrai sur cet appel-ci.
  let isNewUser = false;
  if (!user) { user = await prisma.user.create({ data: { phone, displayName: input.displayName ?? "Nouveau membre", profile: { create: { interests: [] } } }, include: { profile: true } }); isNewUser = true; }
  if (user.suspendedAt) return reply.code(403).send({ error: "Compte suspendu" });
  if (user.deletedAt) return reply.code(403).send({ error: "Compte supprimé" });
  const token = app.jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, { expiresIn: "30d" });
  return { token, isNewUser, user: { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, profileCompleted: user.profile?.profileCompleted ?? false } };
});
// Section 9.2 : le mobile crée ce jeton opaque (jamais son vrai jeton de session) avant d'ouvrir le
// navigateur intégré vers /pay/:applicationId ; à usage unique, expire en quelques minutes.
app.post("/me/payment-sessions", { preHandler: auth }, async (request, reply) => {
  const { applicationId } = z.object({ applicationId: z.string() }).parse(request.body);
  const userId = currentId(request);
  const application = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!application) return reply.code(404).send({ error: "Candidature introuvable" });
  const session = await prisma.paymentSession.create({ data: { token: randomUUID(), userId, applicationId, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return { token: session.token };
});
// Échange à usage unique : ce jeton opaque devient un vrai jeton de session, mais éphémère (15 min)
// — jamais les 30 jours habituels — puisqu'il ne sert qu'à finaliser un paiement déjà en cours.
app.post("/auth/payment-session-exchange", async (request, reply) => {
  const { token } = z.object({ token: z.string() }).parse(request.body);
  const session = await prisma.paymentSession.findUnique({ where: { token } });
  if (!session || session.usedAt || session.expiresAt < new Date()) return reply.code(401).send({ error: "Session de paiement invalide ou expirée" });
  await prisma.paymentSession.update({ where: { id: session.id }, data: { usedAt: new Date() } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const jwt = app.jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, { expiresIn: "15m" });
  return { token: jwt, applicationId: session.applicationId };
});
