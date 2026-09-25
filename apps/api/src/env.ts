import { z } from "zod";

const optionalEnvironmentSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16).default("local-development-secret"),
  SMS_MODE: z.enum(["mock", "twilio"]).default("mock"),
  DEV_OTP_CODE: z.string().length(6).default("123456"),
  TWILIO_ACCOUNT_SID: optionalEnvironmentSecret,
  TWILIO_AUTH_TOKEN: optionalEnvironmentSecret,
  TWILIO_VERIFY_SERVICE_SID: optionalEnvironmentSecret,
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  STRIPE_SECRET_KEY: optionalEnvironmentSecret,
  STRIPE_WEBHOOK_SECRET: optionalEnvironmentSecret,
  RESEND_API_KEY: optionalEnvironmentSecret,
  // Une chaîne vide (ex. une variable Docker forwardée avec `${RESEND_FROM_EMAIL:-}` mais non
  // renseignée) doit être traitée comme absente, jamais comme un e-mail invalide à rejeter.
  RESEND_FROM_EMAIL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().email().optional()
  ),
  // Nom affiché à côté de l'adresse (« Nūr Meet <notifications@...> »). Séparé de l'adresse pour
  // que celle-ci reste validée strictement ; les caractères qui casseraient l'en-tête From sont refusés.
  RESEND_FROM_NAME: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().regex(/^[^<>",;\r\n]+$/, "RESEND_FROM_NAME ne doit contenir ni chevron, guillemet, virgule, point-virgule ni retour à la ligne").optional()
  ),
  // Surveillance d'erreurs (Sentry) : désactivée tant qu'aucun DSN n'est fourni, jamais activée
  // par défaut — voir sentry.ts pour le filtrage des données personnelles avant tout envoi.
  SENTRY_DSN: optionalEnvironmentSecret,
  // Génération des articles du blog par Claude (corrections web 2026-09-24, §3). Facultative : sans
  // clé, la publication quotidienne retombe sur la réserve d'articles déjà rédigés et le reste du
  // site fonctionne normalement. Clé serveur uniquement, jamais exposée au navigateur.
  ANTHROPIC_API_KEY: optionalEnvironmentSecret,
  // Connexion avec Google (identifiant client OAuth, public par nature). Sans valeur : bouton masqué.
  GOOGLE_CLIENT_ID: optionalEnvironmentSecret,
  // Illustrations générées par IA pour l'article du jour (OpenAI Images). Facultatif : sans clé, la
  // photothèque du site est utilisée. Modèle modifiable sans changer le code.
  OPENAI_API_KEY: optionalEnvironmentSecret,
  // Facultatif : jeton d'accès Expo, requis seulement si la « sécurité renforcée » des push est activée.
  EXPO_ACCESS_TOKEN: optionalEnvironmentSecret,
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  // Publication automatique sur Instagram (API Instagram avec connexion Instagram). Facultatif : sans
  // ces deux valeurs, rien n'est publié. Le jeton initial est ensuite renouvelé et conservé en base.
  INSTAGRAM_ACCESS_TOKEN: optionalEnvironmentSecret,
  INSTAGRAM_USER_ID: optionalEnvironmentSecret,
  INSTAGRAM_GRAPH_VERSION: z.string().default("v24.0"),
  // Adresse publique de l'API (ex. https://api.nourmeet.com) : Instagram télécharge l'image depuis cette
  // adresse, qui doit donc être joignable depuis Internet.
  API_PUBLIC_URL: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? undefined : v, z.string().url().optional()),
  // See the comment beside its only use in index.ts (perWorkerConnectionLimit) for why
  // this is a total budget across all cluster workers, not a per-worker value. Keep it
  // comfortably under Postgres's max_connections (default 100) to leave headroom for
  // migrations, psql, and any other service sharing the database.
  DATABASE_CONNECTION_LIMIT_TOTAL: z.coerce.number().default(40),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  RATE_LIMIT_WINDOW: z.string().default("1 minute")
}).superRefine((value, ctx) => {
  if (value.RESEND_API_KEY && !value.RESEND_FROM_EMAIL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_FROM_EMAIL"], message: "RESEND_FROM_EMAIL est requis avec RESEND_API_KEY" });
  }
  if (value.NODE_ENV === "production" && value.SMS_MODE === "mock") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SMS_MODE"], message: "SMS_MODE=mock est interdit en production" });
  }
  if (value.SMS_MODE === "twilio") {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"] as const) {
      if (!value[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} est requis avec SMS_MODE=twilio` });
    }
  }
  if (value.NODE_ENV === "production" && (!value.STRIPE_SECRET_KEY || !value.STRIPE_WEBHOOK_SECRET)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_SECRET_KEY"], message: "STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont requis en production" });
  }
  // La valeur par défaut est connue de quiconque lit ce fichier : un jeton signé avec elle en
  // production permettrait de forger un accès administrateur. Un vrai secret doit être fourni.
  if (value.NODE_ENV === "production" && value.JWT_SECRET === "local-development-secret") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_SECRET"], message: "JWT_SECRET doit être une vraie valeur secrète en production (la valeur par défaut est publique)" });
  }
});

export const env = envSchema.parse(process.env);
// WEB_ORIGIN peut lister plusieurs origines autorisées (CORS, séparées par des virgules) ; les liens
// construits vers le site (retours Stripe, partage, sitemap) utilisent toujours la première, la principale.
export const SITE_ORIGIN = env.WEB_ORIGIN.split(",")[0].trim().replace(/\/$/, "");
