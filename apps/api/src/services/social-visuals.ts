import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Visuels Instagram (décision v2 §6 et §14) : carrés 1080 × 1080, texte toujours ajouté par programme
// (jamais demandé au générateur d'images), polices de la marque embarquées dans l'API — l'image Docker
// Alpine n'a aucune police système. Chaque bloc de texte est réduit jusqu'à tenir dans sa zone : aucun
// débordement, aucune coupure au milieu d'un mot.

const SIZE = 1080;
const MARGIN = 88;
const fontsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");
const FONTS = {
  display: { family: "Bricolage Grotesque", file: path.join(fontsDir, "BricolageGrotesque.ttf") },
  text: { family: "Hanken Grotesk", file: path.join(fontsDir, "HankenGrotesk.ttf") }
};
// Couleurs de apps/web/src/styles/tokens.css (mode clair), seules valeurs reprises ici.
export const BRAND = { night: "#1c2653", night3: "#121a3d", saffron: "#f2a33a", saffronInk: "#8a4b00", onSaffron: "#15171c", onNight: "#ffffff", onNight2: "#c8cde4", onNightLine: "#3a4579", canvas: "#f6f6f8", ink: "#15171c", ink2: "#474c58" };

const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type TextOptions = { font: keyof typeof FONTS; size: number; color: string; width: number; maxHeight: number; weight?: number; align?: "left" | "centre" | "right"; minSize?: number; italic?: boolean; strike?: boolean; letterSpacing?: number; highlight?: { text: string; color: string } | null };
type Layer = { input: Buffer; top: number; left: number };

/** Bloc de texte rendu en PNG transparent, réduit par paliers jusqu'à tenir dans maxHeight. */
export async function textBlock(text: string, options: TextOptions): Promise<{ input: Buffer; width: number; height: number }> {
  const font = FONTS[options.font];
  // Mot mis en couleur (slide de recadrage) : cherché dans le texte brut, puis chaque morceau échappé à
  // part — jamais une recherche dans le texte échappé, qui pourrait couper une entité (&amp;).
  const at = options.highlight?.text ? text.indexOf(options.highlight.text) : -1;
  const inner = at < 0 ? escapeMarkup(text) : `${escapeMarkup(text.slice(0, at))}<span foreground="${options.highlight!.color}">${escapeMarkup(options.highlight!.text)}</span>${escapeMarkup(text.slice(at + options.highlight!.text.length))}`;
  const attributes = [`foreground="${options.color}"`, options.weight && `weight="${options.weight}"`, options.italic && `style="italic"`, options.strike && `strikethrough="true"`, options.letterSpacing && `letter_spacing="${options.letterSpacing * 1024}"`].filter(Boolean).join(" ");
  const markup = `<span ${attributes}>${inner}</span>`;
  for (let size = options.size; ; size -= 4) {
    const { data, info } = await sharp({ text: { text: markup, font: `${font.family} ${size}`, fontfile: font.file, width: options.width, rgba: true, dpi: 72, align: options.align ?? "left", wrap: "word", spacing: Math.round(size * 0.18) } }).png().toBuffer({ resolveWithObject: true });
    if (info.height <= options.maxHeight || size - 4 < (options.minSize ?? 24)) return { input: data, width: info.width, height: info.height };
  }
}

