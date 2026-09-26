import type { Prisma, PrismaClient } from "@prisma/client";
import type { AIProvider, CarouselDraft } from "../ai-provider.js";
import { sanitizeInstagramCaption } from "./blog-content.js";
import type { ChartData } from "./social-visuals.js";

// Contenu du carrousel Instagram d'un article (décision v2 §6) : 4 à 8 slides, peu de texte, tout
// repris de l'article lui-même — intertitres, premières phrases, chapô. Aucun chiffre n'est produit
// ici : un graphique n'apparaît que si l'article contient un bloc « chart » sourcé, repris tel quel.

export const CAROUSEL_MIN = 4;
export const CAROUSEL_MAX = 8;
const BODY_MAX = 190;

export type CarouselMiddle = { kind: "point"; heading: string; body: string } | { kind: "chart"; chart: ChartData };
export type CarouselPlan = { title: string; label: string; middle: CarouselMiddle[] };

// Carrousel réécrit (refonte du 2026-09-26) : formats variés au lieu du même gabarit répété.
export type CarouselSlide =
  | { kind: "contrast"; myth: string; reality: string }
  | { kind: "statement"; text: string; highlight: string | null }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "scene"; title: string; text: string; imagePrompt: string; image: string | null; altText: string | null };
export type CarouselScript = { hook: string; subtitle: string; slides: CarouselSlide[]; ctaHeadline: string; ctaDetail: string; caption: string | null };
// Au plus 2 illustrations supplémentaires par article (en plus de la couverture) : coût et durée bornés.
export const MAX_SCENE_IMAGES = 2;

// Texte brut d'un bloc Markdown réduit : liens, gras et italique ramenés à leur libellé.
const plain = (text: string) => text
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[\[cta:[^\]]*\]\]/g, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/(\*\*|__|\*|_)(.+?)\1/g, "$2")
  .replace(/\s+/g, " ")
  .trim();

/** Premières phrases entières tenant dans `max` caractères ; à défaut, coupe au dernier mot + « … ». */
export function shortText(text: string, max = BODY_MAX): string {
  const clean = plain(text);
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?…]+[.!?…]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) { if ((out + s).trim().length > max) break; out += s; }
  if (out.trim()) return out.trim();
  return `${clean.slice(0, max + 1).replace(/\s+\S*$/, "")}…`;
}

