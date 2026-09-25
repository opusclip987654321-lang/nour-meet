import { randomUUID } from "node:crypto";
import { z } from "zod";
import { app, prisma, smsVerification } from "../context.js";
import { env } from "../env.js";
import { normalizePhoneNumber } from "../phone.js";
import { audit } from "../services/audit.js";
import { auth, currentId } from "../services/auth.js";
import { checkEmailLoginCode, normalizeEmail, sendEmailLoginCode, verifyGoogleCredential } from "../services/login.js";
import { PKCE_CHALLENGE, PKCE_VERIFIER, hashHandoffCode, isAllowedAppRedirect, pkceChallenge } from "../services/app-redirect.js";
import { loginResponse } from "../services/session.js";

// Limites en mode simulé (SMS_MODE=mock, interdit en production) : assez hautes pour enchaîner les
// suites de tests d'intégration et e2e sur une même API sans faux échec « Trop de tentatives ».
app.post("/auth/request-otp", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 3, timeWindow: "10 minutes" } } }, async (request) => {
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

app.post("/auth/verify-otp", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const input = z.object({ phone: z.string().min(8).max(30), code: z.string().regex(/^\d{6}$/), displayName: z.string().min(2).optional() }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  if (!await smsVerification.checkCode(phone, input.code)) return reply.code(401).send({ error: "Code incorrect ou expiré" });
  let user = await prisma.user.findUnique({ where: { phone } });
  // isNewUser sert au front à proposer, une seule fois, le choix « participant ou restaurateur »
  // juste après la création du compte — jamais recalculé ni stocké, seulement vrai sur cet appel-ci.
  let isNewUser = false;
  if (!user) { user = await prisma.user.create({ data: { phone, phoneVerifiedAt: new Date(), displayName: input.displayName ?? "Nouveau membre", profile: { create: { interests: [] } } } }); isNewUser = true; }
  else if (!user.phoneVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  return loginResponse(user.id, isNewUser);
});

// Connexion par e-mail (2026-09-24) : code à usage unique de 6 chiffres, valable 10 minutes. Quasi
// gratuit (Resend), contrairement au SMS. Crée le compte à la première connexion.
// Compte existant pour une adresse dont la personne vient de prouver qu'elle la possède (code reçu
// ou Google). Une adresse seulement SAISIE dans un profil (jamais vérifiée) ne rattache jamais la
// connexion à ce compte : sinon n'importe qui pourrait inscrire l'adresse d'un autre dans son propre
// profil et récupérer ensuite sa connexion. L'adresse est alors retirée de ce compte, et la personne
// qui l'a réellement prouvée obtient son propre compte.
const verifiedAccountFor = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (user.emailVerifiedAt) return user;
  await prisma.user.update({ where: { id: user.id }, data: { email: null } });
  await audit(user.id, "DETACH_UNVERIFIED_EMAIL", "User", user.id);
  return null;
};

app.post("/auth/email/request-code", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 5, timeWindow: "10 minutes" } } }, async (request) => {
  const { email } = z.object({ email: z.string().email().max(200) }).parse(request.body);
  const result = await sendEmailLoginCode(email);
  return { sent: true, expiresInSeconds: 600, ...(result.devCode ? { devCode: result.devCode } : {}) };
});
app.post("/auth/email/verify", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const input = z.object({ email: z.string().email().max(200), code: z.string().regex(/^\d{6}$/), displayName: z.string().min(2).max(80).optional() }).parse(request.body);
  if (!await checkEmailLoginCode(input.email, input.code)) return reply.code(401).send({ error: "Code incorrect ou expiré" });
  const email = normalizeEmail(input.email);
  let user = await verifiedAccountFor(email);
  let isNewUser = false;
  if (!user) { user = await prisma.user.create({ data: { email, emailVerifiedAt: new Date(), displayName: input.displayName ?? "Nouveau membre", profile: { create: { interests: [] } } } }); isNewUser = true; }
  await audit(user.id, "LOGIN_EMAIL", "User", user.id);
  return loginResponse(user.id, isNewUser);
});

