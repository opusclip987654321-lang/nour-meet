import { describe, expect, it, vi } from "vitest";
import { MockSmsVerificationProvider, TwilioVerifyProvider } from "./sms-verification.js";

describe("vérification SMS", () => {
  it("utilise le code local uniquement avec le fournisseur simulé", async () => {
    const provider = new MockSmsVerificationProvider("123456");
    await expect(provider.checkCode("+33612345678", "123456")).resolves.toBe(true);
    await expect(provider.checkCode("+33612345678", "654321")).resolves.toBe(false);
  });

  it("demande à Twilio Verify d’envoyer un SMS", async () => {
    const http = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ status: "pending" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    const provider = new TwilioVerifyProvider({ accountSid: "AC_test", authToken: "secret", serviceSid: "VA_test" }, http as typeof fetch);

    await provider.sendCode("+33612345678");

    expect(http).toHaveBeenCalledOnce();
    const [url, options] = http.mock.calls[0]!;
    expect(url).toContain("/Services/VA_test/Verifications");
    expect((options!.body as URLSearchParams).get("To")).toBe("+33612345678");
    expect((options!.body as URLSearchParams).get("Channel")).toBe("sms");
    expect((options!.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("n’accepte que le statut Twilio approved", async () => {
    const approved = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ status: "approved" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new TwilioVerifyProvider({ accountSid: "AC_test", authToken: "secret", serviceSid: "VA_test" }, approved as typeof fetch);
    await expect(provider.checkCode("+33612345678", "123456")).resolves.toBe(true);
  });

  // Mise en production (cahier des charges consolidé 2026-09-20, §3) : Twilio répond en erreur si
  // le quota du compte est dépassé, s'il est temporairement indisponible, ou si le code fourni est
  // simplement faux — ces trois cas doivent rester distincts, jamais une simple exception générique.
  it("traduit un code faux en échec silencieux, jamais en erreur", async () => {
    const wrongCode = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ status: "denied", code: 60022 }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const provider = new TwilioVerifyProvider({ accountSid: "AC_test", authToken: "secret", serviceSid: "VA_test" }, wrongCode as typeof fetch);
    await expect(provider.checkCode("+33612345678", "000000")).resolves.toBe(false);
  });

  it("signale un dépassement de quota Twilio avec le code HTTP 429", async () => {
    const tooMany = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ message: "Too many requests" }), { status: 429, headers: { "Content-Type": "application/json" } }));
    const provider = new TwilioVerifyProvider({ accountSid: "AC_test", authToken: "secret", serviceSid: "VA_test" }, tooMany as typeof fetch);
    await expect(provider.sendCode("+33612345678")).rejects.toMatchObject({ statusCode: 429 });
  });

  it("signale une panne Twilio avec le code HTTP 503, jamais 500 brut", async () => {
    const down = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response("", { status: 502 }));
    const provider = new TwilioVerifyProvider({ accountSid: "AC_test", authToken: "secret", serviceSid: "VA_test" }, down as typeof fetch);
    await expect(provider.sendCode("+33612345678")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("refuse de démarrer en mode twilio sans les trois identifiants", async () => {
    const { createSmsVerificationProvider } = await import("./sms-verification.js");
    expect(() => createSmsVerificationProvider({ mode: "twilio", devCode: "123456", accountSid: "AC_test" })).toThrow("Configuration Twilio incomplète");
  });
});
