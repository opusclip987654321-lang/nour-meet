import { EventStatus } from "@prisma/client";
import { z } from "zod";
import { app, prisma, smsVerification } from "../context.js";
import { env } from "../env.js";
import { TokenUser, optionalAuth } from "../services/auth.js";
import { getSetting } from "../settings.js";

app.get("/health", async () => ({ status: "ok", service: "nour-api", smsMode: smsVerification.mode, now: new Date().toISOString() }));

// C31 (ordre correctif 2026-09-20) : sitemap réel généré depuis les événements publiés et les
// articles réellement publiés — jamais une liste statique périmée. En production, faire pointer
// <domaine>/sitemap.xml ici via le reverse proxy si le web et l'API ne partagent pas déjà l'origine.
app.get("/sitemap.xml", async (_request, reply) => {
  const [events, articles] = await Promise.all([
    prisma.event.findMany({ where: { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] } }, select: { slug: true, updatedAt: true } }),
    prisma.article.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true } })
  ]);
  const staticUrls = ["/", "/events", "/concept", "/blog"];
  const urls = [
    ...staticUrls.map(path => ({ path, updatedAt: new Date() })),
    ...events.map(e => ({ path: `/events/${e.slug}`, updatedAt: e.updatedAt })),
    ...articles.map(a => ({ path: `/blog/${a.slug}`, updatedAt: a.updatedAt }))
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${env.WEB_ORIGIN}${u.path}</loc><lastmod>${u.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`).join("\n")}\n</urlset>`;
  reply.header("Content-Type", "application/xml; charset=utf-8");
  return body;
});
app.get("/robots.txt", async (_request, reply) => {
  reply.header("Content-Type", "text/plain; charset=utf-8");
  return `User-agent: *\nAllow: /\nSitemap: ${env.WEB_ORIGIN}/sitemap.xml`;
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
