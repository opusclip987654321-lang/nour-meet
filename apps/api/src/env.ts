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
  STRIPE_WEBHOOK_SECRET: optionalEnvironmentSecret
}).superRefine((value, ctx) => {
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
});

export const env = envSchema.parse(process.env);
