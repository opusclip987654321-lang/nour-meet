import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import type { AIProvider } from "../ai-provider.js";
import { defaultImagePrompt, type Illustration } from "./article-image.js";
import { varietySeed, visualBrief } from "./image-variety.js";
import { getSetting } from "../settings.js";
import { BLOG_CATEGORIES, MAX_AI_ATTEMPTS_PER_DAY, parisDay, sanitizeGeneratedArticle, sanitizeInstagramCaption, slugifyTitle } from "./blog-content.js";

// Publication automatique quotidienne du blog (corrections web 2026-09-24, §3) — remplace la
// validation manuelle préalable demandée jusque-là. Un article par jour calendaire (Europe/Paris),
// sans doublon : la colonne unique Article.autoPublishDay le garantit au niveau de la base, même si
// deux passages de la tâche se chevauchent ou si le serveur redémarre en pleine génération.
// Dépendances injectées (base, fournisseur IA, notifications) pour être testable sans serveur.
// illustrate, shareOnInstagram et shareOnFacebook sont facultatifs : absents (pas de clé OpenAI, Instagram
// ou Facebook), l'article garde sa photo de la photothèque et n'est pas publié sur ces réseaux. Leurs erreurs ne bloquent jamais le blog.
// prepareCarousel (refonte du 2026-09-26) réécrit le carrousel et ses illustrations une seule fois, avant
// Instagram et Facebook qui le reprennent tel quel ; en cas d'échec, ils extraient le carrousel de l'article.
type Deps = { illustrate?: (article: { title: string; imagePrompt: string }) => Promise<Illustration | null>; prepareCarousel?: (articleId: string) => Promise<unknown>; shareOnInstagram?: (articleId: string) => Promise<unknown>; shareOnFacebook?: (articleId: string) => Promise<unknown>; prisma: PrismaClient; aiProvider: AIProvider; notify: (userId: string, title: string, body: string, link?: string) => Promise<unknown>; log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } };
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
        const { article, searchedUrls } = await aiProvider.generateArticle({ today: now.toLocaleDateString("fr-FR", { dateStyle: "full", timeZone: "Europe/Paris" }), coverBrief: visualBrief(varietySeed(now), 0), categories: BLOG_CATEGORIES, recentTitles: recent.map(r => r.title), upcomingEvents: upcoming });
        const clean = sanitizeGeneratedArticle(article, searchedUrls);
        const { sourcesCount, ...data } = clean;
        const illustration = deps.illustrate ? await deps.illustrate({ title: clean.title, imagePrompt: article.imagePrompt ?? "" }).catch(() => null) : null;
        created = await prisma.article.create({ data: {
          ...data, slug: `${slugifyTitle(clean.title)}-${day.replace(/-/g, "")}`, status: "PUBLISHED", publishedAt: now, autoPublishDay: day, aiGenerated: true,
          aiPrompt: `Publication automatique du ${day} (${article.kind}, ${sourcesCount} source(s) vérifiée(s))`,
          ...(illustration ? { imageUrl: illustration.imageUrl, imageAiGenerated: true } : {}),
          instagramCaption: sanitizeInstagramCaption(article.instagramCaption)
        } });
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
      // Illustration IA aussi pour un article de la réserve : la photothèque n'est qu'un dernier recours.
      const illustration = deps.illustrate ? await deps.illustrate({ title: next.title, imagePrompt: defaultImagePrompt(next, visualBrief(varietySeed(now), 0)) }).catch(() => null) : null;
      try {
        created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Légende de secours, courte : remplacée par celle du carrousel réécrit quand Claude est disponible.
          const caption = sanitizeInstagramCaption(`${next.title}\n\nArticle complet : lien en bio\n\n#nurmeet #rencontres`);
          const article = await tx.article.create({ data: { title: next.title, slug: next.slug, excerpt: next.excerpt, content: next.content, category: next.category, keywords: next.keywords, metaTitle: next.metaTitle, metaDescription: next.metaDescription, imageUrl: illustration?.imageUrl ?? next.imageUrl, imageAiGenerated: !!illustration, status: "PUBLISHED", publishedAt: now, autoPublishDay: day, instagramCaption: caption } });
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
    if (deps.prepareCarousel && (deps.shareOnInstagram || deps.shareOnFacebook)) {
      await deps.prepareCarousel(created!.id).catch(err => deps.log.warn({ err: (err as Error).message }, "Préparation du carrousel échouée"));
    }
    await shareDailyArticle(deps, now);
    return outcome;
  } finally {
    running = false;
  }
}

// Heure de Paris « HH:MM » d'un instant, comparable à SOCIAL_POST_TIME par ordre alphabétique.
const parisTime = (date: Date) => date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Paris" });

export type SocialShareOutcome = "TOO_EARLY" | "NO_ARTICLE" | "DONE";

/**
 * Publication sociale de l'article du jour, séparée de sa mise en ligne (diagnostic du 2026-10-03) :
 * l'article paraît sur le blog dès minuit, son carrousel ne part sur Instagram et Facebook qu'à partir de
 * SOCIAL_POST_TIME, appelée à chaque passage de la tâche. Un seul essai automatique par réseau et par
 * article (tracé dans le journal d'audit) : un échec prévient les administrateurs une fois, sans relance
 * toutes les 30 minutes ; la republication reste possible à la main depuis l'administration.
 */
export async function shareDailyArticle(deps: Pick<Deps, "prisma" | "notify" | "log" | "shareOnInstagram" | "shareOnFacebook">, now: Date = new Date()): Promise<SocialShareOutcome> {
  if (!deps.shareOnInstagram && !deps.shareOnFacebook) return "DONE";
  if (parisTime(now) < getSetting("SOCIAL_POST_TIME")) return "TOO_EARLY";
  const { prisma } = deps;
  const article = await prisma.article.findUnique({ where: { autoPublishDay: parisDay(now) }, select: { id: true, title: true, status: true } });
  if (!article || article.status !== "PUBLISHED") return "NO_ARTICLE";
  const networks = [["Instagram", deps.shareOnInstagram], ["Facebook", deps.shareOnFacebook]] as const;
  for (const [network, share] of networks) {
    if (!share) continue;
    const action = `DAILY_ARTICLE_${network.toUpperCase()}_ATTEMPT`;
    if (await prisma.auditLog.count({ where: { action, entityId: article.id } })) continue;
    await prisma.auditLog.create({ data: { action, entity: "Article", entityId: article.id } });
    try { await share(article.id); }
    catch (err) {
      deps.log.warn({ err: (err as Error).message }, `Publication ${network} de l’article du jour échouée`);
      const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
      await Promise.all(admins.map(a => deps.notify(a.id, `Publication ${network} échouée`, `« ${article.title} » est en ligne sur le site, mais pas sur ${network} : ${(err as Error).message.slice(0, 200)}`, `/admin/blog/${article.id}`)));
    }
  }
  return "DONE";
}
