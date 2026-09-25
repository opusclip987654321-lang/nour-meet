import { parisDateTime } from "@nour/shared";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderArticleCarousel, renderEventVisual } from "./instagram.js";

// Publication sur la Page Facebook de Nūr Meet (API Pages, décision du 2026-09-25) : mêmes visuels
// qu'Instagram — carrousel pour l'article du jour, visuel pour une soirée restaurateur réellement
// publiée —, avec en plus un lien cliquable vers le site. Une seule publication par article ou
// soirée (facebookPostId + verrou atomique facebookPublishingAt), délais bornés, et aucune erreur ne
// remonte : l'article ou la soirée reste en ligne sur le site, l'échec est tracé (facebookError).

export type FacebookConfig = { pageId: string; pageToken: string; graphVersion: string; publicApiOrigin: string; siteOrigin: string; webOrigin: string; uploadsDir: string; publicPrefix: string; publicDir: string };
const STALE_LOCK_MS = 60 * 60_000;

async function call<T>(config: FacebookConfig, pathName: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: config.pageToken });
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${pathName}`, { method: "POST", body, signal: AbortSignal.timeout(60_000) });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok || data.error) throw new Error(`Facebook (${response.status}) : ${data.error?.message ?? "réponse invalide"}`);
  return data;
}

/** Publie une ou plusieurs images avec un texte : photo seule, ou publication multi-photos (attached_media). */
async function publishImages(config: FacebookConfig, jpegs: Buffer[], message: string): Promise<string> {
  // Fichiers publics temporaires : Facebook les télécharge pendant l'appel, puis ils sont supprimés.
  const files = await Promise.all(jpegs.map(async jpeg => {
    const name = `facebook-${randomUUID()}.jpg`;
    await writeFile(path.join(config.uploadsDir, name), jpeg);
    return { name, url: `${config.publicApiOrigin}${config.publicPrefix}${name}` };
  }));
  try {
    if (files.length === 1) {
      const photo = await call<{ id: string; post_id?: string }>(config, `${config.pageId}/photos`, { url: files[0].url, caption: message, published: "true" });
      return photo.post_id ?? photo.id;
    }
    const ids: string[] = [];
    for (const f of files) ids.push((await call<{ id: string }>(config, `${config.pageId}/photos`, { url: f.url, published: "false" })).id);
    const params: Record<string, string> = { message };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    return (await call<{ id: string }>(config, `${config.pageId}/feed`, params)).id;
  } finally {
    await Promise.all(files.map(f => rm(path.join(config.uploadsDir, f.name), { force: true })));
  }
}

// Même charte que la légende Instagram : jamais le mot interdit par la charte éditoriale.
const cleanMessage = (text: string, fallback: string) => (/musulman/i.test(text) ? fallback : text).slice(0, 5000);
const lockWhere = (id: string) => ({ id, facebookPostId: null, OR: [{ facebookPublishingAt: null }, { facebookPublishingAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }] });

export async function shareArticleOnFacebook(prisma: PrismaClient, config: FacebookConfig, articleId: string): Promise<"PUBLISHED" | "ALREADY_PUBLISHED" | "NOT_PUBLISHED" | "BUSY"> {
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  if (article.facebookPostId) return "ALREADY_PUBLISHED";
  if (article.status !== "PUBLISHED") return "NOT_PUBLISHED";
  const claimed = await prisma.article.updateMany({ where: lockWhere(articleId), data: { facebookPublishingAt: new Date() } });
  if (claimed.count !== 1) return "BUSY";
  let postId: string | undefined;
  try {
    const slides = await renderArticleCarousel(article, config);
    const url = `${config.siteOrigin}/blog/${article.slug}`;
    const message = cleanMessage(`${article.title}\n\n${article.excerpt ?? ""}\n\nLire l’article : ${url}`.replace(/\n{3,}/g, "\n\n"), `Nouvel article sur le journal Nūr Meet : ${url}`);
    postId = await publishImages(config, slides, message);
    await prisma.article.update({ where: { id: articleId }, data: { facebookPostId: postId, facebookPublishedAt: new Date(), facebookError: null, facebookPublishingAt: null } });
    return "PUBLISHED";
  } catch (err) {
    // Publié chez Facebook mais non enregistré ici : le verrou reste posé, aucun nouvel essai ne republie.
    await prisma.article.update({ where: { id: articleId }, data: { facebookError: (postId ? `Publié (${postId}) mais non enregistré : ` : "") + (err as Error).message.slice(0, 450), ...(postId ? {} : { facebookPublishingAt: null }) } }).catch(() => {});
    throw err;
  }
}

export type FacebookEventOutcome = "PUBLISHED" | "ALREADY_PUBLISHED" | "NOT_ELIGIBLE" | "BUSY";

/** Soirée restaurateur réellement publiée, à venir, hors démonstration : conditions revérifiées en base. */
export async function shareEventOnFacebook(prisma: PrismaClient, config: FacebookConfig, eventId: string, defaultImage: string): Promise<FacebookEventOutcome> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (event.facebookPostId) return "ALREADY_PUBLISHED";
  if (event.status !== "PUBLISHED" || event.isDemo || !event.controllerRestaurantId || event.startsAt <= new Date()) return "NOT_ELIGIBLE";
  const claimed = await prisma.event.updateMany({ where: { ...lockWhere(eventId), status: "PUBLISHED", isDemo: false }, data: { facebookPublishingAt: new Date() } });
  if (claimed.count !== 1) return "BUSY";
  let postId: string | undefined;
  try {
    const visual = await renderEventVisual(event, config, defaultImage);
    const url = `${config.siteOrigin}/events/${event.slug}`;
    const message = cleanMessage(`${event.title}\n\n${parisDateTime(event.startsAt)} · ${event.district}\n${event.category}\n\nPlaces limitées, réservez ici : ${url}`, `Nouvelle soirée Nūr Meet · ${parisDateTime(event.startsAt)} · ${event.district}\n\nRéservez ici : ${url}`);
    postId = await publishImages(config, [visual], message);
    await prisma.event.update({ where: { id: eventId }, data: { facebookPostId: postId, facebookPublishedAt: new Date(), facebookError: null, facebookPublishingAt: null } });
    return "PUBLISHED";
  } catch (err) {
    await prisma.event.update({ where: { id: eventId }, data: { facebookError: (postId ? `Publié (${postId}) mais non enregistré : ` : "") + (err as Error).message.slice(0, 450), ...(postId ? {} : { facebookPublishingAt: null }) } }).catch(() => {});
    throw err;
  }
}
