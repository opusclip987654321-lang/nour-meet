import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
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
