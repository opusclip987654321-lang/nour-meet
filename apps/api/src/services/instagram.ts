import { parisDateTime } from "@nour/shared";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeInstagramCaption } from "./blog-content.js";
import type { Prisma } from "@prisma/client";
import { CAROUSEL_MAX, CAROUSEL_MIN, articleCarouselPlan, storedCarousel, type CarouselMiddle, type CarouselSlide } from "./instagram-carousel.js";
import { chartSlide, contrastSlide, coverSlide, ctaSlide, eventVisual, listSlide, pointSlide, quoteSlide, sceneSlide, statementSlide } from "./social-visuals.js";

// Publication Instagram via l'API Instagram avec connexion Instagram (compte professionnel) :
// - l'article du jour, en carrousel de 4 à 8 slides (décision v2 §6, remplace l'image unique) ;
// - un événement restaurateur au moment où il est réellement publié (v2 §14).
// Une seule publication par article ou événement (instagramMediaId + verrou atomique
// instagramPublishingAt), délais bornés, et aucune erreur ne remonte : l'article ou l'événement reste
// en ligne sur le site, l'échec est tracé (instagramError) et un nouvel essai reste possible.

export type InstagramConfig = { userId: string; initialToken: string; graphVersion: string; publicApiOrigin: string; webOrigin: string; uploadsDir: string; publicPrefix: string; publicDir: string };
const PROVIDER = "instagram";
const TOKEN_REFRESH_AFTER_MS = 7 * 24 * 60 * 60_000;
// Un envoi interrompu (redémarrage du serveur) libère son verrou au bout d'une heure — bien au-delà du
// pire cas d'un carrousel de 8 médias (chaque attente est bornée à 60 s).
const STALE_LOCK_MS = 60 * 60_000;

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

/**
 * Image source d'un visuel : fichier d'article ou d'événement servi par l'API (/static/uploads/…), image
 * par défaut (/static/defaults/…), ou photo de la photothèque du site. Aucune autre adresse n'est lue :
 * ni URL arbitraire (pas de requête serveur vers une adresse choisie par un tiers), ni photo de profil.
 */
const READABLE_STATIC = ["uploads/articles/", "uploads/events/", "defaults/"];
export async function loadImage(image: string | null, config: Pick<InstagramConfig, "publicDir" | "webOrigin">, fallbackPhoto = "paris-terrace"): Promise<Buffer> {
  if (image?.startsWith("/static/")) {
    const relative = image.slice("/static/".length);
    const file = path.resolve(config.publicDir, relative);
    if (!READABLE_STATIC.some(prefix => relative.startsWith(prefix)) || !file.startsWith(path.resolve(config.publicDir) + path.sep)) throw new Error("Image refusée pour Instagram");
    return readFile(file);
  }
  const photo = image?.startsWith("photo:") ? image.slice(6) : fallbackPhoto;
  if (!/^[a-z0-9-]+$/.test(photo)) throw new Error("Photo de photothèque invalide");
  const source = await fetch(`${config.webOrigin}/images/${photo}-1600.webp`, { signal: AbortSignal.timeout(30_000) });
  if (!source.ok) throw new Error(`Image introuvable (${source.status})`);
  return Buffer.from(await source.arrayBuffer());
}