const solid = (color: string) => sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: color } });
const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${body}</svg>`);
const toJpeg = (image: sharp.Sharp, layers: Layer[]) => image.composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();

// Signature commune en bas de chaque slide : marque et, pour un carrousel, la position (2/6).
async function footer(color: string, position?: string): Promise<Layer[]> {
  const brand = await textBlock("Nūr Meet", { font: "display", size: 34, weight: 700, color, width: 400, maxHeight: 60 });
  const layers: Layer[] = [{ input: brand.input, top: SIZE - MARGIN - brand.height + 10, left: MARGIN }];
  if (position) {
    const pos = await textBlock(position, { font: "text", size: 30, color, width: 200, maxHeight: 50, align: "right" });
    layers.push({ input: pos.input, top: SIZE - MARGIN - pos.height + 10, left: SIZE - MARGIN - pos.width });
  }
  return layers;
}

/** Couverture : photo plein cadre, dégradé sombre en haut (rubrique lisible) et en bas, accroche et sous-titre. */
export async function coverSlide(background: Buffer, title: string, label: string, position?: string, subtitle?: string) {
  const base = sharp(background).resize(SIZE, SIZE, { fit: "cover", position: "attention" });
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BRAND.night3}" stop-opacity="0.6"/><stop offset="0.22" stop-color="${BRAND.night3}" stop-opacity="0"/><stop offset="0.52" stop-color="${BRAND.night3}" stop-opacity="0.55"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.95"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  const labelBlock = await textBlock(label.toUpperCase(), { font: "text", size: 24, weight: 700, color: BRAND.saffron, width: SIZE - 2 * MARGIN, maxHeight: 40, letterSpacing: 2 });
  const titleBlock = await textBlock(title, { font: "display", size: 76, weight: 800, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: subtitle ? 340 : 420, minSize: 44 });
  const sub = subtitle ? await textBlock(subtitle, { font: "text", size: 32, color: BRAND.onNight2, width: 820, maxHeight: 150, minSize: 24 }) : null;
  const subTop = SIZE - MARGIN - 90 - (sub?.height ?? 0);
  const titleTop = subTop - (sub ? 28 : 0) - titleBlock.height;
  return toJpeg(base, [
    { input: shade, top: 0, left: 0 },
    { input: labelBlock.input, top: MARGIN, left: MARGIN },
    { input: titleBlock.input, top: titleTop, left: MARGIN },
    ...(sub ? [{ input: sub.input, top: subTop, left: MARGIN }] : []),
    ...await footer(BRAND.onNight, position)
  ]);
}

// Gabarits du carrousel réécrit (refonte du 2026-09-26, maquette « Carrousel Nūr Meet — nouvelle
// version ») : chaque format a son fond et sa mise en page, pour ne plus répéter la même slide.

/** Contraste « idée reçue / en réalité » : bandeau bleu nuit barré, puis la réponse sur fond safran. */
export async function contrastSlide(myth: string, reality: string, position: string) {
  const TOP = 460, PAD = 64;
  const mythLabel = await textBlock("CE QU’ON ENTEND", { font: "text", size: 22, weight: 700, color: BRAND.onNight2, width: 600, maxHeight: 40, letterSpacing: 2 });
  const mythText = await textBlock(`« ${myth} »`, { font: "display", size: 48, weight: 700, color: BRAND.onNight2, width: SIZE - 2 * MARGIN, maxHeight: TOP - 2 * PAD - mythLabel.height - 20, minSize: 30, italic: true, strike: true });
  const realLabel = await textBlock("EN RÉALITÉ", { font: "text", size: 22, weight: 800, color: BRAND.saffronInk, width: 600, maxHeight: 40, letterSpacing: 2 });
  const realText = await textBlock(reality, { font: "display", size: 52, weight: 800, color: BRAND.onSaffron, width: SIZE - 2 * MARGIN, maxHeight: SIZE - TOP - 2 * PAD - 90 - realLabel.height, minSize: 32 });
  const mythTop = Math.round((TOP - mythLabel.height - 20 - mythText.height) / 2);
  const realTop = TOP + Math.round((SIZE - TOP - 90 - realLabel.height - 20 - realText.height) / 2);
  return toJpeg(solid(BRAND.saffron), [
    { input: svg(`<rect width="${SIZE}" height="${TOP}" fill="${BRAND.night}"/>`), top: 0, left: 0 },
    { input: mythLabel.input, top: mythTop, left: MARGIN },
    { input: mythText.input, top: mythTop + mythLabel.height + 20, left: MARGIN },
    { input: realLabel.input, top: realTop, left: MARGIN },
    { input: realText.input, top: realTop + realLabel.height + 20, left: MARGIN },
    ...await footer(BRAND.saffronInk, position)
  ]);
}

/** Recadrage : grand guillemet safran et phrase sur fond clair, un mot mis en couleur. */
export async function statementSlide(text: string, highlight: string | null, position: string) {
  const mark = await textBlock("“", { font: "display", size: 128, weight: 800, color: BRAND.saffron, width: 200, maxHeight: 150 });
  const body = await textBlock(text, { font: "display", size: 64, weight: 700, color: BRAND.ink, width: SIZE - 2 * MARGIN, maxHeight: 560, minSize: 36, highlight: highlight ? { text: highlight, color: BRAND.saffronInk } : null });
  const top = Math.max(MARGIN, Math.round((SIZE - 120 - mark.height - 12 - body.height) / 2));
  return toJpeg(solid(BRAND.canvas), [
    { input: mark.input, top, left: MARGIN },
    { input: body.input, top: top + mark.height + 12, left: MARGIN },
    ...await footer(BRAND.ink2, position)
  ]);
}

/** Liste courte : titre safran en capitales, puis 2 à 4 lignes précédées d'une flèche. */
export async function listSlide(title: string, items: string[], position: string) {
  const head = await textBlock(title.toUpperCase(), { font: "text", size: 24, weight: 700, color: BRAND.saffron, width: SIZE - 2 * MARGIN, maxHeight: 80, letterSpacing: 2 });
  const textLeft = MARGIN + 72, textWidth = SIZE - textLeft - MARGIN;
  const rows = await Promise.all(items.map(item => textBlock(item, { font: "text", size: 40, weight: 600, color: BRAND.onNight, width: textWidth, maxHeight: 170, minSize: 28 })));
  const GAP = 44;
  const listHeight = rows.reduce((h, r) => h + r.height, 0) + GAP * (rows.length - 1);
  const areaTop = MARGIN + head.height, areaBottom = SIZE - MARGIN - 70;
  let y = areaTop + Math.max(24, Math.round((areaBottom - areaTop - listHeight) / 2));
  const layers: Layer[] = [{ input: head.input, top: MARGIN, left: MARGIN }];
  const arrows: string[] = [];
  for (const row of rows) {
    // Flèche dessinée (pas de caractère Unicode employé comme icône), alignée sur la première ligne.
    const cy = y + 26;
    arrows.push(`<path d="M${MARGIN} ${cy}h40M${MARGIN + 24} ${cy - 16}l16 16-16 16" fill="none" stroke="${BRAND.saffron}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
    layers.push({ input: row.input, top: y, left: textLeft });
    y += row.height + GAP;
  }
  return toJpeg(solid(BRAND.night), [{ input: svg(arrows.join("")), top: 0, left: 0 }, ...layers, ...await footer(BRAND.onNight2, position)]);
}

