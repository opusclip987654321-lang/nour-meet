import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareArticleOnFacebook, shareEventOnFacebook } from "./services/facebook.js";

// Publication sur la Page Facebook (décision du 2026-09-25), contre une API Graph simulée : carrousel
// multi-photos pour un article, photo seule pour une soirée, jamais deux fois, jamais une soirée non éligible.
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "nour-fb-"));
  const uploadsDir = path.join(publicDir, "uploads", "articles");
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(path.join(publicDir, "uploads", "events"), { recursive: true });
  const cover = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#6b5a4a" } }).webp().toBuffer();
  await writeFile(path.join(uploadsDir, "cover.webp"), cover);
  await writeFile(path.join(publicDir, "uploads", "events", "e.webp"), cover);
  const config = { pageId: "123", pageToken: "tok", graphVersion: "v24.0", publicApiOrigin: "https://api.test", siteOrigin: "https://site.test", webOrigin: "https://site.test", uploadsDir, publicPrefix: "/static/uploads/articles/", publicDir };
  const calls: { url: string; body: URLSearchParams }[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    const id = String(++n);
    return new Response(JSON.stringify(url.endsWith("/feed") ? { id: "123_post" } : { id, post_id: "123_photo" }), { status: 200 });
  }));
  return { config, calls, uploadsDir };
}

function fakePrisma(row: Record<string, unknown>, model: "article" | "event") {
  const state = { ...row };
  const repo = {
    findUniqueOrThrow: async () => ({ ...state }),
    updateMany: async ({ where }: { where: { facebookPostId: null } }) => {
      if (state.facebookPostId || state.facebookPublishingAt) return { count: 0 };
      void where; state.facebookPublishingAt = new Date(); return { count: 1 };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state, data)
  };
  return { prisma: { [model]: repo } as never, state };
}

const article = { id: "a1", slug: "amis-apres-30-ans", status: "PUBLISHED", title: "Se faire des amis après 30 ans", excerpt: "Les cercles se défont ; voici comment en recréer.", category: "Amitié", imageUrl: "/static/uploads/articles/cover.webp", content: "## Oser la régularité\n\nRevoir les mêmes personnes crée la confiance.\n\n## Choisir des cadres\n\nUn atelier ou un club.", facebookPostId: null, facebookPublishingAt: null };

describe("publication Facebook", () => {
  it("article : photos non publiées puis une publication multi-photos avec le lien, une seule fois", async () => {
    const { config, calls, uploadsDir } = await setup();
    const { prisma, state } = fakePrisma(article, "article");
    expect(await shareArticleOnFacebook(prisma, config, "a1")).toBe("PUBLISHED");
    const photos = calls.filter(c => c.url.endsWith("/123/photos"));
    expect(photos.length).toBeGreaterThanOrEqual(4);
    expect(photos.every(c => c.body.get("published") === "false")).toBe(true);
    const feed = calls.find(c => c.url.endsWith("/123/feed"))!;
    expect(feed.body.get("message")).toContain("https://site.test/blog/amis-apres-30-ans");
    expect(JSON.parse(feed.body.get(`attached_media[${photos.length - 1}]`)!)).toEqual({ media_fbid: String(photos.length) });
    expect(state.facebookPostId).toBe("123_post");
    // Fichiers temporaires supprimés, seule l'illustration d'origine reste.
    expect(await readdir(uploadsDir)).toEqual(["cover.webp"]);
    expect(await shareArticleOnFacebook(prisma, config, "a1")).toBe("ALREADY_PUBLISHED");
  }, 60_000);

  it("soirée : une photo avec le lien de réservation ; jamais une démonstration ni une soirée passée", async () => {
    const { config, calls } = await setup();
    const base = { id: "e1", slug: "diner-networking", title: "Dîner networking", category: "Networking", district: "Paris 11e", status: "PUBLISHED", isDemo: false, controllerRestaurantId: "r1", startsAt: new Date(Date.now() + 5 * 86_400_000), imageUrl: "/static/uploads/events/e.webp", facebookPostId: null, facebookPublishingAt: null };
    expect(await shareEventOnFacebook(fakePrisma({ ...base, isDemo: true }, "event").prisma, config, "e1", "/static/defaults/x.jpg")).toBe("NOT_ELIGIBLE");
    expect(await shareEventOnFacebook(fakePrisma({ ...base, startsAt: new Date(Date.now() - 1000) }, "event").prisma, config, "e1", "/static/defaults/x.jpg")).toBe("NOT_ELIGIBLE");
    expect(await shareEventOnFacebook(fakePrisma({ ...base, status: "PENDING_REVIEW" }, "event").prisma, config, "e1", "/static/defaults/x.jpg")).toBe("NOT_ELIGIBLE");
    expect(calls).toHaveLength(0);
    const { prisma, state } = fakePrisma(base, "event");
    expect(await shareEventOnFacebook(prisma, config, "e1", "/static/defaults/x.jpg")).toBe("PUBLISHED");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.get("published")).toBe("true");
    expect(calls[0].body.get("caption")).toContain("https://site.test/events/diner-networking");
    expect(state.facebookPostId).toBe("123_photo");
  }, 60_000);
});