// Connexion avec Google (2026-09-24). Un compte Nūr Meet existant avec la même adresse e-mail
// (vérifiée par Google) est relié automatiquement plutôt que dupliqué.
app.post("/auth/google", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 20, timeWindow: "10 minutes" } } }, async (request) => {
  const { credential } = z.object({ credential: z.string().min(20).max(5000) }).parse(request.body);
  const google = await verifyGoogleCredential(credential);
  const identity = await prisma.authIdentity.findUnique({ where: { provider_subject: { provider: "google", subject: google.subject } } });
  let userId = identity?.userId;
  let isNewUser = false;
  if (!userId) {
    const existing = google.email && google.emailVerified ? await verifiedAccountFor(google.email) : null;
    if (existing) userId = existing.id;
    else {
      const created = await prisma.user.create({ data: { email: google.email && google.emailVerified ? google.email : null, emailVerifiedAt: google.emailVerified ? new Date() : null, displayName: google.name?.slice(0, 80) || "Nouveau membre", profile: { create: { interests: [] } } } });
      userId = created.id; isNewUser = true;
    }
    await prisma.authIdentity.create({ data: { userId, provider: "google", subject: google.subject, email: google.email } });
  }
  await audit(userId, "LOGIN_GOOGLE", "User", userId);
  return loginResponse(userId, isNewUser);
});

// Vérification du numéro, une seule fois (2026-09-24) : seul SMS encore envoyé, avant la première
// inscription à une soirée. Un numéro ne peut appartenir qu'à un seul compte.
app.post("/me/phone/request-code", { preHandler: auth, config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 3, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const phone = normalizePhoneNumber(z.object({ phone: z.string().min(8).max(30) }).parse(request.body).phone);
  const owner = await prisma.user.findUnique({ where: { phone } });
  if (owner && owner.id !== currentId(request)) return reply.code(409).send({ error: "Ce numéro est déjà utilisé par un autre compte. Connectez-vous avec ce numéro, ou écrivez-nous à contact@nourmeet.com." });
  await smsVerification.sendCode(phone);
  return { sent: true, expiresInSeconds: 600, ...(smsVerification.mode === "mock" ? { devCode: env.DEV_OTP_CODE } : {}) };
});
app.post("/me/phone/verify", { preHandler: auth, config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const input = z.object({ phone: z.string().min(8).max(30), code: z.string().regex(/^\d{6}$/) }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  if (!await smsVerification.checkCode(phone, input.code)) return reply.code(401).send({ error: "Code incorrect ou expiré" });
  try {
    await prisma.user.update({ where: { id: currentId(request) }, data: { phone, phoneVerifiedAt: new Date() } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return reply.code(409).send({ error: "Ce numéro est déjà utilisé par un autre compte." });
    throw err;
  }
  await audit(currentId(request), "VERIFY_PHONE", "User", currentId(request));
  return { verified: true, phone };
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
  // Usage unique garanti par une seule écriture conditionnelle : deux échanges simultanés du même
  // jeton ne peuvent jamais obtenir chacun une session.
  const now = new Date();
  const claimed = await prisma.paymentSession.updateMany({ where: { token, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (claimed.count === 0) return reply.code(401).send({ error: "Session de paiement invalide ou expirée" });
  const session = await prisma.paymentSession.findUniqueOrThrow({ where: { token } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const jwt = app.jwt.sign({ sub: user.id, role: user.role, scope: "payment", app: session.applicationId }, { expiresIn: "15m" });
  return { token: jwt, applicationId: session.applicationId };
});

// Connexion Google de l'application mobile (2026-09-24), voir services/app-redirect.ts.
app.post("/auth/mobile-handoff", { preHandler: auth, config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const { redirect, isNewUser, challenge } = z.object({ redirect: z.string().max(300), isNewUser: z.boolean().default(false), challenge: z.string().regex(PKCE_CHALLENGE) }).parse(request.body);
  if (!isAllowedAppRedirect(redirect, env.NODE_ENV === "production")) return reply.code(400).send({ error: "Retour vers l’application non autorisé." });
  const code = randomUUID().replace(/-/g, "");
  await prisma.loginHandoff.create({ data: { codeHash: hashHandoffCode(code), challenge, userId: currentId(request), isNewUser, expiresAt: new Date(Date.now() + 2 * 60_000) } });
  return { redirectUrl: `${redirect}${redirect.includes("?") ? "&" : "?"}code=${code}` };
});
app.post("/auth/mobile-handoff/exchange", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 1000 : 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const { code, verifier } = z.object({ code: z.string().regex(/^[0-9a-f]{32}$/), verifier: z.string().regex(PKCE_VERIFIER) }).parse(request.body);
  const found = await prisma.loginHandoff.findUnique({ where: { codeHash: hashHandoffCode(code) } });
  const handoff = found && found.challenge === pkceChallenge(verifier) ? found : null;
  // Consommation atomique : un code ne sert qu'une fois, même en cas de double appel simultané.
  const claimed = handoff && handoff.expiresAt > new Date() && (await prisma.loginHandoff.updateMany({ where: { id: handoff.id, usedAt: null }, data: { usedAt: new Date() } })).count === 1;
  if (!handoff || !claimed) return reply.code(401).send({ error: "Connexion expirée. Réessayez depuis l’application." });
  return loginResponse(handoff.userId, handoff.isNewUser);
});
