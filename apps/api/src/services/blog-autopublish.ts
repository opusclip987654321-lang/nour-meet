import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import type { AIProvider } from "../ai-provider.js";
import { BLOG_CATEGORIES, MAX_AI_ATTEMPTS_PER_DAY, parisDay, sanitizeGeneratedArticle, slugifyTitle } from "./blog-content.js";

// Publication automatique quotidienne du blog (corrections web 2026-09-24, §3) — remplace la
// validation manuelle préalable demandée jusque-là. Un article par jour calendaire (Europe/Paris),
// sans doublon : la colonne unique Article.autoPublishDay le garantit au niveau de la base, même si
// deux passages de la tâche se chevauchent ou si le serveur redémarre en pleine génération.
// Dépendances injectées (base, fournisseur IA, notifications) pour être testable sans serveur.
type Deps = { prisma: PrismaClient; aiProvider: AIProvider; notify: (userId: string, title: string, body: string, link?: string) => Promise<unknown>; log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } };
export type DailyArticleOutcome = "ALREADY_PUBLISHED" | "PUBLISHED_AI" | "PUBLISHED_QUEUE" | "NOTHING_TO_PUBLISH" | "BUSY";

let running = false;
export async function publishDailyArticle(deps: Deps, now: Date = new Date()): Promise<DailyArticleOutcome> {
  if (running) return "BUSY";
  running = true;
  try {
    const { prisma, aiProvider } = deps;
    const day = parisDay(now);
    if (await prisma.article.findUnique({ where: { autoPublishDay: day } })) return "ALREADY_PUBLISHED";
    const failedToday = await prisma.auditLog.count({ where: { action: "DAILY_ARTICLE_AI_FAILED", entityId: day } });
    let created: { id: string; title: string } | null = null;
    let outcome: DailyArticleOutcome = "NOTHING_TO_PUBLISH";

    if (aiProvider.generateArticle && failedToday < MAX_AI_ATTEMPTS_PER_DAY) {
      try {
        const [recent, upcoming] = await Promise.all([
          prisma.article.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 30, select: { title: true } }),
          prisma.event.findMany({ where: { status: "PUBLISHED", isDemo: false, startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 8, select: { title: true, slug: true, category: true, startsAt: true, district: true } })
        ]);
        const { article, searchedUrls } = await aiProvider.generateArticle({ today: now.toLocaleDateString("fr-FR", { dateStyle: "full", timeZone: "Europe/Paris" }), categories: BLOG_CATEGORIES, recentTitles: recent.map(r => r.title), upcomingEvents: upcoming });
        const clean = sanitizeGeneratedArticle(article, searchedUrls);
        const { sourcesCount, ...data } = clean;
        created = await prisma.article.create({ data: { ...data, slug: `${slugifyTitle(clean.title)}-${day.replace(/-/g, "")}`, status: "PUBLISHED", publishedAt: now, autoPublishDay: day, aiGenerated: true, aiPrompt: `Publication automatique du ${day} (${article.kind}, ${sourcesCount} source(s) vérifiée(s))` } });
        outcome = "PUBLISHED_AI";
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") return "ALREADY_PUBLISHED";
        deps.log.warn({ err: (err as Error).message }, "Génération automatique de l’article du jour échouée");
        await prisma.auditLog.create({ data: { action: "DAILY_ARTICLE_AI_FAILED", entity: "Article", entityId: day, metadata: { error: (err as Error).message.slice(0, 500) } } });
        // Une nouvelle tentative IA aura lieu au prochain passage tant que le plafond du jour n'est pas
        // atteint ; au-delà, la réserve d'articles déjà rédigés prend le relais pour ne pas manquer un jour.
        if (failedToday + 1 < MAX_AI_ATTEMPTS_PER_DAY) return "NOTHING_TO_PUBLISH";
      }
    }

    if (!created) {
      const next = await prisma.articleQueueEntry.findFirst({ orderBy: { position: "asc" } });
      if (!next) { deps.log.info({ day }, "Aucun article à publier aujourd’hui (IA indisponible, réserve vide)"); return "NOTHING_TO_PUBLISH"; }
      try {
        created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const article = await tx.article.create({ data: { title: next.title, slug: next.slug, excerpt: next.excerpt, content: next.content, category: next.category, keywords: next.keywords, metaTitle: next.metaTitle, metaDescription: next.metaDescription, imageUrl: next.imageUrl, status: "PUBLISHED", publishedAt: now, autoPublishDay: day } });
          await tx.articleQueueEntry.delete({ where: { id: next.id } });
          return article;
        });
        outcome = "PUBLISHED_QUEUE";
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") return "ALREADY_PUBLISHED";
        throw err;
      }
    }
    await prisma.articleReviewLog.create({ data: { articleId: created!.id, fromStatus: "DRAFT", toStatus: "PUBLISHED", note: outcome === "PUBLISHED_AI" ? "Publication automatique quotidienne (IA)" : "Publication automatique quotidienne (réserve)" } });
    await prisma.auditLog.create({ data: { action: "DAILY_ARTICLE_PUBLISHED", entity: "Article", entityId: created!.id, metadata: { day, outcome } } });
    const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
    await Promise.all(admins.map(a => deps.notify(a.id, "Article du jour publié", `« ${created!.title} » est en ligne. Vous pouvez le consulter ou le supprimer depuis le blog.`, `/admin/blog/${created!.id}`)));
    return outcome;
  } finally {
    running = false;
  }
}