const isParagraph = (block: string) => !/^(#|- |> |!\[|```|\[\[cta:)/.test(block);

function parseChart(block: string): ChartData | null {
  const match = block.match(/^```chart\s*\n([\s\S]*?)\n```$/);
  if (!match) return null;
  try {
    const chart = JSON.parse(match[1]) as ChartData;
    const data = (chart.data ?? []).filter(d => typeof d.label === "string" && typeof d.value === "number" && Number.isFinite(d.value) && d.value >= 0);
    // Sans source nommée ni au moins deux valeurs, pas de graphique : on ne montre jamais un chiffre orphelin.
    if (!chart.title || !chart.sourceLabel || data.length < 2) return null;
    return { title: chart.title, unit: chart.unit, sourceLabel: chart.sourceLabel, data };
  } catch { return null; }
}

/** Plan du carrousel : couverture + slides intermédiaires (2 à 6) ; la slide finale est l'appel à l'action. */
export function articleCarouselPlan(article: { title: string; excerpt: string | null; content: string; category?: string | null }): CarouselPlan {
  const blocks = article.content.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const points: CarouselMiddle[] = [];
  let chart: ChartData | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!chart && block.startsWith("```chart")) chart = parseChart(block);
    const heading = block.match(/^##\s+(.+)$/)?.[1];
    if (!heading) continue;
    // Corps : premier paragraphe ou premiers éléments de liste de la section.
    let body = "";
    for (let j = i + 1; j < blocks.length && !blocks[j].startsWith("## "); j++) {
      if (isParagraph(blocks[j])) { body = shortText(blocks[j]); break; }
      if (blocks[j].startsWith("- ")) { body = shortText(blocks[j].split("\n").slice(0, 3).map(l => l.replace(/^- /, "").trim()).join(" · ")); break; }
    }
    points.push({ kind: "point", heading: shortText(heading.replace(/^#+\s*/, ""), 90), body });
  }
  const middle: CarouselMiddle[] = [];
  if (article.excerpt) middle.push({ kind: "point", heading: "L’essentiel", body: shortText(article.excerpt) });
  middle.push(...points);
  if (chart) middle.splice(Math.min(2, middle.length), 0, { kind: "chart", chart });
  // Article sans intertitres : les premiers paragraphes prennent le relais, jamais du texte ajouté.
  if (middle.length < CAROUSEL_MIN - 2) {
    for (const p of blocks.filter(isParagraph)) {
      if (middle.length >= CAROUSEL_MIN - 2) break;
      const body = shortText(p);
      if (body && !middle.some(m => m.kind === "point" && m.body === body)) middle.push({ kind: "point", heading: middle.length === 0 ? "L’essentiel" : "À retenir", body });
    }
  }
  return { title: shortText(article.title, 120), label: article.category ? `Journal Nūr Meet · ${article.category}` : "Journal Nūr Meet", middle: middle.slice(0, CAROUSEL_MAX - 2) };
}

const NUMBER = /\d+(?:[.,]\d+)?/g;
const numbersOf = (text: string) => new Set((text.match(NUMBER) ?? []).map(n => n.replace(",", ".")));
const oneLine = (text: string, max: number) => shortText(text.replace(/^["«»“”\s]+|["«»“”\s]+$/g, ""), max);

// Texte affiché d'une slide (la description d'image, en anglais, n'est jamais affichée).
const slideText = (s: CarouselSlide) =>
  s.kind === "contrast" ? `${s.myth}\n${s.reality}` : s.kind === "list" ? [s.title, ...s.items].join("\n") : s.kind === "scene" ? `${s.title}\n${s.text}` : s.text;

/**
 * Texte du carrousel proposé par Claude, validé avant tout usage : longueurs bornées, charte éditoriale,
 * et aucun chiffre qui ne figure pas dans l'article — un carrousel qui en contient un est refusé en
 * entier (on retombe alors sur l'extraction de l'article), jamais publié.
 */
export function parseCarouselScript(draft: CarouselDraft, article: { title: string; excerpt: string | null; content: string }): CarouselScript {
  const slides: CarouselSlide[] = [];
  let scenes = 0;
  for (const s of draft.slides ?? []) {
    if (s.kind === "contrast" && s.myth?.trim() && s.reality?.trim()) slides.push({ kind: "contrast", myth: oneLine(s.myth, 120), reality: oneLine(s.reality, 150) });
    else if (s.kind === "statement" && s.text?.trim()) {
      const text = oneLine(s.text, 150);
      slides.push({ kind: "statement", text, highlight: s.highlight?.trim() && text.includes(s.highlight.trim()) ? s.highlight.trim() : null });
    } else if (s.kind === "list" && s.title?.trim()) {
      const items = (s.items ?? []).map(i => oneLine(i, 70)).filter(Boolean).slice(0, 4);
      if (items.length >= 2) slides.push({ kind: "list", title: oneLine(s.title, 50), items });
    } else if (s.kind === "quote" && s.text?.trim()) slides.push({ kind: "quote", text: oneLine(s.text, 130) });
    else if (s.kind === "scene" && s.title?.trim() && s.text?.trim()) {
      // Au-delà du plafond, le point fort reste, sans image demandée.
      const imagePrompt = scenes < MAX_SCENE_IMAGES ? s.imagePrompt?.trim() ?? "" : "";
      if (imagePrompt) scenes++;
      slides.push({ kind: "scene", title: oneLine(s.title, 70), text: oneLine(s.text, 160), imagePrompt, image: null, altText: null });
    }
  }
  const script: CarouselScript = {
    hook: oneLine(draft.hook ?? "", 90) || shortText(article.title, 120),
    subtitle: oneLine(draft.subtitle ?? "", 170),
    slides: slides.slice(0, CAROUSEL_MAX - 3),
    ctaHeadline: oneLine(draft.ctaHeadline ?? "", 50) || "Lire l’article complet",
    ctaDetail: oneLine(draft.ctaDetail ?? "", 130) || "Lien en bio",
    caption: sanitizeInstagramCaption(draft.caption)
  };
  if (script.slides.length < CAROUSEL_MIN - 2) throw new Error("Carrousel trop court");
  const visible = [script.hook, script.subtitle, script.ctaHeadline, script.ctaDetail, script.caption ?? "", ...script.slides.map(slideText)].join("\n");
  if (/musulman/i.test(visible)) throw new Error("Carrousel contraire à la charte éditoriale");
  const source = numbersOf(`${article.title} ${article.excerpt ?? ""} ${article.content}`);
  const invented = [...numbersOf(visible)].filter(n => !source.has(n));
  if (invented.length) throw new Error(`Chiffre absent de l’article : ${invented.join(", ")}`);
  return script;
}

/** Carrousel enregistré sur l'article, s'il est valide (sinon null : extraction de l'article). */
export function storedCarousel(value: Prisma.JsonValue | null | undefined): CarouselScript | null {
  const v = value as CarouselScript | null;
  return v && typeof v.hook === "string" && Array.isArray(v.slides) && v.slides.length ? v : null;
}

type PrepareDeps = {
  aiProvider: AIProvider;
  // Absent (pas de clé OpenAI, ou publication manuelle qui ne doit pas attendre) : slides sans image.
  illustrate?: (slide: { title: string; imagePrompt: string }) => Promise<{ image: string; altText: string } | null>;
  log: { warn: (o: unknown, m?: string) => void };
};

/**
 * Prépare une seule fois le carrousel d'un article : texte réécrit par Claude, puis une illustration
 * par slide « scene » (au plus MAX_SCENE_IMAGES), et la légende courte qui l'accompagne. En cas
 * d'échec, rien n'est enregistré et le carrousel extrait de l'article prend le relais.
 */
export async function prepareArticleCarousel(prisma: PrismaClient, deps: PrepareDeps, articleId: string): Promise<CarouselScript | null> {
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  const existing = storedCarousel(article.instagramCarousel);
  if (existing || !deps.aiProvider.writeCarousel) return existing;
  try {
    const script = parseCarouselScript(await deps.aiProvider.writeCarousel(article), article);
    for (const slide of script.slides) {
      if (slide.kind !== "scene" || !slide.imagePrompt || !deps.illustrate) continue;
      const illustration = await deps.illustrate({ title: `${article.title} — ${slide.title}`, imagePrompt: slide.imagePrompt }).catch(() => null);
      if (illustration) Object.assign(slide, { image: illustration.image, altText: illustration.altText });
    }
    await prisma.article.update({ where: { id: articleId }, data: { instagramCarousel: script as unknown as Prisma.InputJsonValue, ...(script.caption ? { instagramCaption: script.caption } : {}) } });
    return script;
  } catch (err) {
    deps.log.warn({ err: (err as Error).message }, "Carrousel réécrit indisponible, extraction de l’article");
    return null;
  }
}
