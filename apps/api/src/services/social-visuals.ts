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
export const BRAND = { night: "#1c2653", night3: "#121a3d", saffron: "#f2a33a", onNight: "#ffffff", onNight2: "#c8cde4", canvas: "#f6f6f8", ink: "#15171c", ink2: "#474c58" };

const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type TextOptions = { font: keyof typeof FONTS; size: number; color: string; width: number; maxHeight: number; weight?: number; align?: "left" | "centre" | "right"; minSize?: number };
type Layer = { input: Buffer; top: number; left: number };

/** Bloc de texte rendu en PNG transparent, réduit par paliers jusqu'à tenir dans maxHeight. */
export async function textBlock(text: string, options: TextOptions): Promise<{ input: Buffer; width: number; height: number }> {
  const font = FONTS[options.font];
  const markup = `<span foreground="${options.color}"${options.weight ? ` weight="${options.weight}"` : ""}>${escapeMarkup(text)}</span>`;
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

/** Couverture : photo ou illustration plein cadre, dégradé sombre pour la lisibilité, puis le titre. */
export async function coverSlide(background: Buffer, title: string, label: string, position?: string) {
  const base = sharp(background).resize(SIZE, SIZE, { fit: "cover", position: "attention" });
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.15" stop-color="${BRAND.night3}" stop-opacity="0"/><stop offset="0.5" stop-color="${BRAND.night3}" stop-opacity="0.6"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.95"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  const titleBlock = await textBlock(title, { font: "display", size: 76, weight: 800, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: 420, minSize: 44 });
  const labelBlock = await textBlock(label, { font: "text", size: 32, weight: 700, color: BRAND.onNight, width: SIZE - 2 * MARGIN, maxHeight: 60 });
  const titleTop = SIZE - MARGIN - 90 - titleBlock.height;
  return toJpeg(base, [
    { input: shade, top: 0, left: 0 },
    { input: labelBlock.input, top: titleTop - labelBlock.height - 24, left: MARGIN },
    { input: titleBlock.input, top: titleTop, left: MARGIN },
    ...await footer(BRAND.onNight2, position)
  ]);
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

/** Dernière slide : appel à l'action vers l'article ou le site, sur fond safran. */
export async function ctaSlide(headline: string, detail: string, site: string, position?: string) {
  const head = await textBlock(headline, { font: "display", size: 84, weight: 800, color: BRAND.ink, width: SIZE - 2 * MARGIN, maxHeight: 360, minSize: 48 });
  const sub = await textBlock(detail, { font: "text", size: 42, weight: 600, color: BRAND.ink, width: SIZE - 2 * MARGIN, maxHeight: 160 });
  const siteBlock = await textBlock(site, { font: "text", size: 36, color: BRAND.ink, width: SIZE - 2 * MARGIN, maxHeight: 60 });
  const top = Math.round((SIZE - head.height - sub.height - 40) / 2) - 40;
  return toJpeg(solid(BRAND.saffron), [
    { input: head.input, top, left: MARGIN },
    { input: sub.input, top: top + head.height + 40, left: MARGIN },
    { input: siteBlock.input, top: top + head.height + 40 + sub.height + 24, left: MARGIN },
    ...await footer(BRAND.ink, position)
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