/** Phrase à retenir, seule sur fond safran, avec l'invitation à enregistrer le post. */
export async function quoteSlide(text: string, position: string) {
  const body = await textBlock(text, { font: "display", size: 64, weight: 800, color: BRAND.onSaffron, width: SIZE - 2 * MARGIN, maxHeight: 600, minSize: 36 });
  const save = await textBlock("À retenir · enregistre ce post", { font: "text", size: 28, weight: 700, color: BRAND.saffronInk, width: 800, maxHeight: 44 });
  const top = Math.max(MARGIN, Math.round((SIZE - 120 - body.height - 40 - save.height) / 2));
  const saveTop = top + body.height + 40;
  // Icône « signet » (tracé Lucide bookmark), à l'échelle du texte.
  const bookmark = svg(`<g transform="translate(${MARGIN} ${saveTop + Math.round((save.height - 32) / 2)}) scale(1.33)" fill="none" stroke="${BRAND.saffronInk}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></g>`);
  return toJpeg(solid(BRAND.saffron), [
    { input: body.input, top, left: MARGIN },
    { input: bookmark, top: 0, left: 0 },
    { input: save.input, top: saveTop, left: MARGIN + 48 },
    ...await footer(BRAND.saffronInk, position)
  ]);
}

/** Point fort illustré : image propre à la slide, dégradé, titre et phrase ; sans image, fond bleu nuit. */
export async function sceneSlide(background: Buffer | null, title: string, text: string, position: string) {
  const head = await textBlock(title, { font: "display", size: 64, weight: 800, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: 300, minSize: 40 });
  const body = await textBlock(text, { font: "text", size: 36, color: BRAND.onNight2, width: SIZE - 2 * MARGIN, maxHeight: 240, minSize: 26 });
  if (!background) {
    const top = Math.max(MARGIN, Math.round((SIZE - 120 - head.height - 24 - body.height) / 2));
    return toJpeg(solid(BRAND.night), [{ input: head.input, top, left: MARGIN }, { input: body.input, top: top + head.height + 24, left: MARGIN }, ...await footer(BRAND.onNight2, position)]);
  }
  const bodyTop = SIZE - MARGIN - 90 - body.height, headTop = bodyTop - 24 - head.height;
  const layers: Layer[] = [{ input: head.input, top: headTop, left: MARGIN }, { input: body.input, top: bodyTop, left: MARGIN }, ...await footer(BRAND.onNight, position)];
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.3" stop-color="${BRAND.night3}" stop-opacity="0"/><stop offset="0.62" stop-color="${BRAND.night3}" stop-opacity="0.6"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.95"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  return toJpeg(sharp(background).resize(SIZE, SIZE, { fit: "cover", position: "attention" }), [{ input: shade, top: 0, left: 0 }, ...layers]);
}

