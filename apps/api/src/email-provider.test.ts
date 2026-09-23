import { describe, expect, it, vi } from "vitest";
import { createEmailProvider, MockEmailProvider, ResendEmailProvider } from "./email-provider.js";

describe("envoi d’e-mail", () => {
  it("ne fait rien en mode simulé", async () => {
    const provider = new MockEmailProvider();
    await expect(provider.send("client@example.com", "Sujet", "Corps")).resolves.toBeUndefined();
  });

  it("choisit le fournisseur simulé sans clé API configurée", () => {
    expect(createEmailProvider({}).mode).toBe("mock");
    expect(createEmailProvider({ apiKey: "re_test" }).mode).toBe("mock");
  });

  it("choisit Resend quand la clé et l’expéditeur sont configurés", () => {
    expect(createEmailProvider({ apiKey: "re_test", from: "notifications@nour-meet.fr" }).mode).toBe("resend");
  });

  it("affiche le nom de l’expéditeur devant l’adresse quand il est configuré", async () => {
    const http = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", http);
    try {
      await createEmailProvider({ apiKey: "re_test", from: "notifications@nour-meet.fr", fromName: "Nūr Meet" }).send("client@example.com", "Sujet", "Corps");
      expect(JSON.parse(http.mock.calls[0]![1]!.body as string).from).toBe("Nūr Meet <notifications@nour-meet.fr>");
      http.mockClear();
      await createEmailProvider({ apiKey: "re_test", from: "notifications@nour-meet.fr" }).send("client@example.com", "Sujet", "Corps");
      expect(JSON.parse(http.mock.calls[0]![1]!.body as string).from).toBe("notifications@nour-meet.fr");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("envoie une requête signée à l’API Resend", async () => {
    const http = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const provider = new ResendEmailProvider("re_test", "notifications@nour-meet.fr", http as typeof fetch);

    await provider.send("client@example.com", "Paiement confirmé", "Votre billet est prêt.");

    expect(http).toHaveBeenCalledOnce();
    const [url, options] = http.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((options!.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const payload = JSON.parse(options!.body as string);
    expect(payload).toMatchObject({ from: "notifications@nour-meet.fr", to: "client@example.com", subject: "Paiement confirmé" });
  });

  it("échoue si Resend refuse l’envoi", async () => {
    const http = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response("clé invalide", { status: 401 }));
    const provider = new ResendEmailProvider("re_bad", "notifications@nour-meet.fr", http as typeof fetch);
    await expect(provider.send("client@example.com", "Sujet", "Corps")).rejects.toThrow(/401/);
  });
});
