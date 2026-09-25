import type { ChartData } from "./social-visuals.js";

// Contenu du carrousel Instagram d'un article (décision v2 §6) : 4 à 8 slides, peu de texte, tout
// repris de l'article lui-même — intertitres, premières phrases, chapô. Aucun chiffre n'est produit
// ici : un graphique n'apparaît que si l'article contient un bloc « chart » sourcé, repris tel quel.

export const CAROUSEL_MIN = 4;
export const CAROUSEL_MAX = 8;
const BODY_MAX = 190;

export type CarouselMiddle = { kind: "point"; heading: string; body: string } | { kind: "chart"; chart: ChartData };
export type CarouselPlan = { title: string; label: string; middle: CarouselMiddle[] };

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
