import { UserRole, type Prisma, type PrismaClient } from "@prisma/client";
import type { MediaInsights } from "./instagram.js";

// Boucle d'apprentissage des carrousels Instagram (diagnostic du 2026-10-03) : chaque carrousel teste
// une combinaison de choix éditoriaux, ses statistiques sont relevées pendant sa première semaine, et
// les choix suivants privilégient ce qui a fait grandir le compte, tout en gardant une part d'essais
// pour ne jamais se figer sur un premier résultat chanceux. Le score récompense d'abord ce qui amène
// du monde sur le compte (abonnements, visites du profil), puis ce qui fait circuler le post.

export const VARIANT_OPTIONS = {
  hook: {
    question: "une question directe, en « tu », qui pique là où ça fait mal (« Pourquoi tu attires toujours le même genre de personne ? »)",
    liste: "une promesse de liste, avec le nombre écrit en lettres et égal au nombre réel de points des slides (« Trois signes que tu n'es pas fait(e) pour les applis »)",
    pov: "un « POV : » suivi d'une situation vécue que le lecteur reconnaît immédiatement (« POV : ta mère te demande encore quand tu te maries »)",
    verite: "une vérité qui dérange, contre-intuitive, affirmée sans détour (« Être exigeant(e) n'est pas ton problème. »)",
    scene: "une scène vécue en une phrase, à la deuxième personne, qui installe une tension (« Tu rentres d'un mariage. Encore seul(e). »)"
  },
  register: {
    emotion: "émotion forte : ce que le lecteur ressent et n'ose pas dire, sans pathos",
    tension: "tension et petit drama du quotidien : malaise, pression, situation qui fâche, avec le retournement à la fin",
    humour: "humour et autodérision : situations gênantes ou absurdes que tout le monde a vécues",
    direct: "conseil cash, franc et concret, comme un ami qui te dit enfin la vérité"
  },
  cta: {
    save: "pousser à ENREGISTRER le post pour le relire au bon moment",
    share: "pousser à ENVOYER le post à une personne précise (« Envoie-le à la personne qui… »)",
    comment: "pousser à COMMENTER avec une question simple qui appelle une réponse en un mot ou une anecdote",
    follow: "pousser à S'ABONNER au compte pour la suite (nouveaux posts et soirées)"
  }
} as const;

export type Dimension = keyof typeof VARIANT_OPTIONS;
export type CarouselVariant = { [D in Dimension]: keyof (typeof VARIANT_OPTIONS)[D] };
const DIMENSIONS = Object.keys(VARIANT_OPTIONS) as Dimension[];

// Part des choix tirés au hasard, même quand un gagnant se dégage : de quoi suivre l'évolution du public.
export const EXPLORATION_RATE = 0.25;
// Un choix n'est jugé qu'après deux carrousels mesurés ; avant, il passe en priorité pour être essayé.
const MIN_SAMPLES = 2;
// Fenêtre d'apprentissage : les goûts du public bougent, les vieux résultats finissent par sortir.
const LEARNING_WINDOW_DAYS = 60;

/** Score d'un carrousel : interactions pondérées pour 1 000 comptes touchés (portée plancher de 50). */
export function carouselScore(i: MediaInsights): number {
  const weighted = 5 * (i.follows ?? 0) + 2 * (i.profile_visits ?? 0) + 3 * (i.shares ?? 0) + 2 * (i.saved ?? 0) + (i.comments ?? 0) + 0.2 * (i.likes ?? 0);
  return Math.round((1000 * weighted / Math.max(i.reach ?? 0, 50)) * 10) / 10;
}

type Scored = { variant: CarouselVariant; score: number };

const isVariant = (v: unknown): v is CarouselVariant => !!v && typeof v === "object" && DIMENSIONS.every(d => typeof (v as Record<string, unknown>)[d] === "string");

/**
 * Choix du prochain carrousel, dimension par dimension (bandit « epsilon-greedy ») : un choix pas encore
 * assez essayé passe d'abord ; sinon, le meilleur score moyen, sauf tirage d'exploration.
 */
export function chooseVariant(history: Scored[], random: () => number = Math.random): CarouselVariant {
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length) % list.length];
  const variant = {} as Record<Dimension, string>;
  for (const d of DIMENSIONS) {
    const options = Object.keys(VARIANT_OPTIONS[d]);
    const stats = options.map(o => {
      const scores = history.filter(h => h.variant[d] === o).map(h => h.score);
      return { o, n: scores.length, mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0 };
    });
    const untried = stats.filter(s => s.n < MIN_SAMPLES);
    if (untried.length) variant[d] = pick(untried).o;
    else if (random() < EXPLORATION_RATE) variant[d] = pick(options);
    else variant[d] = stats.reduce((best, s) => (s.mean > best.mean ? s : best)).o;
  }
  return variant as CarouselVariant;
}

/** Consigne d'écriture correspondant aux choix du jour, ajoutée au message envoyé à Claude. */
export const variantInstructions = (v: CarouselVariant) =>
  `Choix imposés pour ce carrousel (test en cours, respecte-les) :\n- accroche de couverture : ${VARIANT_OPTIONS.hook[v.hook as keyof typeof VARIANT_OPTIONS.hook]}\n- registre : ${VARIANT_OPTIONS.register[v.register as keyof typeof VARIANT_OPTIONS.register]}\n- appel à l'action final (ctaHeadline, ctaDetail et fin de légende) : ${VARIANT_OPTIONS.cta[v.cta as keyof typeof VARIANT_OPTIONS.cta]}`;

