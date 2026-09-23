import { describe, expect, it, vi, afterEach } from "vitest";

const REQUIRED = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db" };
const ORIGINAL_ENV = { ...process.env };

const loadEnv = async (overrides: Record<string, string | undefined>) => {
  process.env = { ...ORIGINAL_ENV, ...REQUIRED, ...overrides } as NodeJS.ProcessEnv;
  vi.resetModules();
  const mod = await import("./env.js");
  return mod.env;
};

describe("validation des variables d'environnement", () => {
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  // Régression : un déploiement Docker qui transmet `${RESEND_FROM_EMAIL:-}` sans valeur envoie
  // une chaîne vide, pas une variable absente — cela a fait planter le conteneur API au démarrage
  // dès que docker-compose.yml a commencé à transmettre cette variable (voir commit de mise en
  // production 2026-09). Une chaîne vide doit être traitée exactement comme une variable absente.
  it("accepte RESEND_FROM_EMAIL vide comme absent, ne plante jamais dessus", async () => {
    const env = await loadEnv({ RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", SENTRY_DSN: "" });
    expect(env.RESEND_FROM_EMAIL).toBeUndefined();
  });

  it("valide toujours un e-mail réellement invalide (non vide)", async () => {
    await expect(loadEnv({ RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "pas-un-email" })).rejects.toThrow();
  });

  it("accepte un e-mail valide", async () => {
    const env = await loadEnv({ RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "notifications@nour-meet.fr" });
    expect(env.RESEND_FROM_EMAIL).toBe("notifications@nour-meet.fr");
  });

  it("accepte un nom d’expéditeur avec accents et traite une valeur vide comme absente", async () => {
    expect((await loadEnv({ RESEND_FROM_NAME: "Nūr Meet" })).RESEND_FROM_NAME).toBe("Nūr Meet");
    expect((await loadEnv({ RESEND_FROM_NAME: "" })).RESEND_FROM_NAME).toBeUndefined();
  });

  it("refuse un nom d’expéditeur qui casserait l’en-tête From", async () => {
    await expect(loadEnv({ RESEND_FROM_NAME: "Nūr <Meet>" })).rejects.toThrow();
    await expect(loadEnv({ RESEND_FROM_NAME: "Nūr, Meet" })).rejects.toThrow();
  });

  it("refuse SMS_MODE=mock en production", async () => {
    await expect(loadEnv({ NODE_ENV: "production", SMS_MODE: "mock", JWT_SECRET: "a-real-production-secret-value", STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" })).rejects.toThrow();
  });
});