/** Point clé : numéro, intertitre et une ou deux phrases reprises de l'article, sur fond bleu nuit. */
export async function pointSlide(index: number, heading: string, body: string, position: string) {
  const number = await textBlock(String(index).padStart(2, "0"), { font: "display", size: 140, weight: 800, color: BRAND.saffron, width: 400, maxHeight: 180 });
  const head = await textBlock(heading, { font: "display", size: 76, weight: 700, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: 320, minSize: 44 });
  const text = body ? await textBlock(body, { font: "text", size: 46, color: BRAND.onNight2, width: SIZE - 2 * MARGIN, maxHeight: 380, minSize: 32 }) : null;
  // Bloc centré verticalement dans l'espace au-dessus de la signature : pas de grand vide en bas.
  const blockHeight = number.height + 40 + head.height + (text ? 40 + text.height : 0);
  const top = Math.max(MARGIN, Math.round((SIZE - 120 - blockHeight) / 2));
  const headTop = top + number.height + 40;
  return toJpeg(solid(BRAND.night), [
    { input: number.input, top, left: MARGIN },
    { input: head.input, top: headTop, left: MARGIN },
    ...(text ? [{ input: text.input, top: headTop + head.height + 40, left: MARGIN }] : []),
    ...await footer(BRAND.onNight2, position)
  ]);
}

export type ChartData = { title: string; unit?: string; sourceLabel?: string; data: { label: string; value: number }[] };

/** Graphique en barres, uniquement à partir d'un bloc « chart » sourcé présent dans l'article. */
export async function chartSlide(chart: ChartData, position: string) {
  const rows = chart.data.slice(0, 6);
  const max = Math.max(...rows.map(r => r.value), 0) || 1;
  const title = await textBlock(chart.title, { font: "display", size: 56, weight: 700, color: BRAND.ink, width: SIZE - 2 * MARGIN, maxHeight: 200, minSize: 36 });
  const areaTop = MARGIN + title.height + 56, rowHeight = Math.min(120, (SIZE - areaTop - MARGIN - 150) / rows.length);
  const barMax = SIZE - 2 * MARGIN - 180;
  const bars = rows.map((r, i) => `<rect x="${MARGIN}" y="${Math.round(areaTop + i * rowHeight + 44)}" width="${Math.max(8, Math.round((r.value / max) * barMax))}" height="${Math.round(rowHeight - 64)}" rx="8" fill="${i === 0 ? BRAND.saffron : BRAND.night}"/>`).join("");
  const layers: Layer[] = [{ input: title.input, top: MARGIN, left: MARGIN }, { input: svg(bars), top: 0, left: 0 }];
  for (const [i, r] of rows.entries()) {
    const label = await textBlock(r.label, { font: "text", size: 30, weight: 600, color: BRAND.ink2, width: SIZE - 2 * MARGIN, maxHeight: 40, minSize: 22 });
    const value = await textBlock(`${r.value.toLocaleString("fr-FR")}${chart.unit ? ` ${chart.unit}` : ""}`, { font: "display", size: 34, weight: 700, color: BRAND.ink, width: 170, maxHeight: 44, minSize: 22 });
    const y = Math.round(areaTop + i * rowHeight);
    layers.push({ input: label.input, top: y, left: MARGIN });
    layers.push({ input: value.input, top: y + 44 + Math.max(0, Math.round((rowHeight - 64 - value.height) / 2)), left: MARGIN + Math.max(8, Math.round((r.value / max) * barMax)) + 16 });
  }
  if (chart.sourceLabel) {
    const source = await textBlock(`Source : ${chart.sourceLabel}`, { font: "text", size: 26, color: BRAND.ink2, width: SIZE - 2 * MARGIN, maxHeight: 70, minSize: 20 });
    layers.push({ input: source.input, top: SIZE - MARGIN - 70 - source.height, left: MARGIN });
  }
  return toJpeg(solid(BRAND.canvas), [...layers, ...await footer(BRAND.ink2, position)]);
}

