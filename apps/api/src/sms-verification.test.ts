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
});
