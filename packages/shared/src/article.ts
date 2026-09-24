// Format du contenu des articles du blog (corrections web 2026-09-24, §3.3) : un Markdown volontairement
// réduit, partagé par l'API (validation d'un article généré avant publication) et le site (rendu).
// Blocs séparés par une ligne vide :
//   ## Titre de section / ### Sous-titre
//   - élément de liste (chaque ligne du bloc commence par « - »)
//   > citation
//   ![texte alternatif](photo:nom)        image de la photothèque du site (PHOTOS côté web)
//   ```chart {json}```                     graphique en barres, source obligatoire
//   [[cta:/events|Voir les soirées]]       appel à l'action vers une page du site
//   paragraphe, avec des liens [libellé](/chemin-interne) ou [libellé](https://source-externe)
// Rétrocompatible : un article ancien (paragraphes et liens seulement) se lit à l'identique.

export type ArticleChart = { title: string; unit?: string; sourceLabel: string; sourceUrl: string; data: { label: string; value: number }[] };
export type ArticleBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "image"; photo: string; alt: string }
  | { type: "chart"; chart: ArticleChart }
  | { type: "cta"; path: string; label: string };

// Pages du site vers lesquelles un article peut renvoyer : uniquement des routes publiques réelles.
export const ARTICLE_INTERNAL_PATHS = ["/events", "/events?category=Speed%20dating", "/events?category=Networking", "/concept", "/blog", "/restaurant"] as const;
export const isAllowedInternalPath = (path: string) => (ARTICLE_INTERNAL_PATHS as readonly string[]).includes(path) || /^\/blog\/[a-z0-9-]+$/.test(path) || /^\/events\/[a-z0-9-]+$/.test(path);

const CHART_FENCE = /^```chart\s*\n?([\s\S]*?)\n?```$/;
const IMAGE = /^!\[([^\]]*)\]\(photo:([a-z0-9-]+)\)$/;
const CTA = /^\[\[cta:([^|\]]+)\|([^\]]+)\]\]$/;

const parseChart = (json: string): ArticleChart | null => {
  try {
    const raw = JSON.parse(json);
    if (typeof raw?.title !== "string" || typeof raw?.sourceUrl !== "string" || typeof raw?.sourceLabel !== "string" || !Array.isArray(raw?.data)) return null;
    if (!/^https:\/\//.test(raw.sourceUrl)) return null;
    const data = raw.data.filter((d: any) => typeof d?.label === "string" && typeof d?.value === "number" && Number.isFinite(d.value)).slice(0, 12);
    if (data.length < 2) return null;
    return { title: raw.title, unit: typeof raw.unit === "string" ? raw.unit : undefined, sourceLabel: raw.sourceLabel, sourceUrl: raw.sourceUrl, data };
  } catch { return null; }
};

export const parseArticleContent = (content: string): ArticleBlock[] => {
  const blocks: ArticleBlock[] = [];
  // Un bloc graphique peut contenir des lignes vides dans son JSON : on le découpe à part.
  const chunks = content.replace(/\r\n/g, "\n").split(/(```chart[\s\S]*?```)/g);
  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk) continue;
    const chart = trimmedChunk.match(CHART_FENCE);
    if (chart) { const parsed = parseChart(chart[1]); if (parsed) blocks.push({ type: "chart", chart: parsed }); continue; }
    for (const part of trimmedChunk.split(/\n{2,}/)) {
      const block = part.trim();
      if (!block) continue;
      let m: RegExpMatchArray | null;
      if (block.startsWith("### ")) blocks.push({ type: "heading", level: 3, text: block.slice(4).trim() });
      else if (block.startsWith("## ")) blocks.push({ type: "heading", level: 2, text: block.slice(3).trim() });
      else if ((m = block.match(IMAGE))) blocks.push({ type: "image", alt: m[1].trim(), photo: m[2] });
      else if ((m = block.match(CTA))) blocks.push({ type: "cta", path: m[1].trim(), label: m[2].trim() });
      else if (block.split("\n").every(line => line.trim().startsWith("- "))) blocks.push({ type: "list", items: block.split("\n").map(line => line.trim().slice(2).trim()) });
      else if (block.split("\n").every(line => line.trim().startsWith(">"))) blocks.push({ type: "quote", text: block.split("\n").map(line => line.trim().replace(/^>\s?/, "")).join(" ") });
      else blocks.push({ type: "paragraph", text: block.replace(/\n/g, " ") });
    }
  }
  return blocks;
};

// Liens présents dans un texte ([libellé](url)), dans l'ordre d'apparition.
export const INLINE_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
export const inlineLinks = (text: string) => [...text.matchAll(INLINE_LINK)].map(m => ({ label: m[1], url: m[2] }));

// Photothèque utilisable dans un article (fichiers sous licence du site, apps/web/public/images,
// crédits dans CREDITS.md) : jamais une image distante d'un tiers, jamais présentée comme la photo
// d'une vraie soirée. Les descriptions servent au choix de l'image par la génération automatique.
export const ARTICLE_PHOTOS: Record<string, string> = {
  "friends-duo": "Deux amies souriantes dans un parc (amitié, lien social)",
  "portrait-woman": "Une jeune femme dans une rue de Paris (confiance en soi, vie urbaine)",
  "portrait-man": "Portrait d'un homme souriant (rencontre, confiance)",
  "networking-pro": "Un homme en costume dans un jardin parisien (carrière, networking)",
  "networking-event": "Des personnes qui échangent lors d'une soirée professionnelle (networking)",
  "shared-table": "Une table garnie de plats à partager (convivialité, repas)",
  "meal-overhead": "Un repas partagé vu du dessus (dîner, partage)",
  "tea-hands": "Des verres de thé servis autour d'une table (conversation, hospitalité)",
  "paris-terrace": "Une terrasse de café parisien animée (sortir, rencontrer)",
  "paris-street": "Une rue de Paris bordée de terrasses (ville, sorties)",
  "bistro-front": "La devanture d'un bistrot parisien (restaurants partenaires)",
  "venue-day": "La salle d'un restaurant en journée (lieu, organisation)",
  "venue-evening": "Un restaurant chaleureux en soirée (soirée, ambiance)"
};

// Réécriture inverse de parseArticleContent : permet à l'API de corriger un article généré (liens non
// vérifiés retirés, blocs invalides supprimés) puis de stocker le même format que celui rendu par le site.
export const serializeArticleBlocks = (blocks: ArticleBlock[]): string => blocks.map(b => {
  switch (b.type) {
    case "heading": return `${b.level === 2 ? "##" : "###"} ${b.text}`;
    case "paragraph": return b.text;
    case "list": return b.items.map(i => `- ${i}`).join("\n");
    case "quote": return `> ${b.text}`;
    case "image": return `![${b.alt}](photo:${b.photo})`;
    case "chart": return "```chart\n" + JSON.stringify(b.chart) + "\n```";
    case "cta": return `[[cta:${b.path}|${b.label}]]`;
  }
}).join("\n\n");
