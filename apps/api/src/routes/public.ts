import { EventStatus } from "@prisma/client";
import { z } from "zod";
import { aiProvider, app, emailProvider, prisma, smsVerification, stripe } from "../context.js";
import { SITE_ORIGIN, env } from "../env.js";
import { TokenUser, optionalAuth } from "../services/auth.js";
import { getSetting } from "../settings.js";

app.get("/health", async () => ({ status: "ok", service: "nour-api", smsMode: smsVerification.mode, now: new Date().toISOString() }));
// §21 (corrections web 2026-09-24) : état des dépendances pour la surveillance (base joignable en moins
// de 2 s, fournisseurs configurés ou non) — jamais une clé ni un identifiant, seulement des états.
// /health reste une simple sonde de vie : une panne d'un service secondaire ne rend jamais l'API
// « morte » aux yeux de Docker.
app.get("/health/ready", async (_request, reply) => {
  const database = await Promise.race([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const),
    new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), 2000))
  ]).catch(() => "error" as const);
  const body = {
    status: database === "ok" ? "ok" : "degraded",
    database,
    providers: { stripe: stripe ? "configured" : "absent", sms: smsVerification.mode, email: emailProvider.mode, blogAi: aiProvider.mode, sentry: env.SENTRY_DSN ? "configured" : "absent" },
    now: new Date().toISOString()
  };
  return reply.code(database === "ok" ? 200 : 503).send(body);
});

