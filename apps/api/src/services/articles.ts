import { httpError, prisma } from "../context.js";

// Blog éditorial (§18) : socle éditorial d'abord, jamais de génération autonome en production —
// un brouillon (écrit à la main ou généré par IA) suit toujours DRAFT → IN_REVIEW → APPROVED →
// PUBLISHED, chaque transition journalisée dans ArticleReviewLog, jamais sautée automatiquement.
const FORBIDDEN_WORD = /musulman/i;
export const assertNoForbiddenWord = (...fields: (string | null | undefined)[]) => {
  if (fields.some(f => f && FORBIDDEN_WORD.test(f))) throw httpError(400, "Ce mot n’est pas autorisé sur les pages publiques ou le blog (voir la charte éditoriale).");
};
export const logArticleTransition = (articleId: string, actorId: string | undefined, fromStatus: string, toStatus: string, note?: string) =>
  prisma.articleReviewLog.create({ data: { articleId, actorId, fromStatus: fromStatus as any, toStatus: toStatus as any, note } });