// Instagram télécharge et traite chaque média de façon asynchrone : on attend FINISHED (60 s au plus).
async function waitFinished(config: InstagramConfig, token: string, containerId: string) {
  for (let i = 0; i < 20; i++) {
    const status = await call<{ status_code?: string }>(graph(config, `${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`));
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Traitement du média refusé par Instagram (${status.status_code})`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Instagram n’a pas fini de traiter le média à temps");
}

/** Publie une image seule, ou un carrousel (conteneur CAROUSEL + médias enfants) dès deux images. */
async function publishImages(config: InstagramConfig, token: string, jpegs: Buffer[], caption: string): Promise<string> {
  // Fichiers publics temporaires : Instagram les télécharge lui-même, puis ils sont supprimés.
  const files = await Promise.all(jpegs.map(async jpeg => {
    const name = `instagram-${randomUUID()}.jpg`;
    await writeFile(path.join(config.uploadsDir, name), jpeg);
    return { name, url: `${config.publicApiOrigin}${config.publicPrefix}${name}` };
  }));
  try {
    let creationId: string;
    if (files.length === 1) {
      creationId = (await call<{ id: string }>(graph(config, `${config.userId}/media`), { method: "POST", body: new URLSearchParams({ image_url: files[0].url, caption, access_token: token }) })).id;
    } else {
      const children: string[] = [];
      for (const f of files) {
        const child = await call<{ id: string }>(graph(config, `${config.userId}/media`), { method: "POST", body: new URLSearchParams({ image_url: f.url, is_carousel_item: "true", access_token: token }) });
        await waitFinished(config, token, child.id);
        children.push(child.id);
      }
      creationId = (await call<{ id: string }>(graph(config, `${config.userId}/media`), { method: "POST", body: new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption, access_token: token }) })).id;
    }
    await waitFinished(config, token, creationId);
    return (await call<{ id: string }>(graph(config, `${config.userId}/media_publish`), { method: "POST", body: new URLSearchParams({ creation_id: creationId, access_token: token }) })).id;
  } finally {
    await Promise.all(files.map(f => rm(path.join(config.uploadsDir, f.name), { force: true })));
  }
}

const siteLabel = (config: Pick<InstagramConfig, "webOrigin">) => new URL(config.webOrigin).host.replace(/^www\./, "");

type CarouselArticle = { title: string; excerpt: string | null; content: string; category: string | null; imageUrl: string | null; instagramCarousel?: Prisma.JsonValue | null };

async function renderSlide(slide: CarouselSlide, position: string, config: Pick<InstagramConfig, "publicDir" | "webOrigin">) {
  switch (slide.kind) {
    case "contrast": return contrastSlide(slide.myth, slide.reality, position);
    case "statement": return statementSlide(slide.text, slide.highlight, position);
    case "list": return listSlide(slide.title, slide.items, position);
    case "quote": return quoteSlide(slide.text, position);
    // Image propre à la slide ; illisible ou absente, la slide reste publiable sans image.
    case "scene": return sceneSlide(slide.image ? await loadImage(slide.image, config).catch(() => null) : null, slide.title, slide.text, position);
  }
}

/** Slides JPEG du carrousel d'un article (exporté pour les tests et l'aperçu). */
export async function renderArticleCarousel(article: CarouselArticle, config: Pick<InstagramConfig, "publicDir" | "webOrigin">) {
  const cover = await loadImage(article.imageUrl, config);
  const plan = articleCarouselPlan(article);
  const script = storedCarousel(article.instagramCarousel);
  if (script) {
    // Carrousel réécrit : un graphique sourcé de l'article garde sa place, en deuxième position.
    const chart = plan.middle.find((m): m is Extract<CarouselMiddle, { kind: "chart" }> => m.kind === "chart");
    const middle: (CarouselSlide | Extract<CarouselMiddle, { kind: "chart" }>)[] = [...script.slides];
    if (chart && middle.length < CAROUSEL_MAX - 2) middle.splice(1, 0, chart);
    const total = middle.length + 2;
    const slides = [await coverSlide(cover, script.hook, plan.label, `1/${total}`, script.subtitle || undefined)];
    for (const [i, m] of middle.entries()) slides.push(m.kind === "chart" ? await chartSlide(m.chart, `${i + 2}/${total}`) : await renderSlide(m, `${i + 2}/${total}`, config));
    slides.push(await ctaSlide(script.ctaHeadline, script.ctaDetail, siteLabel(config), `${total}/${total}`));
    return slides;
  }
  const total = plan.middle.length + 2;
  if (total < CAROUSEL_MIN) throw new Error("Article trop court pour un carrousel de 4 slides au moins");
  const slides = [await coverSlide(cover, plan.title, plan.label, `1/${total}`)];
  let pointIndex = 0;
  for (const [i, m] of plan.middle.entries()) {
    const position = `${i + 2}/${total}`;
    slides.push(m.kind === "chart" ? await chartSlide(m.chart, position) : await pointSlide(++pointIndex, m.heading, m.body, position));
  }
  slides.push(await ctaSlide("Lire l’article complet", "Lien en bio", siteLabel(config), `${total}/${total}`));
  return slides;
}

// Verrou atomique : un seul envoi à la fois par article ou événement, jamais une seconde publication.
const lockWhere = (id: string) => ({ id, instagramMediaId: null, OR: [{ instagramPublishingAt: null }, { instagramPublishingAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }] });

export async function shareArticleOnInstagram(prisma: PrismaClient, config: InstagramConfig, articleId: string): Promise<"PUBLISHED" | "ALREADY_PUBLISHED" | "NO_CAPTION" | "BUSY"> {
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  if (article.instagramMediaId) return "ALREADY_PUBLISHED";
  if (!article.instagramCaption) return "NO_CAPTION";
  const claimed = await prisma.article.updateMany({ where: lockWhere(articleId), data: { instagramPublishingAt: new Date() } });
  if (claimed.count !== 1) return "BUSY";
  let mediaId: string | undefined;
  try {
    const slides = await renderArticleCarousel(article, config);
    mediaId = await publishImages(config, await instagramToken(prisma, config), slides, article.instagramCaption);
    await prisma.article.update({ where: { id: articleId }, data: { instagramMediaId: mediaId, instagramPublishedAt: new Date(), instagramError: null, instagramPublishingAt: null } });
    return "PUBLISHED";
  } catch (err) {
    // Publié chez Instagram mais non enregistré ici : le verrou reste posé, pour qu'aucun nouvel essai
    // ne republie avant vérification (l'identifiant du média figure dans le message d'erreur).
    await prisma.article.update({ where: { id: articleId }, data: { instagramError: (mediaId ? `Publié (média ${mediaId}) mais non enregistré : ` : "") + (err as Error).message.slice(0, 450), ...(mediaId ? {} : { instagramPublishingAt: null }) } }).catch(() => {});
    throw err;
  }
}

/** Visuel JPEG d'un événement (exporté pour les tests et l'aperçu). */
export async function renderEventVisual(event: { title: string; category: string; startsAt: Date; district: string; imageUrl: string | null }, config: Pick<InstagramConfig, "publicDir" | "webOrigin">, defaultImage: string) {
  return eventVisual(await loadImage(event.imageUrl ?? defaultImage, config), { category: event.category, title: event.title, when: parisDateTime(event.startsAt), district: event.district, cta: "Réservez votre place : lien en bio" });
}

export type EventShareOutcome = "PUBLISHED" | "ALREADY_PUBLISHED" | "NOT_ELIGIBLE" | "BUSY";

/**
 * Publication d'un événement restaurateur (v2 §14), appelée au passage réel à PUBLISHED. Jamais un
 * brouillon, un événement en attente, refusé, annulé, de démonstration, ni déjà publié sur Instagram :
 * ces conditions sont revérifiées ici, en base, quel que soit l'appelant.
 */
export async function shareEventOnInstagram(prisma: PrismaClient, config: InstagramConfig, eventId: string, defaultImage: string): Promise<EventShareOutcome> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (event.instagramMediaId) return "ALREADY_PUBLISHED";
  if (event.status !== "PUBLISHED" || event.isDemo || !event.controllerRestaurantId || event.startsAt <= new Date()) return "NOT_ELIGIBLE";
  const claimed = await prisma.event.updateMany({ where: { ...lockWhere(eventId), status: "PUBLISHED", isDemo: false }, data: { instagramPublishingAt: new Date() } });
  if (claimed.count !== 1) return "BUSY";
  let mediaId: string | undefined;
  try {
    const visual = await renderEventVisual(event, config, defaultImage);
    const caption = sanitizeInstagramCaption(`${event.title}\n\n${parisDateTime(event.startsAt)} · ${event.district}\n${event.category}\n\nPlaces limitées : réservez via le lien en bio (${siteLabel(config)}).\n\n#nurmeet #paris #rencontres`)
      ?? `Nouvelle soirée Nūr Meet · ${parisDateTime(event.startsAt)} · ${event.district}\n\nRéservez via le lien en bio.`;
    mediaId = await publishImages(config, await instagramToken(prisma, config), [visual], caption);
    await prisma.event.update({ where: { id: eventId }, data: { instagramMediaId: mediaId, instagramPublishedAt: new Date(), instagramError: null, instagramPublishingAt: null } });
    return "PUBLISHED";
  } catch (err) {
    // Publié chez Instagram mais non enregistré ici : le verrou reste posé, pour qu'aucun nouvel essai
    // ne republie avant vérification (l'identifiant du média figure dans le message d'erreur).
    await prisma.event.update({ where: { id: eventId }, data: { instagramError: (mediaId ? `Publié (média ${mediaId}) mais non enregistré : ` : "") + (err as Error).message.slice(0, 450), ...(mediaId ? {} : { instagramPublishingAt: null }) } }).catch(() => {});
    throw err;
  }
}
