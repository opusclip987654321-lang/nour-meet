import { ARTICLE_PHOTOS, ArticleBlock, INLINE_LINK, isAllowedInternalPath, parseArticleContent, serializeArticleBlocks } from "@nour/shared";
import type { GeneratedArticle } from "../ai-provider.js";

// Contrôle automatique des articles générés (corrections web 2026-09-24, §3.3/§3.4). Fonctions pures,
// sans accès à la base : testées unitairement (blog-content.test.ts).

export const BLOG_CATEGORIES = ["Rencontres amoureuses", "Amitié", "Solitude et vie sociale", "Networking professionnel"];
export const parisDay = (date: Date = new Date()) => date.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
export const MAX_AI_ATTEMPTS_PER_DAY = 3;

const normalizeUrl = (url: string) => { try { const u = new URL(url); u.hash = ""; return u.toString().replace(/\/$/, ""); } catch { return null; } };

export class ArticleRejected extends Error {}

// Contrôle éditorial automatique avant publication, en l'absence de relecture humaine : seules
// survivent les sources que la recherche web a réellement renvoyées (jamais une URL inventée), les
// liens internes vers de vraies pages du site, les images de la photothèque et les graphiques dont
// la source est vérifiée. Un article factuel sans aucune source vérifiée est refusé.
export function sanitizeGeneratedArticle(article: GeneratedArticle, searchedUrls: string[]) {
  const verified = new Set(searchedUrls.map(normalizeUrl).filter((u): u is string => !!u));
  const isVerified = (url: string) => { const n = normalizeUrl(url); return !!n && verified.has(n); };
  const cleanLinks = (text: string) => text.replace(INLINE_LINK, (whole, label: string, url: string) => {
    if (url.startsWith("/")) return isAllowedInternalPath(url) ? whole : label;
    return /^https:\/\//.test(url) && isVerified(url) ? whole : label;
  });
  const blocks: ArticleBlock[] = [];
  for (const block of parseArticleContent(article.content)) {
    if (block.type === "image") { if (ARTICLE_PHOTOS[block.photo] && block.alt) blocks.push(block); continue; }
    if (block.type === "chart") { if (isVerified(block.chart.sourceUrl)) blocks.push(block); continue; }
    if (block.type === "cta") { if (isAllowedInternalPath(block.path)) blocks.push(block); continue; }
    if (block.type === "heading" && /^sources?$/i.test(block.text.trim())) continue;
    if (block.type === "list") { blocks.push({ ...block, items: block.items.map(cleanLinks) }); continue; }
    if (block.type === "paragraph" || block.type === "quote") { blocks.push({ ...block, text: cleanLinks(block.text) }); continue; }
    blocks.push(block);
  }
  const seen = new Set<string>();
  const sources = article.sources.filter(s => /^https:\/\//.test(s.url) && isVerified(s.url) && !seen.has(normalizeUrl(s.url)!) && seen.add(normalizeUrl(s.url)!));
  const citedInText = blocks.some(b => (b.type === "paragraph" || b.type === "list" || b.type === "quote") && /\]\(https:\/\//.test(b.type === "list" ? b.items.join(" ") : b.text));
  if (article.kind === "factual" && sources.length === 0 && !citedInText) throw new ArticleRejected("Article factuel sans aucune source vérifiée par la recherche web");
  if (/musulman/i.test([article.title, article.excerpt, article.metaTitle, article.metaDescription, article.content].join(" "))) throw new ArticleRejected("Mot interdit par la charte éditoriale");
  const words = serializeArticleBlocks(blocks).split(/\s+/).length;
  if (words < 500) throw new ArticleRejected(`Article trop court (${words} mots)`);
  if (sources.length > 0) blocks.push({ type: "heading", level: 2, text: "Sources" }, { type: "list", items: sources.map(s => `[${s.title.replace(/[[\]]/g, "")}](${s.url})`) });
  return {
    title: article.title.trim().slice(0, 200),
    excerpt: article.excerpt.trim().slice(0, 400),
    content: serializeArticleBlocks(blocks),
    category: BLOG_CATEGORIES.includes(article.category) ? article.category : BLOG_CATEGORIES[0],
    keywords: article.keywords.map(k => k.toLowerCase().trim()).filter(Boolean).slice(0, 10),
    metaTitle: article.metaTitle.trim().slice(0, 70),
    metaDescription: article.metaDescription.trim().slice(0, 160),
    imageUrl: ARTICLE_PHOTOS[article.coverPhoto] ? `photo:${article.coverPhoto}` : null,
    sourcesCount: sources.length
  };
}

export const slugifyTitle = (title: string) => title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);

