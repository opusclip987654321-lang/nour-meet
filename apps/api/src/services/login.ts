import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { emailProvider, httpError, prisma } from "../context.js";
import { env } from "../env.js";

// Connexion sans SMS (2026-09-24) : code à usage unique envoyé par e-mail, ou compte Google.

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const EMAIL_CODE_TTL_MS = 10 * 60_000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODES_PER_HOUR = 5;
// Empreinte salée avec le secret du serveur : un accès en lecture à la base ne révèle aucun code.
const hashCode = (email: string, code: string) => createHash("sha256").update(`${env.JWT_SECRET}:${email}:${code}`).digest("hex");

export async function sendEmailLoginCode(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const recent = await prisma.emailLoginCode.count({ where: { email, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } } });
  if (recent >= EMAIL_CODES_PER_HOUR) throw httpError(429, "Trop de codes demandés pour cette adresse. Réessayez dans une heure.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.emailLoginCode.create({ data: { email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS) } });
  const body = `Votre code de connexion Nūr Meet est : ${code}\n\nIl est valable 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : personne ne peut se connecter sans ce code.`;
  if (emailProvider.mode === "resend") await emailProvider.send(email, `${code} — votre code de connexion Nūr Meet`, body);
  else await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: email, subject: "Code de connexion", body } });
  // Hors production et sans fournisseur réel : le code est renvoyé pour tester, comme le code SMS simulé.
  return { email, devCode: emailProvider.mode === "mock" && env.NODE_ENV !== "production" ? code : undefined };
}

export async function checkEmailLoginCode(rawEmail: string, code: string) {
  const email = normalizeEmail(rawEmail);
  const entry = await prisma.emailLoginCode.findFirst({ where: { email, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!entry || entry.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return false;
  const expected = Buffer.from(entry.codeHash, "hex"), given = Buffer.from(hashCode(email, code), "hex");
  if (!timingSafeEqual(expected, given)) { await prisma.emailLoginCode.update({ where: { id: entry.id }, data: { attempts: { increment: 1 } } }); return false; }
  // Consommation atomique : deux vérifications simultanées du même code n'ouvrent jamais deux sessions.
  return (await prisma.emailLoginCode.updateMany({ where: { id: entry.id, usedAt: null }, data: { usedAt: new Date() } })).count === 1;
}

// Jeton d'identité Google (Google Identity Services) vérifié localement : signature par les clés
// publiques de Google, émetteur, destinataire (notre identifiant client) et expiration.
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 10_000 });
export async function verifyGoogleCredential(credential: string) {
  if (!env.GOOGLE_CLIENT_ID) throw httpError(503, "La connexion avec Google n’est pas configurée sur ce serveur.");
  try {
    const { payload } = await jwtVerify(credential, googleKeys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: env.GOOGLE_CLIENT_ID });
    if (!payload.sub) throw new Error("sub manquant");
    return { subject: payload.sub, email: typeof payload.email === "string" ? normalizeEmail(payload.email) : null, emailVerified: payload.email_verified === true, name: typeof payload.given_name === "string" ? payload.given_name : typeof payload.name === "string" ? payload.name : null };
  } catch {
    throw httpError(401, "Connexion Google refusée ou expirée. Réessayez.");
  }
}