/** Dernière slide : appel à l'action sur fond bleu nuit, adresse du site dans une pastille. */
export async function ctaSlide(headline: string, detail: string, site: string, position?: string) {
  const head = await textBlock(headline, { font: "display", size: 68, weight: 800, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: 320, minSize: 44 });
  const sub = await textBlock(detail, { font: "text", size: 36, color: BRAND.onNight2, width: 840, maxHeight: 220, minSize: 26 });
  const siteBlock = await textBlock(site, { font: "display", size: 32, weight: 700, color: BRAND.saffron, width: SIZE - 2 * MARGIN, maxHeight: 50 });
  const pillW = siteBlock.width + 72, pillH = siteBlock.height + 40;
  const top = Math.max(MARGIN, Math.round((SIZE - 120 - head.height - 32 - sub.height - 44 - pillH) / 2));
  const pillTop = top + head.height + 32 + sub.height + 44;
  return toJpeg(solid(BRAND.night), [
    { input: head.input, top, left: MARGIN },
    { input: sub.input, top: top + head.height + 32, left: MARGIN },
    { input: svg(`<rect x="${MARGIN}" y="${pillTop}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${BRAND.night3}" stroke="${BRAND.onNightLine}" stroke-width="2"/>`), top: 0, left: 0 },
    { input: siteBlock.input, top: pillTop + 20, left: MARGIN + 36 },
    ...await footer(BRAND.onNight2, position)
  ]);
}

/** Visuel d'un événement publié (§14) : photo, catégorie, titre, date, quartier et appel à l'action. */
export async function eventVisual(background: Buffer, e: { category: string; title: string; when: string; district: string; cta: string }) {
  const base = sharp(background).resize(SIZE, SIZE, { fit: "cover", position: "attention" });
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.2" stop-color="${BRAND.night3}" stop-opacity="0.15"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.94"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  const category = await textBlock(e.category.toUpperCase(), { font: "text", size: 30, weight: 700, color: BRAND.ink, width: 600, maxHeight: 50 });
  const pill = svg(`<rect x="${MARGIN}" y="${MARGIN}" width="${category.width + 48}" height="${category.height + 24}" rx="${Math.round((category.height + 24) / 2)}" fill="${BRAND.saffron}"/>`);
  const title = await textBlock(e.title, { font: "display", size: 80, weight: 800, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: 340, minSize: 44 });
  const meta = await textBlock(`${e.when}\n${e.district}`, { font: "text", size: 40, weight: 600, color: BRAND.onNight2, width: SIZE - 2 * MARGIN, maxHeight: 140, minSize: 28 });
  const cta = await textBlock(e.cta, { font: "display", size: 38, weight: 700, color: BRAND.saffron, width: SIZE - 2 * MARGIN, maxHeight: 60 });
  const ctaTop = SIZE - MARGIN - cta.height - 60;
  const metaTop = ctaTop - 36 - meta.height;
  const titleTop = metaTop - 28 - title.height;
  return toJpeg(base, [
    { input: shade, top: 0, left: 0 },
    { input: pill, top: 0, left: 0 },
    { input: category.input, top: MARGIN + 12, left: MARGIN + 24 },
    { input: title.input, top: titleTop, left: MARGIN },
    { input: meta.input, top: metaTop, left: MARGIN },
    { input: cta.input, top: ctaTop, left: MARGIN },
    ...await footer(BRAND.onNight2)
  ]);
}
