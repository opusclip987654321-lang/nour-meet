import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import cluster from "node:cluster";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { z } from "zod";
import { createAIProvider } from "./ai-provider.js";
import { workerCount } from "./cluster-config.js";
import { createEmailProvider } from "./email-provider.js";
import { env } from "./env.js";
import { initSentry } from "./sentry.js";
import "./validation-fr.js";
import { createSmsVerificationProvider } from "./sms-verification.js";

initSentry();

export const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
export const uploadsDir = path.join(publicDir, "uploads", "events");
await mkdir(uploadsDir, { recursive: true });
export const restaurantUploadsDir = path.join(publicDir, "uploads", "restaurants");
await mkdir(restaurantUploadsDir, { recursive: true });
export const articleUploadsDir = path.join(publicDir, "uploads", "articles");
await mkdir(articleUploadsDir, { recursive: true });
export const profileUploadsDir = path.join(publicDir, "uploads", "profiles");
await mkdir(profileUploadsDir, { recursive: true });
// Supprime un ancien fichier uploadé lors d'un remplacement (photo de profil : une seule à la
// fois, contrairement aux galeries événement/restaurant) — jamais pour une URL externe ou déjà
// absente, jamais bloquant si le fichier a déjà disparu du disque.
export const deleteUploadedFile = async (url: string | null | undefined, prefix: string) => {
  if (!url?.startsWith(prefix)) return;
  await unlink(path.join(publicDir, url.replace("/static/", ""))).catch(() => {});
};
export const ALLOWED_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Prisma's own per-client default (num CPUs * 2 + 1) is sized for a single process.
// Under node:cluster, every worker opens its own pool of that size, and with enough
// workers the combined total can exceed Postgres's max_connections and lock everyone
// out. This is a budget for ALL workers combined, divided by worker count, so the
// total stays under it regardless of how many cores the host has.
function withConnectionLimit(databaseUrl: string, limit: number): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("connection_limit", String(limit));
  return url.toString();
}
const perWorkerConnectionLimit = Math.max(2, Math.floor(env.DATABASE_CONNECTION_LIMIT_TOTAL / workerCount));
export const prisma = new PrismaClient({ datasourceUrl: withConnectionLimit(env.DATABASE_URL, perWorkerConnectionLimit) });
// En production l'API n'est joignable que via Caddy (port publié sur 127.0.0.1 uniquement) : faire
// confiance à exactement un saut de proxy donne la vraie IP du client (dernière entrée de
// X-Forwarded-For, ajoutée par Caddy) sans permettre de l'usurper. Sans cela, request.ip vaut l'IP
// du conteneur Caddy pour tout le monde — et le rate-limit (OTP compris) devient partagé par tous.
export const app = Fastify({ logger: true, trustProxy: (_address: string, hop: number) => hop < 1 });
// Under node:cluster every worker runs this whole file independently (see
// cluster-entry.ts) — without this guard, each of the setInterval(...) background
// jobs below would fire once per worker every minute instead of once total.
export const ownsBackgroundJobs = !cluster.isWorker || cluster.worker?.id === 1;
// §21 (corrections web 2026-09-24) : version d'API figée par le SDK installé (mise à jour délibérée
// seulement, jamais implicite), délai de 20 s et 2 nouvelles tentatives réseau — le SDK pose des clés
// d'idempotence sur les écritures, une nouvelle tentative ne crée donc jamais un double paiement.
export const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { timeout: 20_000, maxNetworkRetries: 2, appInfo: { name: "nour-meet-api" } }) : null;

export const smsVerification = createSmsVerificationProvider({
  mode: env.SMS_MODE,
  devCode: env.DEV_OTP_CODE,
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN,
  serviceSid: env.TWILIO_VERIFY_SERVICE_SID
});
export const emailProvider = createEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, fromName: env.RESEND_FROM_NAME });
export const aiProvider = createAIProvider(env.ANTHROPIC_API_KEY);

export const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
// Un champ optionnel envoyé comme chaîne vide par un formulaire (nom non renseigné) doit être traité
// comme absent, pas comme une valeur invalide.
export const optionalName = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().min(2).max(80).optional());
