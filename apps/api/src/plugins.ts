import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { MAX_IMAGE_BYTES, app, publicDir } from "./context.js";
import { env } from "./env.js";
import { Sentry } from "./sentry.js";

// méthodes explicitement listées : par défaut, ce plugin n'autorise que GET/HEAD/POST en CORS, ce qui
// bloquait silencieusement depuis un vrai navigateur tous les appels PATCH/PUT/DELETE (annulation de
// candidature côté navigateur, sortie de liste d'attente, mise à jour de profil, etc.) — invisible en
// curl, qui ne fait pas respecter le CORS.
await app.register(cors, { origin: env.WEB_ORIGIN === "*" ? true : env.WEB_ORIGIN.split(","), credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
// Préparation mise en production : en-têtes de sécurité de base (X-Content-Type-Options,
// X-Frame-Options, Referrer-Policy, HSTS une fois HTTPS en place...). Cette API ne sert jamais de
// HTML (uniquement du JSON et les images statiques d'/static/) : la CSP par défaut de helmet est
// désactivée pour éviter tout effet de bord sur des réponses qui n'en ont pas besoin, et la
// politique de ressources cross-origin est ouverte pour que le site web (autre sous-domaine en
// production) puisse continuer à afficher les images téléversées.
await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } });
await app.register(jwt, { secret: env.JWT_SECRET });
// Sane default so every route is protected against abuse even without an explicit
// per-route limit (below); routes that need a stricter one keep their own override.
// Tunable via env because the right ceiling depends on deployment shape (behind a
// CDN/LB, per-IP traffic looks different than hitting the origin directly).
await app.register(rateLimit, { global: true, max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW });
await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
await app.register(fastifyStatic, { root: publicDir, prefix: "/static/" });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "Données invalides", details: error.flatten() });
  // Un findUniqueOrThrow/findFirstOrThrow qui échoue (ex. assertEventAccess sur l'événement d'un
  // autre restaurateur) lève une erreur Prisma "P2025" sans statusCode : sans ce cas, elle finissait
  // en 500 « Erreur interne », masquant une simple restriction d'accès légitime derrière une fausse
  // panne serveur. 404 (sans confirmer si la ressource existe pour quelqu'un d'autre) est la réponse
  // correcte, jamais journalisée comme une erreur serveur.
  if ((error as { code?: string }).code === "P2025") return reply.code(404).send({ error: "Ressource introuvable" });
  const status = (error as any).statusCode ?? 500;
  // Refus du fournisseur SMS : toujours journalisé avec le code Twilio (jamais le numéro ni les
  // identifiants), y compris en 4xx — sans cela, une erreur de configuration restait invisible.
  const provider = error as { providerStatus?: number; providerCode?: number; providerMessage?: string };
  if (provider.providerStatus) app.log.warn({ providerStatus: provider.providerStatus, providerCode: provider.providerCode, providerMessage: provider.providerMessage }, "refus du fournisseur SMS");
  if (status >= 500) {
    app.log.error(error);
    // Seules les vraies pannes serveur (5xx) partent vers Sentry — jamais une simple erreur de
    // saisie ou d'autorisation (400/401/403/404/409), qui ne relève pas d'une surveillance de panne.
    if (env.SENTRY_DSN) Sentry.captureException(error);
  }
  return reply.code(status).send({ error: status >= 500 ? "Erreur interne" : (error as Error).message });
});
