import type { Prisma, PrismaClient } from "@prisma/client";
import type { AIProvider, CarouselDraft, CarouselDraftSlide } from "../ai-provider.js";
import { sanitizeInstagramCaption } from "./blog-content.js";
import { varietySeed, visualBriefs } from "./image-variety.js";
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
export type SlideContent =
  | { kind: "contrast"; myth: string; reality: string }
  | { kind: "statement"; text: string; highlight: string | null }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "scene"; title: string; text: string }
  | { kind: "stat"; value: string; text: string; source: string }
  | { kind: "chart"; chart: ChartData };
// Photo d'une slide : illustration générée pour elle, ou à défaut un détail recadré de la couverture.
export type SlidePhoto = { imagePrompt: string; image: string | null; altText: string | null; fromCover?: boolean };
export type CarouselSlide = SlideContent & SlidePhoto;
export type CarouselScript = { hook: string; subtitle: string; slides: CarouselSlide[]; cta: { headline: string; detail: string } & SlidePhoto; caption: string | null };
// Au plus 4 illustrations générées par article, en plus de la couverture : coût et durée bornés.
export const MAX_SLIDE_IMAGES = 4;

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
const normalized = (text: string) => plain(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Texte affiché d'une slide (la description d'image, en anglais, n'est jamais affichée).
function slideText(s: SlideContent): string {
  switch (s.kind) {
    case "contrast": return `${s.myth}\n${s.reality}`;
    case "list": return [s.title, ...s.items].join("\n");
    case "scene": return `${s.title}\n${s.text}`;
    case "stat": return `${s.value}\n${s.text}\n${s.source}`;
    case "chart": return "";
    default: return s.text;
  }
}

function parseSlide(s: CarouselDraftSlide, sourceText: string): SlideContent | null {
  switch (s.kind) {
    case "contrast": return s.myth?.trim() && s.reality?.trim() ? { kind: "contrast", myth: oneLine(s.myth, 120), reality: oneLine(s.reality, 150) } : null;
    case "statement": {
      if (!s.text?.trim()) return null;
      const text = oneLine(s.text, 150);
      return { kind: "statement", text, highlight: s.highlight?.trim() && text.includes(s.highlight.trim()) ? s.highlight.trim() : null };
    }
    case "list": {
      const items = (s.items ?? []).map(i => oneLine(i, 70)).filter(Boolean).slice(0, 4);
      return s.title?.trim() && items.length >= 2 ? { kind: "list", title: oneLine(s.title, 50), items } : null;
    }
    case "quote": return s.text?.trim() ? { kind: "quote", text: oneLine(s.text, 130) } : null;
    case "scene": return s.title?.trim() && s.text?.trim() ? { kind: "scene", title: oneLine(s.title, 70), text: oneLine(s.text, 160) } : null;
    case "stat": {
      // Un chiffre n'est montré qu'avec sa source, et seulement si l'article cite cette source.
      const value = oneLine(s.value ?? "", 16), source = oneLine(s.source ?? "", 70);
      if (!/\d/.test(value) || !s.text?.trim() || !source || !sourceText.includes(normalized(source))) return null;
      return { kind: "stat", value, text: oneLine(s.text, 130), source };
    }
    default: return null;
  }
}

/**
 * Texte du carrousel proposé par Claude, validé avant tout usage : longueurs bornées, charte éditoriale,
 * et aucun chiffre qui ne figure pas dans l'article — un carrousel qui en contient un est refusé en
 * entier (on retombe alors sur l'extraction de l'article), jamais publié. Un graphique sourcé de
 * l'article prend la deuxième place, juste après la couverture.
 */
export function parseCarouselScript(draft: CarouselDraft, article: { title: string; excerpt: string | null; content: string }): CarouselScript {
  const sourceText = normalized(`${article.title} ${article.excerpt ?? ""} ${article.content}`);
  const photo = (prompt: string | undefined): SlidePhoto => ({ imagePrompt: prompt?.trim() ?? "", image: null, altText: null });
  const slides: CarouselSlide[] = [];
  const chart = articleCarouselPlan(article).middle.find(m => m.kind === "chart");
  if (chart) slides.push({ ...chart, ...photo("") });
  for (const s of draft.slides ?? []) {
    const content = parseSlide(s, sourceText);
    if (content) slides.push({ ...content, ...photo(s.imagePrompt) });
  }
  const script: CarouselScript = {
    hook: oneLine(draft.hook ?? "", 90) || shortText(article.title, 120),
    subtitle: oneLine(draft.subtitle ?? "", 170),
    slides: slides.slice(0, CAROUSEL_MAX - 2),
    cta: { headline: oneLine(draft.ctaHeadline ?? "", 50) || "Lire l’article complet", detail: oneLine(draft.ctaDetail ?? "", 130) || "Lien en bio", ...photo(draft.ctaImagePrompt) },
    caption: sanitizeInstagramCaption(draft.caption)
  };
  if (script.slides.filter(s => s.kind !== "chart").length < CAROUSEL_MIN - 2) throw new Error("Carrousel trop court");
  const visible = [script.hook, script.subtitle, script.cta.headline, script.cta.detail, script.caption ?? "", ...script.slides.map(slideText)].join("\n");
  if (/musulman/i.test(visible)) throw new Error("Carrousel contraire à la charte éditoriale");
  const source = numbersOf(`${article.title} ${article.excerpt ?? ""} ${article.content}`);
  const invented = [...numbersOf(visible)].filter(n => !source.has(n));
  if (invented.length) throw new Error(`Chiffre absent de l’article : ${invented.join(", ")}`);
  return script;
}

/**
 * Écrans qui reçoivent une photo : jamais deux écrans de suite sans image (la couverture en a toujours
 * une), et toute slide « scene » en a une. Le graphique reste sur fond clair ; il suit la couverture.
 */
export function photoSlots(script: CarouselScript): SlidePhoto[] {
  const slots: SlidePhoto[] = [];
  let previousHasPhoto = true;
  for (const screen of [...script.slides, script.cta]) {
    const kind = "kind" in screen ? screen.kind : "cta";
    const needs: boolean = kind !== "chart" && (kind === "scene" || !previousHasPhoto);
    if (needs) slots.push(screen);
    previousHasPhoto = needs;
  }
  return slots;
}

/** Carrousel enregistré sur l'article, s'il est valide (sinon null : extraction de l'article). */
export function storedCarousel(value: Prisma.JsonValue | null | undefined): CarouselScript | null {
  const v = value as CarouselScript | null;
  return v && typeof v.hook === "string" && Array.isArray(v.slides) && v.slides.length && v.cta ? v : null;
}

type PrepareDeps = {
  aiProvider: AIProvider;
  // Absent (pas de clé OpenAI, ou publication manuelle qui ne doit pas attendre) : détails de la couverture.
  illustrate?: (slide: { title: string; imagePrompt: string }) => Promise<{ image: string; altText: string } | null>;
  log: { warn: (o: unknown, m?: string) => void };
};

/**
 * Prépare une seule fois le carrousel d'un article : texte réécrit par Claude, une illustration générée
 * pour chaque écran qui en demande une (photoSlots, au plus MAX_SLIDE_IMAGES), et la légende courte
 * qui l'accompagne. Une illustration refusée ou au-delà du plafond est remplacée par un détail recadré
 * de la couverture : le rythme « une image tous les deux écrans » est toujours tenu. En cas d'échec du
 * texte, rien n'est enregistré et le carrousel extrait de l'article prend le relais.
 */
export async function prepareArticleCarousel(prisma: PrismaClient, deps: PrepareDeps, articleId: string): Promise<CarouselScript | null> {
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  const existing = storedCarousel(article.instagramCarousel);
  if (existing || !deps.aiProvider.writeCarousel) return existing;
  try {
    // Consignes visuelles n°1 à 7 du jour de publication (la n°0 est celle de la couverture).
    const briefs = visualBriefs(varietySeed(article.publishedAt ?? new Date()), 1, CAROUSEL_MAX - 1);
    // Deux propositions au plus : la seconde connaît la raison du refus de la première (par exemple un
    // chiffre écrit en chiffres alors que l'article l'écrit en lettres).
    let script: CarouselScript | null = null, feedback: string | undefined;
    for (let attempt = 0; attempt < 2 && !script; attempt++) {
      try { script = parseCarouselScript(await deps.aiProvider.writeCarousel(article, briefs, feedback), article); }
      catch (err) { feedback = (err as Error).message; if (attempt === 1) throw err; }
    }
    if (!script) return null;
    for (const [i, slot] of photoSlots(script).entries()) {
      const illustration = slot.imagePrompt && deps.illustrate && i < MAX_SLIDE_IMAGES ? await deps.illustrate({ title: article.title, imagePrompt: slot.imagePrompt }).catch(() => null) : null;
      Object.assign(slot, illustration ? { image: illustration.image, altText: illustration.altText } : { image: article.imageUrl, altText: null, fromCover: true });
    }
    await prisma.article.update({ where: { id: articleId }, data: { instagramCarousel: script as unknown as Prisma.InputJsonValue, ...(script.caption ? { instagramCaption: script.caption } : {}) } });
    return script;
  } catch (err) {
    deps.log.warn({ err: (err as Error).message }, "Carrousel réécrit indisponible, extraction de l’article");
    return null;
  }
}
