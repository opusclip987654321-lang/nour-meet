import type { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Publication Instagram de l'article du jour (corrections du 2026-09-24), via l'API Instagram avec
// connexion Instagram (compte professionnel). Une seule publication par article (instagramMediaId),
// délais bornés, et aucune erreur ne remonte au blog : l'article reste en ligne, l'échec est tracé.

export type InstagramConfig = { userId: string; initialToken: string; graphVersion: string; publicApiOrigin: string; webOrigin: string; uploadsDir: string; publicPrefix: string };
const PROVIDER = "instagram";
const TOKEN_REFRESH_AFTER_MS = 7 * 24 * 60 * 60_000;

const graph = (config: InstagramConfig, pathAndQuery: string) => `https://graph.instagram.com/${config.graphVersion}/${pathAndQuery}`;
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: number } };
  if (!response.ok || data.error) throw new Error(`Instagram (${response.status}) : ${data.error?.message ?? "réponse invalide"}`);
  return data;
}

// Jeton courant : celui conservé en base (renouvelé), sinon le jeton initial de l'environnement.
export async function instagramToken(prisma: PrismaClient, config: InstagramConfig) {
  const stored = await prisma.socialCredential.findUnique({ where: { provider: PROVIDER } });
  if (stored) return stored.accessToken;
  await prisma.socialCredential.create({ data: { provider: PROVIDER, accessToken: config.initialToken } }).catch(() => null);
  return config.initialToken;
}

// Les jetons Instagram expirent au bout de 60 jours : renouvellement hebdomadaire, bien avant l'échéance.
export async function refreshInstagramToken(prisma: PrismaClient, config: InstagramConfig) {
  const stored = await prisma.socialCredential.findUnique({ where: { provider: PROVIDER } });
  if (stored && Date.now() - stored.refreshedAt.getTime() < TOKEN_REFRESH_AFTER_MS) return false;
  const current = stored?.accessToken ?? config.initialToken;
  const data = await call<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`);
  const values = { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000), refreshedAt: new Date() };
  await prisma.socialCredential.upsert({ where: { provider: PROVIDER }, update: values, create: { provider: PROVIDER, ...values } });
  return true;
}

// JPEG public attendu par Instagram : l'illustration IA en a déjà un ; sinon on le fabrique depuis la
// photo de couverture de la photothèque du site (servie en WebP par le site public).
async function instagramImageUrl(article: { imageUrl: string | null }, config: InstagramConfig) {
  const image = article.imageUrl;
  if (image?.endsWith(".webp") && image.startsWith(config.publicPrefix)) return `${config.publicApiOrigin}${image.replace(/\.webp$/, "-instagram.jpg")}`;
  const photo = image?.startsWith("photo:") ? image.slice(6) : "paris-terrace";
  const source = await fetch(`${config.webOrigin}/images/${photo}-1600.webp`, { signal: AbortSignal.timeout(30_000) });
  if (!source.ok) throw new Error(`Photo de couverture introuvable (${source.status})`);
  const jpeg = await sharp(Buffer.from(await source.arrayBuffer())).resize(1080, 1080, { fit: "cover", position: "centre" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const file = `instagram-${photo}-${Date.now()}.jpg`;
  await writeFile(path.join(config.uploadsDir, file), jpeg);
  return `${config.publicApiOrigin}${config.publicPrefix}${file}`;
}

let publishing = false;
export async function shareArticleOnInstagram(prisma: PrismaClient, config: InstagramConfig, articleId: string): Promise<"PUBLISHED" | "ALREADY_PUBLISHED" | "NO_CAPTION" | "BUSY"> {
  if (publishing) return "BUSY";
  publishing = true;
  try {
    const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    if (article.instagramMediaId) return "ALREADY_PUBLISHED";
    if (!article.instagramCaption) return "NO_CAPTION";
    try {
      const token = await instagramToken(prisma, config);
      const imageUrl = await instagramImageUrl(article, config);
      const body = new URLSearchParams({ image_url: imageUrl, caption: article.instagramCaption, access_token: token });
      const container = await call<{ id: string }>(graph(config, `${config.userId}/media`), { method: "POST", body });
      // Instagram télécharge et traite l'image de façon asynchrone : on attend FINISHED (60 s au plus).
      for (let i = 0; i < 20; i++) {
        const status = await call<{ status_code?: string }>(graph(config, `${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`));
        if (status.status_code === "FINISHED") break;
        if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Traitement de l'image refusé par Instagram (${status.status_code})`);
        await new Promise(r => setTimeout(r, 3000));
      }
      const published = await call<{ id: string }>(graph(config, `${config.userId}/media_publish`), { method: "POST", body: new URLSearchParams({ creation_id: container.id, access_token: token }) });
      await prisma.article.update({ where: { id: articleId }, data: { instagramMediaId: published.id, instagramPublishedAt: new Date(), instagramError: null } });
      return "PUBLISHED";
    } catch (err) {
      await prisma.article.update({ where: { id: articleId }, data: { instagramError: (err as Error).message.slice(0, 500) } });
      throw err;
    }
  } finally {
    publishing = false;
  }
}