// C31 puis corrections web 2026-09-24 (§19/§20) : sitemap réel généré depuis les pages publiques, les
// événements réservables à venir et les articles publiés — jamais une liste statique périmée, jamais
// un événement de démonstration (non réservable) ni un espace privé. Servi sur le domaine du site par
// le reverse proxy (infra/Caddyfile) et par le proxy Vite en local.
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
app.get("/sitemap.xml", async (_request, reply) => {
  const [events, articles] = await Promise.all([
    prisma.event.findMany({ where: { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, isDemo: false, startsAt: { gt: new Date() } }, select: { slug: true, updatedAt: true }, orderBy: { startsAt: "asc" } }),
    prisma.article.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" } })
  ]);
  const staticUrls: { path: string; priority: string }[] = [
    { path: "/", priority: "1.0" }, { path: "/events", priority: "0.9" }, { path: "/concept", priority: "0.7" }, { path: "/blog", priority: "0.7" },
    { path: "/legal/mentions-legales", priority: "0.2" }, { path: "/legal/cgu", priority: "0.2" }, { path: "/legal/cgv", priority: "0.2" }, { path: "/legal/confidentialite", priority: "0.2" }, { path: "/legal/cookies", priority: "0.2" }
  ];
  const urls = [
    ...staticUrls.map(u => ({ ...u, updatedAt: null as Date | null })),
    ...events.map(e => ({ path: `/events/${e.slug}`, updatedAt: e.updatedAt, priority: "0.8" })),
    ...articles.map(a => ({ path: `/blog/${a.slug}`, updatedAt: a.updatedAt, priority: "0.6" }))
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${xmlEscape(`${SITE_ORIGIN}${u.path}`)}</loc>${u.updatedAt ? `<lastmod>${u.updatedAt.toISOString().slice(0, 10)}</lastmod>` : ""}<priority>${u.priority}</priority></url>`).join("\n")}\n</urlset>\n`;
  reply.header("Content-Type", "application/xml; charset=utf-8").header("Cache-Control", "public, max-age=3600");
  return body;
});
// Espaces privés, paiement et administration exclus de l'exploration ; toutes les pages publiques
// (soirées, journal, pages juridiques) restent ouvertes, y compris aux robots des moteurs IA.
app.get("/robots.txt", async (_request, reply) => {
  reply.header("Content-Type", "text/plain; charset=utf-8").header("Cache-Control", "public, max-age=86400");
  return ["User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /dashboard", "Disallow: /restaurant", "Disallow: /notifications", "Disallow: /pay/", "Disallow: /login", "", `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, ""].join("\n");
});
// llms.txt (proposition llmstxt.org) : résumé factuel du service et liens vers les pages utiles, avec
// les soirées réservables à venir et les derniers articles — généré à la demande, jamais figé.
app.get("/llms.txt", async (_request, reply) => {
  const [events, articles] = await Promise.all([
    prisma.event.findMany({ where: { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, isDemo: false, startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 20, select: { slug: true, title: true, category: true, district: true, startsAt: true, priceCents: true } }),
    prisma.article.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 20, select: { slug: true, title: true, excerpt: true } })
  ]);
  const o = SITE_ORIGIN;
  const date = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const lines = [
    "# Nūr Meet",
    "",
    "> Plateforme française de soirées en petit comité dans des restaurants partenaires à Paris et en Île-de-France : speed dating avec entretien de validation préalable, et soirées networking en accès direct. Service réservé aux personnes majeures.",
    "",
    "Fonctionnement : on choisit une soirée, on réserve et paie sa place en ligne (paiement par carte via Stripe), on reçoit un billet avec QR code. Pour les soirées de speed dating, un entretien téléphonique de 15 minutes avec un membre de l'équipe valide le profil, une seule fois ; les soirées networking n'en demandent pas. Après la soirée, un échange dans l'application mobile ne s'ouvre que si les deux personnes l'acceptent. Annulation gratuite jusqu'à 24 heures avant le début, avec remboursement intégral.",
    "",
    "## Pages principales",
    `- [Prochaines soirées](${o}/events) : toutes les soirées à venir, avec lieu, date, prix et prestations comprises`,
    `- [Comment ça marche](${o}/concept) : le parcours détaillé de chaque format`,
    `- [Le journal](${o}/blog) : articles sur les rencontres, l'amitié, la vie sociale et le networking`,
    "",
    "## Soirées à venir",
    ...(events.length ? events.map(e => `- [${e.title}](${o}/events/${e.slug}) : ${e.category}, ${e.district}, ${date(e.startsAt)}, ${e.priceCents === 0 ? "gratuit" : `${(e.priceCents / 100).toFixed(2).replace(".", ",")} €`}`) : ["- Aucune soirée publiée pour le moment."]),
    "",
    "## Articles récents",
    ...(articles.length ? articles.map(a => `- [${a.title}](${o}/blog/${a.slug})${a.excerpt ? ` : ${a.excerpt}` : ""}`) : ["- Aucun article publié pour le moment."]),
    "",
    "## Informations",
    `- [Mentions légales](${o}/legal/mentions-legales)`,
    `- [Conditions générales de vente](${o}/legal/cgv)`,
    `- [Politique de confidentialité](${o}/legal/confidentialite)`,
    "- Contact : contact@nourmeet.com",
    ""
  ];
  reply.header("Content-Type", "text/plain; charset=utf-8").header("Cache-Control", "public, max-age=3600");
  return lines.join("\n");
});

// C32-C34 (ordre correctif 2026-09-20) : n'écrit strictement rien tant que ANALYTICS_ENABLED est
// désactivé (défaut) — jamais de traceur actif silencieusement, voir settings.ts. anonId reste un
// identifiant aléatoire posé par le navigateur, jamais une empreinte technique reconstituée ici.
app.post("/analytics/pageview", { preHandler: optionalAuth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  if (!getSetting("ANALYTICS_ENABLED")) return reply.code(204).send();
  const input = z.object({ path: z.string().max(300), anonId: z.string().max(100), referrerHost: z.string().max(200).nullable().optional(), utmSource: z.string().max(100).nullable().optional(), utmMedium: z.string().max(100).nullable().optional(), utmCampaign: z.string().max(100).nullable().optional() }).parse(request.body);
  const token = request.user as TokenUser | undefined;
  await prisma.pageView.create({ data: { path: input.path, anonId: input.anonId, referrerHost: input.referrerHost ?? null, utmSource: input.utmSource ?? null, utmMedium: input.utmMedium ?? null, utmCampaign: input.utmCampaign ?? null, userId: token?.sub ?? null, userRole: token?.role ?? null } });
  return reply.code(204).send();
});
