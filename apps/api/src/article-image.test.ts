import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { saveIllustration } from "./services/article-image.js";

describe("déclinaisons de l'illustration IA (site et Instagram)", () => {
  it("produit un WebP 1600 px pour le site et un JPEG carré 1080 px pour Instagram", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nour-illu-"));
    const source = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#1c2653" } }).png().toBuffer();
    const saved = await saveIllustration(source, { uploadsDir: dir, publicPrefix: "/static/uploads/articles/" });
    expect(saved.imageUrl).toMatch(/^\/static\/uploads\/articles\/[0-9a-f-]+\.webp$/);
    expect(saved.instagramImageUrl).toBe(saved.imageUrl.replace(/\.webp$/, "-instagram.jpg"));
    const site = await sharp(await readFile(path.join(dir, path.basename(saved.imageUrl)))).metadata();
    const square = await sharp(await readFile(path.join(dir, path.basename(saved.instagramImageUrl)))).metadata();
    expect([site.format, site.width]).toEqual(["webp", 1536]);
    expect([square.format, square.width, square.height]).toEqual(["jpeg", 1080, 1080]);
  });
});

describe("essais successifs de l'illustration IA", () => {
  const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#f2a33a" } }).png().toBuffer();
  const silent = { warn: () => {} };

  it("réessaie jusqu'à l'approbation en transmettant les raisons du refus précédent", async () => {
    const { illustrateArticle } = await import("./services/article-image.js");
    const dir = await mkdtemp(path.join(tmpdir(), "nour-illu-"));
    const prompts: string[] = [];
    const image = (await png()).toString("base64");
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => { prompts.push(JSON.parse(init.body).prompt); return new Response(JSON.stringify({ data: [{ b64_json: image }] }), { status: 200 }); });
    let reviews = 0;
    const reviewer = { mode: "external", generateDraft: async () => ({ title: "", excerpt: "", content: "", keywords: [] }), generateSocialCopy: async () => [], reviewCoverImage: async () => (++reviews < 4 ? { approved: false, issues: [`défaut n°${reviews}`], altText: "" } : { approved: true, issues: [], altText: "Une terrasse" }) } as const;
    const result = await illustrateArticle({ apiKey: "k", model: "m", uploadsDir: dir, publicPrefix: "/p/" }, reviewer, { title: "Titre", imagePrompt: "A café" }, silent);
    vi.unstubAllGlobals();
    expect(result?.altText).toBe("Une terrasse");
    expect(prompts).toHaveLength(4);
    expect(prompts[0]).not.toContain("previous version");
    expect(prompts[3]).toContain("défaut n°3");
    expect(prompts.every(p => p.includes("no alcohol"))).toBe(true);
  });

  it("abandonne après 5 refus, laissant l'appelant utiliser la photothèque", async () => {
    const { MAX_ILLUSTRATION_ATTEMPTS, illustrateArticle } = await import("./services/article-image.js");
    const image = (await png()).toString("base64");
    let calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; return new Response(JSON.stringify({ data: [{ b64_json: image }] }), { status: 200 }); });
    const reviewer = { mode: "external", generateDraft: async () => ({ title: "", excerpt: "", content: "", keywords: [] }), generateSocialCopy: async () => [], reviewCoverImage: async () => ({ approved: false, issues: ["refus"], altText: "" }) } as const;
    const result = await illustrateArticle({ apiKey: "k", model: "m", uploadsDir: tmpdir(), publicPrefix: "/p/" }, reviewer, { title: "Titre", imagePrompt: "A café" }, silent);
    vi.unstubAllGlobals();
    expect(result).toBeNull();
    expect(MAX_ILLUSTRATION_ATTEMPTS).toBe(5);
    expect(calls).toBe(5);
  });
});
