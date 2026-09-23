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
  RESEND_FROM_EMAIL: z.string().email().optional(),
  // See the comment beside its only use in index.ts (perWorkerConnectionLimit) for why
  // this is a total budget across all cluster workers, not a per-worker value. Keep it
  // comfortably under Postgres's max_connections (default 100) to leave headroom for
  // migrations, psql, and any other service sharing the database.
  DATABASE_CONNECTION_LIMIT_TOTAL: z.coerce.number().default(40)
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
