import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMediaInsights, instagramToken, refreshInstagramToken } from "./services/instagram.js";

// Instagram via graph.facebook.com (décision du 2026-10-19) : clé permanente d'utilisateur système,
// jamais renouvelée ni lue en base ; les limites d'appels de Meta citent l'usage renvoyé en en-tête.
afterEach(() => vi.unstubAllGlobals());

const base = { userId: "1789", initialToken: "cle-permanente", graphVersion: "v24.0", publicApiOrigin: "https://api.test", webOrigin: "https://site.test", uploadsDir: "/tmp", publicPrefix: "/static/uploads/articles/", publicDir: "/tmp" };
const prisma = { socialCredential: { findUnique: vi.fn(async () => ({ accessToken: "ancien", refreshedAt: new Date(0) })), create: vi.fn(), upsert: vi.fn() } } as never;

describe("Instagram via l'API Facebook", () => {
  it("utilise la clé de l'environnement et ne la renouvelle jamais", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await instagramToken(prisma, { ...base, api: "facebook" })).toBe("cle-permanente");
    expect(await refreshInstagramToken(prisma, { ...base, api: "facebook" })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("appelle graph.facebook.com et joint l'usage en cas de limite", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ error: { message: "Application request limit reached", code: 4 } }), { status: 403, headers: { "x-app-usage": '{"call_count":100}' } });
    }));
    await expect(fetchMediaInsights(prisma, { ...base, api: "facebook" }, "m1")).rejects.toThrow(/limit reached \[x-app-usage=\{"call_count":100\}\]/);
    expect(urls.every(u => u.startsWith("https://graph.facebook.com/v24.0/m1/insights"))).toBe(true);
  });

  it("garde graph.instagram.com par défaut", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify({ data: [{ name: "reach", values: [{ value: 7 }] }] })); }));
    expect(await fetchMediaInsights(prisma, base, "m1")).toEqual({ reach: 7 });
    expect(urls[0].startsWith("https://graph.instagram.com/")).toBe(true);
  });
});