type ScoredArticle = { title: string; instagramCarousel: Prisma.JsonValue | null; instagramVariant: Prisma.JsonValue | null; instagramScore: number | null; instagramInsights: Prisma.JsonValue | null };

async function scoredArticles(prisma: PrismaClient, now: Date, days = LEARNING_WINDOW_DAYS): Promise<ScoredArticle[]> {
  return prisma.article.findMany({
    where: { instagramScore: { not: null }, instagramPublishedAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    orderBy: { instagramPublishedAt: "desc" },
    select: { title: true, instagramCarousel: true, instagramVariant: true, instagramScore: true, instagramInsights: true }
  });
}

const hookOf = (a: ScoredArticle) => ((a.instagramCarousel as { hook?: unknown } | null)?.hook as string | undefined) ?? a.title;
const describe = (a: ScoredArticle) => {
  const v = isVariant(a.instagramVariant) ? ` [accroche ${a.instagramVariant.hook}, registre ${a.instagramVariant.register}, CTA ${a.instagramVariant.cta}]` : "";
  return `« ${hookOf(a)} »${v} : score ${a.instagramScore}`;
};

/**
 * Prépare le carrousel du jour : choix à tester, et rappel des meilleurs et des pires carrousels récents
 * (accroche et score) pour que Claude reprenne ce qui accroche et évite ce qui a fait un flop.
 */
export async function carouselGuidance(prisma: PrismaClient, now: Date = new Date(), random: () => number = Math.random): Promise<{ variant: CarouselVariant; guidance: string }> {
  const scored = await scoredArticles(prisma, now);
  const variant = chooseVariant(scored.filter(a => isVariant(a.instagramVariant)).map(a => ({ variant: a.instagramVariant as CarouselVariant, score: a.instagramScore! })), random);
  let guidance = variantInstructions(variant);
  if (scored.length >= 4) {
    const ranked = [...scored].sort((a, b) => b.instagramScore! - a.instagramScore!);
    guidance += `\n\nRésultats réels des derniers carrousels sur Instagram (score = interactions qui font grandir le compte, pour 1 000 comptes touchés).\nCeux qui ont le mieux marché, inspire-toi de leur façon d'accrocher (sans les copier) :\n${ranked.slice(0, 3).map(a => `- ${describe(a)}`).join("\n")}\nCeux qui ont fait un flop, évite ce style :\n${ranked.slice(-3).reverse().map(a => `- ${describe(a)}`).join("\n")}`;
  }
  return { variant, guidance };
}

type CollectDeps = { prisma: PrismaClient; fetchInsights: (mediaId: string) => Promise<MediaInsights>; log: { warn: (o: unknown, m?: string) => void } };

/**
 * Relevé quotidien des statistiques de chaque carrousel pendant sa première semaine (de 20 h à 8 jours
 * après publication) : le score se stabilise, puis le carrousel n'est plus relevé. Un échec (jeton sans
 * permission de lecture des statistiques, panne) n'arrête pas les autres relevés.
 */
export async function collectCarouselInsights(deps: CollectDeps, now: Date = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - 20 * 3_600_000);
  const due = await deps.prisma.article.findMany({
    where: { instagramMediaId: { not: null }, instagramPublishedAt: { lte: dayAgo, gte: new Date(now.getTime() - 8 * 86_400_000) }, OR: [{ instagramInsightsAt: null }, { instagramInsightsAt: { lte: dayAgo } }] },
    select: { id: true, instagramMediaId: true }
  });
  let collected = 0;
  for (const article of due) {
    try {
      const insights = await deps.fetchInsights(article.instagramMediaId!);
      await deps.prisma.article.update({ where: { id: article.id }, data: { instagramInsights: insights as Prisma.InputJsonValue, instagramInsightsAt: now, instagramScore: carouselScore(insights) } });
      collected++;
    } catch (err) {
      deps.log.warn({ err: (err as Error).message, articleId: article.id }, "Relevé des statistiques Instagram échoué");
    }
  }
  return collected;
}

type ReportDeps = { prisma: PrismaClient; notify: (userId: string, title: string, body: string, link?: string) => Promise<unknown> };

/** Bilan hebdomadaire envoyé aux administrateurs le lundi : meilleur et pire carrousel des 7 derniers jours. */
export async function weeklyCarouselReport(deps: ReportDeps, now: Date = new Date()): Promise<boolean> {
  const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / (7 * 86_400_000))}`;
  if (now.getUTCDay() !== 1 || await deps.prisma.auditLog.count({ where: { action: "CAROUSEL_WEEKLY_REPORT", entityId: week } })) return false;
  const scored = (await scoredArticles(deps.prisma, now, 7)).sort((a, b) => b.instagramScore! - a.instagramScore!);
  await deps.prisma.auditLog.create({ data: { action: "CAROUSEL_WEEKLY_REPORT", entity: "Article", entityId: week } });
  if (!scored.length) return false;
  const reach = (a: ScoredArticle) => (a.instagramInsights as MediaInsights | null)?.reach ?? 0;
  const follows = scored.reduce((sum, a) => sum + ((a.instagramInsights as MediaInsights | null)?.follows ?? 0), 0);
  const body = `${scored.length} carrousel(s) mesuré(s), ${follows} abonnement(s) gagné(s). Meilleur : ${describe(scored[0])}, ${reach(scored[0])} comptes touchés.${scored.length > 1 ? ` Moins bon : ${describe(scored[scored.length - 1])}.` : ""}`;
  const admins = await deps.prisma.user.findMany({ where: { role: UserRole.ADMIN } });
  await Promise.all(admins.map(a => deps.notify(a.id, "Bilan Instagram de la semaine", body, "/admin/blog")));
  return true;
}
