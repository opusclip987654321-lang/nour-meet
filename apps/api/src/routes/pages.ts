import { EventStatus } from "@prisma/client";
import { SOCIAL_LINKS } from "@nour/shared";
import { app, prisma } from "../context.js";
import { SITE_ORIGIN, env } from "../env.js";
import { publicEvent } from "../services/events.js";
import { PrerenderEvent, PrerenderedPage, articlePage, blogPage, conceptPage, eventPage, eventsPage, homePage, injectPage, notFoundPage, restaurateursPage } from "../services/prerender.js";

// Pages publiques servies déjà remplies (audit SEO 2026-10-07, voir services/prerender.ts) : Caddy
// réécrit /, /events, /events/:slug, /concept, /restaurateurs, /blog et /blog/:slug en /__pages/…
// (infra/Caddyfile), comme il le fait déjà pour /sitemap.xml.
const urls = { siteUrl: SITE_ORIGIN, apiUrl: (env.API_PUBLIC_URL ?? SITE_ORIGIN).replace(/\/$/, ""), defaultImage: `${SITE_ORIGIN}/images/paris-terrace-1600.webp` };

// index.html du site (noms des fichiers JS et CSS de la version déployée), relu toutes les 30 s :
// après un déploiement, les pages pointent vite vers les nouveaux fichiers.
let template: { html: string; at: number } | null = null;
async function siteTemplate() {
  if (template && Date.now() - template.at < 30_000) return template.html;
  const response = await fetch(`${env.WEB_INTERNAL_URL.replace(/\/$/, "")}/index.html`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`index.html du site indisponible (${response.status})`);
  template = { html: await response.text(), at: Date.now() };
  return template.html;
}

const eventInclude = { controllerRestaurant: true, venueRestaurant: true, quotas: true, priceTiers: true, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } } as const;
// Visiteur anonyme : jamais de disponibilité par catégorie ni de chiffre interne (C24).
const asPrerenderEvent = (event: any): PrerenderEvent => publicEvent(event, false, null) as unknown as PrerenderEvent;
const upcoming = (category: string | null, take: number) => prisma.event.findMany({
  where: { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, isDemo: false, startsAt: { gt: new Date() }, ...(category ? { category } : {}) },
  include: eventInclude, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take
});

async function pageFor(path: string, query: Record<string, string | undefined>): Promise<{ page: PrerenderedPage; status: number }> {
  const ok = (page: PrerenderedPage) => ({ page, status: 200 });
  const missing = { page: notFoundPage(urls), status: 404 };
  if (path === "/") return ok(homePage((await upcoming(null, 6)).map(asPrerenderEvent), urls, [SOCIAL_LINKS.instagram.url, SOCIAL_LINKS.facebook.url]));
  if (path === "/events") {
    const category = query.category?.trim() || null;
    return ok(eventsPage((await upcoming(category, 100)).map(asPrerenderEvent), category, urls));
  }
  if (path === "/concept") return ok(conceptPage(urls));
  if (path === "/restaurateurs") return ok(restaurateursPage(urls));
  if (path === "/blog") return ok(blogPage(await prisma.article.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, select: { slug: true, title: true, excerpt: true, category: true, publishedAt: true } }), urls));
  let match = path.match(/^\/events\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const event = await prisma.event.findFirst({ where: { OR: [{ id }, { slug: id }] }, include: eventInclude });
    // Brouillon ou soirée en attente de validation : introuvable pour le public, comme GET /events/:id.
    if (!event || event.status === EventStatus.DRAFT || event.status === EventStatus.PENDING_REVIEW) return missing;
    return ok(eventPage(asPrerenderEvent(event), urls));
  }
  match = path.match(/^\/blog\/([^/]+)$/);
  if (match) {
    const article = await prisma.article.findFirst({ where: { slug: decodeURIComponent(match[1]), status: "PUBLISHED" }, include: { author: true } });
    if (!article) return missing;
    return ok(articlePage({ ...article, keywords: article.keywords, author: article.author ? { displayName: article.author.displayName } : null }, urls));
  }
  return missing;
}

// Rendu gardé 60 s par URL : un robot qui parcourt le site ne déclenche pas une requête en base par page vue.
const rendered = new Map<string, { html: string; status: number; at: number }>();

app.get("/__pages/*", { config: { rateLimit: false } }, async (request, reply) => {
  const url = new URL(request.url, "http://local");
  const path = url.pathname.replace(/^\/__pages/, "").replace(/\/+$/, "") || "/";
  const query = Object.fromEntries(url.searchParams) as Record<string, string | undefined>;
  const key = `${path}?${query.category ?? ""}`;
  let entry = rendered.get(key);
  if (!entry || Date.now() - entry.at > 60_000) {
    const [html, { page, status }] = await Promise.all([siteTemplate(), pageFor(path, query)]);
    entry = { html: injectPage(html, urls.siteUrl, page), status, at: Date.now() };
    if (rendered.size > 2000) rendered.clear();
    rendered.set(key, entry);
  }
  // Mêmes en-têtes que l'index.html servi par nginx (apps/web/nginx.conf) ; pas de
  // Cross-Origin-Opener-Policy de helmet, qui casserait la fenêtre de connexion Google du site.
  reply.removeHeader("cross-origin-opener-policy");
  reply.removeHeader("origin-agent-cluster");
  return reply.code(entry.status).header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-cache").header("X-Frame-Options", "DENY").header("Referrer-Policy", "strict-origin-when-cross-origin").send(entry.html);
});
