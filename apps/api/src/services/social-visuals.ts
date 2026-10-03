import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Visuels Instagram (décision v2 §6 et §14) : carrés 1080 × 1080, texte toujours ajouté par programme
// (jamais demandé au générateur d'images), polices de la marque embarquées dans l'API — l'image Docker
// Alpine n'a aucune police système. Chaque bloc de texte est réduit jusqu'à tenir dans sa zone : aucun
// débordement, aucune coupure au milieu d'un mot.

// Format portrait 4:5 (1080 × 1350) : le plus grand accepté dans le fil Instagram, il occupe environ 25 %
// d'écran de plus qu'un carré, donc retient davantage le pouce (diagnostic du 2026-10-03).
const W = 1080, H = 1350;
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

const solid = (color: string) => sharp({ create: { width: W, height: H, channels: 3, background: color } });
const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);
const toJpeg = (image: sharp.Sharp, layers: Layer[]) => image.composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();

// Signature commune en bas de chaque slide : marque et, pour un carrousel, la position (2/6).
async function footer(color: string, position?: string): Promise<Layer[]> {
  const brand = await textBlock("Nūr Meet", { font: "display", size: 34, weight: 700, color, width: 400, maxHeight: 60 });
  const layers: Layer[] = [{ input: brand.input, top: H - MARGIN - brand.height + 10, left: MARGIN }];
  if (position) {
    const pos = await textBlock(position, { font: "text", size: 30, color, width: 200, maxHeight: 50, align: "right" });
    layers.push({ input: pos.input, top: H - MARGIN - pos.height + 10, left: W - MARGIN - pos.width });
  }
  return layers;
}

/**
 * Couverture : photo plein cadre et accroche en très gros en haut, là où le regard tombe en premier dans
 * le fil (diagnostic du 2026-10-03 : l'accroche en bas, sous un bandeau « Journal », se lisait comme une
 * publicité). Rubrique facultative ; en bas, une invitation à faire glisser, dessinée (pas d'emoji).
 */
export async function coverSlide(background: Buffer, title: string, label: string, position?: string, subtitle?: string) {
  const base = sharp(background).resize(W, H, { fit: "cover", position: "attention" });
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BRAND.night3}" stop-opacity="0.94"/><stop offset="0.5" stop-color="${BRAND.night3}" stop-opacity="0.55"/><stop offset="0.72" stop-color="${BRAND.night3}" stop-opacity="0.05"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.7"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  const labelBlock = label ? await textBlock(label.toUpperCase(), { font: "text", size: 26, weight: 700, color: BRAND.saffron, width: W - 2 * MARGIN, maxHeight: 44, letterSpacing: 2 }) : null;
  const titleBlock = await textBlock(title, { font: "display", size: 104, weight: 800, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: subtitle ? 470 : 560, minSize: 56 });
  const sub = subtitle ? await textBlock(subtitle, { font: "text", size: 40, weight: 600, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: 160, minSize: 30 }) : null;
  const titleTop = MARGIN + (labelBlock ? labelBlock.height + 28 : 0);
  const swipe = await textBlock("Glisse", { font: "display", size: 34, weight: 700, color: BRAND.onNight, width: 300, maxHeight: 50 });
  const swipeLeft = W - MARGIN - swipe.width - 64, swipeTop = H - MARGIN - 130;
  const arrow = svg(`<path d="M${W - MARGIN - 44} ${swipeTop + swipe.height / 2}h40M${W - MARGIN - 20} ${swipeTop + swipe.height / 2 - 16}l16 16-16 16" fill="none" stroke="${BRAND.saffron}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  return toJpeg(base, [
    { input: shade, top: 0, left: 0 },
    ...(labelBlock ? [{ input: labelBlock.input, top: MARGIN, left: MARGIN }] : []),
    { input: titleBlock.input, top: titleTop, left: MARGIN },
    ...(sub ? [{ input: sub.input, top: titleTop + titleBlock.height + 32, left: MARGIN }] : []),
    { input: swipe.input, top: swipeTop, left: swipeLeft },
    { input: arrow, top: 0, left: 0 },
    ...await footer(BRAND.onNight, position)
  ]);
}

// Gabarits du carrousel réécrit (refonte du 2026-09-26, maquette « Carrousel Nūr Meet — nouvelle
// version ») : chaque format a son fond et sa mise en page, et une variante photo — au moins une image
// tous les deux écrans. Sur une photo, un voile bleu nuit garantit la lisibilité du texte blanc.

// Voile dégradé : dense derrière le texte, léger ailleurs, pour que la photo reste vivante.
const gradientVeil = (from: number, to: number) => svg(`<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BRAND.night3}" stop-opacity="${from}"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#v)"/>`);
const veil = (opacity: number, height = H) => svg(`<rect width="${W}" height="${height}" fill="${BRAND.night3}" fill-opacity="${opacity}"/>`);
const photoBase = (photo: Buffer) => sharp(photo).resize(W, H, { fit: "cover", position: "attention" });
// Bandeau photo (haut de slide) déjà recadré, à composer sur un fond uni.
const photoBand = (photo: Buffer, height: number) => sharp(photo).resize(W, height, { fit: "cover", position: "attention" }).toBuffer();

/** Contraste « idée reçue / en réalité » : idée reçue barrée en haut (photo voilée ou bleu nuit), réponse sur safran. */
export async function contrastSlide(photo: Buffer | null, myth: string, reality: string, position: string) {
  const TOP = photo ? 640 : 600, PAD = 64;
  const mythColor = photo ? BRAND.onNight : BRAND.onNight2;
  const mythLabel = await textBlock("CE QU’ON ENTEND", { font: "text", size: 22, weight: 700, color: mythColor, width: 600, maxHeight: 40, letterSpacing: 2 });
  const mythText = await textBlock(`« ${myth} »`, { font: "display", size: 56, weight: 700, color: mythColor, width: W - 2 * MARGIN, maxHeight: TOP - 2 * PAD - mythLabel.height - 20, minSize: 30, italic: true, strike: true });
  const realLabel = await textBlock("EN RÉALITÉ", { font: "text", size: 22, weight: 800, color: BRAND.saffronInk, width: 600, maxHeight: 40, letterSpacing: 2 });
  const realText = await textBlock(reality, { font: "display", size: 62, weight: 800, color: BRAND.onSaffron, width: W - 2 * MARGIN, maxHeight: H - TOP - 2 * PAD - 90 - realLabel.height, minSize: 32 });
  const mythTop = photo ? TOP - PAD - mythText.height - 20 - mythLabel.height : Math.round((TOP - mythLabel.height - 20 - mythText.height) / 2);
  const realTop = TOP + Math.round((H - TOP - 90 - realLabel.height - 20 - realText.height) / 2);
  const top: Layer[] = photo
    ? [{ input: await photoBand(photo, TOP), top: 0, left: 0 }, { input: veil(0.5, TOP), top: 0, left: 0 }]
    : [{ input: svg(`<rect width="${W}" height="${TOP}" fill="${BRAND.night}"/>`), top: 0, left: 0 }];
  return toJpeg(solid(BRAND.saffron), [
    ...top,
    { input: mythLabel.input, top: mythTop, left: MARGIN },
    { input: mythText.input, top: mythTop + mythLabel.height + 20, left: MARGIN },
    { input: realLabel.input, top: realTop, left: MARGIN },
    { input: realText.input, top: realTop + realLabel.height + 20, left: MARGIN },
    ...await footer(BRAND.saffronInk, position)
  ]);
}

/** Recadrage : grand guillemet safran et phrase, un mot mis en couleur ; sur fond clair ou sur photo voilée. */
export async function statementSlide(photo: Buffer | null, text: string, highlight: string | null, position: string) {
  const ink = photo ? BRAND.onNight : BRAND.ink;
  // Guillemet ouvrant dessiné (tracé Lucide « quote », retourné) : sa taille ne dépend pas du glyphe de la police.
  const mark = { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="${BRAND.saffron}"><g transform="rotate(180 12 12)"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></g></svg>`), height: 150 };
  const body = await textBlock(text, { font: "display", size: 74, weight: 700, color: ink, width: W - 2 * MARGIN, maxHeight: 560, minSize: 36, highlight: highlight ? { text: highlight, color: photo ? BRAND.saffron : BRAND.saffronInk } : null });
  const top = Math.max(MARGIN, Math.round((H - 120 - mark.height - body.height) / 2));
  const layers: Layer[] = [{ input: mark.input, top, left: MARGIN - 8 }, { input: body.input, top: top + mark.height, left: MARGIN }, ...await footer(photo ? BRAND.onNight : BRAND.ink2, position)];
  return photo ? toJpeg(photoBase(photo), [{ input: veil(0.62), top: 0, left: 0 }, ...layers]) : toJpeg(solid(BRAND.canvas), layers);
}

/** Liste courte : titre safran en capitales, puis 2 à 4 lignes précédées d'une flèche. */
export async function listSlide(photo: Buffer | null, title: string, items: string[], position: string) {
  const head = await textBlock(title.toUpperCase(), { font: "text", size: 30, weight: 700, color: BRAND.saffron, width: W - 2 * MARGIN, maxHeight: 80, letterSpacing: 2 });
  const textLeft = MARGIN + 72, textWidth = W - textLeft - MARGIN;
  const rows = await Promise.all(items.map(item => textBlock(item, { font: "text", size: 50, weight: 600, color: BRAND.onNight, width: textWidth, maxHeight: 170, minSize: 28 })));
  const GAP = 44;
  const listHeight = rows.reduce((h, r) => h + r.height, 0) + GAP * (rows.length - 1);
  const areaTop = MARGIN + head.height, areaBottom = H - MARGIN - 70;
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
  const content = [{ input: svg(arrows.join("")), top: 0, left: 0 }, ...layers, ...await footer(photo ? BRAND.onNight : BRAND.onNight2, position)];
  return photo ? toJpeg(photoBase(photo), [{ input: gradientVeil(0.5, 0.82), top: 0, left: 0 }, ...content]) : toJpeg(solid(BRAND.night), content);
}

/** Phrase à retenir sur fond safran (sous une photo si elle en a une), avec l'invitation à enregistrer le post. */
export async function quoteSlide(photo: Buffer | null, text: string, position: string) {
  const TOP = photo ? 600 : 0;
  const body = await textBlock(text, { font: "display", size: photo ? 64 : 76, weight: 800, color: BRAND.onSaffron, width: W - 2 * MARGIN, maxHeight: photo ? 330 : 600, minSize: 34 });
  const save = await textBlock("À retenir · enregistre ce post", { font: "text", size: 28, weight: 700, color: BRAND.saffronInk, width: 800, maxHeight: 44 });
  const top = TOP + Math.max(photo ? 56 : MARGIN, Math.round((H - TOP - 120 - body.height - 40 - save.height) / 2));
  const saveTop = top + body.height + 40;
  // Icône « signet » (tracé Lucide bookmark), à l'échelle du texte.
  const bookmark = svg(`<g transform="translate(${MARGIN} ${saveTop + Math.round((save.height - 32) / 2)}) scale(1.33)" fill="none" stroke="${BRAND.saffronInk}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></g>`);
  return toJpeg(solid(BRAND.saffron), [
    ...(photo ? [{ input: await photoBand(photo, TOP), top: 0, left: 0 }] : []),
    { input: body.input, top, left: MARGIN },
    { input: bookmark, top: 0, left: 0 },
    { input: save.input, top: saveTop, left: MARGIN + 48 },
    ...await footer(BRAND.saffronInk, position)
  ]);
}

/** Chiffre clé de l'article : très grand nombre, sa signification et sa source ; sur safran ou sur photo voilée. */
export async function statSlide(photo: Buffer | null, value: string, text: string, source: string, position: string) {
  const number = await textBlock(value, { font: "display", size: 230, weight: 800, color: photo ? BRAND.saffron : BRAND.night, width: W - 2 * MARGIN, maxHeight: 280, minSize: 110 });
  const body = await textBlock(text, { font: "display", size: 50, weight: 700, color: photo ? BRAND.onNight : BRAND.onSaffron, width: W - 2 * MARGIN, maxHeight: 300, minSize: 32 });
  const src = await textBlock(`Source : ${source}`, { font: "text", size: 26, weight: 600, color: photo ? BRAND.onNight2 : BRAND.saffronInk, width: W - 2 * MARGIN, maxHeight: 70, minSize: 20 });
  const top = Math.max(MARGIN, Math.round((H - 120 - number.height - 24 - body.height - 36 - src.height) / 2));
  const layers: Layer[] = [
    { input: number.input, top, left: MARGIN },
    { input: body.input, top: top + number.height + 24, left: MARGIN },
    { input: src.input, top: top + number.height + 24 + body.height + 36, left: MARGIN },
    ...await footer(photo ? BRAND.onNight : BRAND.saffronInk, position)
  ];
  return photo ? toJpeg(photoBase(photo), [{ input: veil(0.6), top: 0, left: 0 }, ...layers]) : toJpeg(solid(BRAND.saffron), layers);
}

/** Point fort illustré : image propre à la slide, dégradé, titre et phrase ; sans image, fond bleu nuit. */
export async function sceneSlide(background: Buffer | null, title: string, text: string, position: string) {
  const head = await textBlock(title, { font: "display", size: 76, weight: 800, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: 300, minSize: 40 });
  const body = await textBlock(text, { font: "text", size: 42, color: BRAND.onNight2, width: W - 2 * MARGIN, maxHeight: 240, minSize: 26 });
  if (!background) {
    const top = Math.max(MARGIN, Math.round((H - 120 - head.height - 24 - body.height) / 2));
    return toJpeg(solid(BRAND.night), [{ input: head.input, top, left: MARGIN }, { input: body.input, top: top + head.height + 24, left: MARGIN }, ...await footer(BRAND.onNight2, position)]);
  }
  const bodyTop = H - MARGIN - 90 - body.height, headTop = bodyTop - 24 - head.height;
  const layers: Layer[] = [{ input: head.input, top: headTop, left: MARGIN }, { input: body.input, top: bodyTop, left: MARGIN }, ...await footer(BRAND.onNight, position)];
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.3" stop-color="${BRAND.night3}" stop-opacity="0"/><stop offset="0.62" stop-color="${BRAND.night3}" stop-opacity="0.6"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.95"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  return toJpeg(photoBase(background), [{ input: shade, top: 0, left: 0 }, ...layers]);
}

/** Point clé : numéro, intertitre et une ou deux phrases reprises de l'article, sur fond bleu nuit. */
export async function pointSlide(index: number, heading: string, body: string, position: string) {
  const number = await textBlock(String(index).padStart(2, "0"), { font: "display", size: 140, weight: 800, color: BRAND.saffron, width: 400, maxHeight: 180 });
  const head = await textBlock(heading, { font: "display", size: 76, weight: 700, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: 320, minSize: 44 });
  const text = body ? await textBlock(body, { font: "text", size: 46, color: BRAND.onNight2, width: W - 2 * MARGIN, maxHeight: 380, minSize: 32 }) : null;
  // Bloc centré verticalement dans l'espace au-dessus de la signature : pas de grand vide en bas.
  const blockHeight = number.height + 40 + head.height + (text ? 40 + text.height : 0);
  const top = Math.max(MARGIN, Math.round((H - 120 - blockHeight) / 2));
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
  const title = await textBlock(chart.title, { font: "display", size: 56, weight: 700, color: BRAND.ink, width: W - 2 * MARGIN, maxHeight: 200, minSize: 36 });
  const areaTop = MARGIN + title.height + 56, rowHeight = Math.min(120, (H - areaTop - MARGIN - 150) / rows.length);
  const barMax = W - 2 * MARGIN - 180;
  const bars = rows.map((r, i) => `<rect x="${MARGIN}" y="${Math.round(areaTop + i * rowHeight + 44)}" width="${Math.max(8, Math.round((r.value / max) * barMax))}" height="${Math.round(rowHeight - 64)}" rx="8" fill="${i === 0 ? BRAND.saffron : BRAND.night}"/>`).join("");
  const layers: Layer[] = [{ input: title.input, top: MARGIN, left: MARGIN }, { input: svg(bars), top: 0, left: 0 }];
  for (const [i, r] of rows.entries()) {
    const label = await textBlock(r.label, { font: "text", size: 30, weight: 600, color: BRAND.ink2, width: W - 2 * MARGIN, maxHeight: 40, minSize: 22 });
    const value = await textBlock(`${r.value.toLocaleString("fr-FR")}${chart.unit ? ` ${chart.unit}` : ""}`, { font: "display", size: 34, weight: 700, color: BRAND.ink, width: 170, maxHeight: 44, minSize: 22 });
    const y = Math.round(areaTop + i * rowHeight);
    layers.push({ input: label.input, top: y, left: MARGIN });
    layers.push({ input: value.input, top: y + 44 + Math.max(0, Math.round((rowHeight - 64 - value.height) / 2)), left: MARGIN + Math.max(8, Math.round((r.value / max) * barMax)) + 16 });
  }
  if (chart.sourceLabel) {
    const source = await textBlock(`Source : ${chart.sourceLabel}`, { font: "text", size: 26, color: BRAND.ink2, width: W - 2 * MARGIN, maxHeight: 70, minSize: 20 });
    layers.push({ input: source.input, top: H - MARGIN - 70 - source.height, left: MARGIN });
  }
  return toJpeg(solid(BRAND.canvas), [...layers, ...await footer(BRAND.ink2, position)]);
}

/** Dernière slide : appel à l'action sur fond bleu nuit ou photo voilée, adresse du site dans une pastille. */
export async function ctaSlide(headline: string, detail: string, site: string, position?: string, photo: Buffer | null = null) {
  const head = await textBlock(headline, { font: "display", size: 80, weight: 800, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: 320, minSize: 44 });
  const sub = await textBlock(detail, { font: "text", size: 42, color: photo ? BRAND.onNight : BRAND.onNight2, width: 840, maxHeight: 220, minSize: 26 });
  const siteBlock = await textBlock(site, { font: "display", size: 32, weight: 700, color: BRAND.saffron, width: W - 2 * MARGIN, maxHeight: 50 });
  const pillW = siteBlock.width + 72, pillH = siteBlock.height + 40;
  const top = Math.max(MARGIN, Math.round((H - 120 - head.height - 32 - sub.height - 44 - pillH) / 2));
  const pillTop = top + head.height + 32 + sub.height + 44;
  const layers: Layer[] = [
    { input: head.input, top, left: MARGIN },
    { input: sub.input, top: top + head.height + 32, left: MARGIN },
    { input: svg(`<rect x="${MARGIN}" y="${pillTop}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${BRAND.night3}" stroke="${BRAND.onNightLine}" stroke-width="2"/>`), top: 0, left: 0 },
    { input: siteBlock.input, top: pillTop + 20, left: MARGIN + 36 },
    ...await footer(photo ? BRAND.onNight : BRAND.onNight2, position)
  ];
  return photo ? toJpeg(photoBase(photo), [{ input: gradientVeil(0.78, 0.3), top: 0, left: 0 }, ...layers]) : toJpeg(solid(BRAND.night), layers);
}

// Formats « codes d'Internet » (2026-10-03, retour : « trop mou, il faut être taquin ») : fausse
// conversation de messagerie, grosse phrase façon TikTok sur photo, et post façon tweet. Ils ne
// ressemblent volontairement pas à une publicité : la marque n'apparaît qu'en signature discrète.
export type ChatMessage = { me: boolean; text: string };
const CHAT = { canvas: "#f2f2f7", card: "#ffffff", line: "#e3e3e8", me: "#1f8bff", them: "#e9e9eb", ink: "#111111", muted: "#8e8e93" };

/** Capture de conversation : contact en tête, bulles grises (lui/elle) et bleues (toi) ; accroche facultative au-dessus. */
export async function chatSlide(contact: string, messages: ChatMessage[], position: string, hook?: string) {
  const layers: Layer[] = [];
  let y = 72;
  if (hook) {
    const h = await textBlock(hook, { font: "display", size: 76, weight: 800, color: CHAT.ink, width: W - 2 * 70, maxHeight: 330, minSize: 48 });
    layers.push({ input: h.input, top: y, left: 70 });
    y += h.height + 48;
  }
  const head = await textBlock(contact, { font: "text", size: 38, weight: 700, color: CHAT.ink, width: 700, maxHeight: 60, align: "centre" });
  const cardBottom = H - 120;
  const shapes = [`<rect x="40" y="${y}" width="${W - 80}" height="${cardBottom - y}" rx="40" fill="${CHAT.card}" stroke="${CHAT.line}" stroke-width="2"/>`, `<circle cx="${W / 2}" cy="${y + 72}" r="42" fill="#c7c7cc"/>`];
  layers.push({ input: head.input, top: y + 124, left: Math.round(W / 2 - head.width / 2) });
  // Bulles réduites ensemble jusqu'à tenir dans la carte : aucune conversation ne déborde.
  for (let size = 54; ; size -= 4) {
    const bubbles = await Promise.all(messages.map(m => textBlock(m.text, { font: "text", size, color: m.me ? "#ffffff" : CHAT.ink, width: 660, maxHeight: 600, minSize: size })));
    const total = bubbles.reduce((h, b) => h + b.height + 44 + 22, 0);
    if (y + 210 + total <= cardBottom - 30 || size <= 28) {
      let my = y + 210;
      for (const [i, b] of bubbles.entries()) {
        const bw = b.width + 64, bh = b.height + 44, x = messages[i].me ? W - 80 - bw : 80;
        shapes.push(`<rect x="${x}" y="${my}" width="${bw}" height="${bh}" rx="36" fill="${messages[i].me ? CHAT.me : CHAT.them}"/>`);
        layers.push({ input: b.input, top: my + 22, left: x + 32 });
        my += bh + 22;
      }
      break;
    }
  }
  return toJpeg(solid(CHAT.canvas), [{ input: svg(shapes.join("")), top: 0, left: 0 }, ...layers, ...await footer(CHAT.muted, position)]);
}

/** Grosse phrase façon TikTok : texte blanc ombré au centre d'une photo assombrie ; mention facultative en bas. */
export async function punchSlide(photo: Buffer | null, text: string, position: string, small?: string, swipe = false) {
  const options = { font: "display" as const, size: 100, weight: 800, width: W - 160, maxHeight: 760, minSize: 56, align: "centre" as const };
  const t = await textBlock(text, { ...options, color: "#ffffff" });
  // Ombre portée floutée : lisible sur n'importe quelle photo, sans bandeau de couleur.
  const shadow = await sharp((await textBlock(text, { ...options, color: "#000000" })).input).blur(10).toBuffer();
  const top = Math.round(H * 0.44 - t.height / 2), left = Math.round(W / 2 - t.width / 2);
  const layers: Layer[] = [{ input: svg(`<rect width="${W}" height="${H}" fill="#000000" fill-opacity="${photo ? 0.3 : 0}"/>`), top: 0, left: 0 }, { input: shadow, top: top + 5, left: left + 2 }, { input: shadow, top: top + 5, left: left + 2 }, { input: t.input, top, left }];
  if (small) {
    const s = await textBlock(small, { font: "text", size: 40, weight: 700, color: "#ffffff", width: W - 220, maxHeight: 200, minSize: 28, align: "centre" });
    layers.push({ input: s.input, top: Math.min(H - 300, top + t.height + 60), left: Math.round(W / 2 - s.width / 2) });
  }
  if (swipe) {
    const label = await textBlock("Glisse", { font: "display", size: 36, weight: 700, color: "#ffffff", width: 300, maxHeight: 50 });
    const x = Math.round(W / 2 - (label.width + 60) / 2), y = H - MARGIN - 150;
    layers.push({ input: label.input, top: y, left: x }, { input: svg(`<path d="M${x + label.width + 16} ${y + label.height / 2}h40M${x + label.width + 40} ${y + label.height / 2 - 16}l16 16-16 16" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`), top: 0, left: 0 });
  }
  const base = photo ? sharp(photo).resize(W, H, { fit: "cover", position: "attention" }) : solid(BRAND.night3);
  return toJpeg(base, [...layers, ...await footer("#ffffff", position)]);
}

/** Post façon tweet : carte blanche, avatar de la marque, nom et compte, texte (retours à la ligne permis). */
export async function tweetSlide(text: string, position: string, handle = "@nour_meetup") {
  const ink = "#0f1419", muted = "#536471";
  const body = await textBlock(text, { font: "text", size: 60, weight: 600, color: ink, width: W - 240, maxHeight: H - 520, minSize: 34 });
  const name = await textBlock("Nūr Meet", { font: "text", size: 40, weight: 800, color: ink, width: 500, maxHeight: 60 });
  const at = await textBlock(handle, { font: "text", size: 34, color: muted, width: 500, maxHeight: 60 });
  const cardH = 210 + body.height + 90, top = Math.max(60, Math.round((H - 60 - cardH) / 2));
  return toJpeg(solid("#f7f9f9"), [
    { input: svg(`<rect x="60" y="${top}" width="${W - 120}" height="${cardH}" rx="36" fill="#ffffff" stroke="#e1e8ed" stroke-width="2"/><circle cx="170" cy="${top + 112}" r="52" fill="${BRAND.night}"/><circle cx="170" cy="${top + 112}" r="20" fill="${BRAND.saffron}"/>`), top: 0, left: 0 },
    { input: name.input, top: top + 64, left: 245 },
    { input: at.input, top: top + 114, left: 245 },
    { input: body.input, top: top + 210, left: 120 },
    ...await footer(muted, position)
  ]);
}

// Visuel d'un événement publié (§14, puis v3 §8) : trois modèles cohérents avec la marque, selon le type
// d'événement — speed dating (photo plein cadre, voile bleu nuit), networking (photo en haut, bandeau bleu
// nuit), autre activité (photo encadrée sur fond safran). Photo principale si disponible, nom, date, lieu,
// type et appel à l'action vers le site.
export type EventVisualKind = "DATING" | "NETWORKING" | "OTHER";
export const eventVisualKind = (category: string): EventVisualKind => category === "Speed dating" ? "DATING" : category === "Networking" ? "NETWORKING" : "OTHER";
type EventVisualData = { category: string; title: string; when: string; district: string; cta: string };

async function categoryPill(label: string, fill: string, ink: string, top: number, left: number): Promise<Layer[]> {
  const text = await textBlock(label.toUpperCase(), { font: "text", size: 28, weight: 700, color: ink, width: 600, maxHeight: 50, letterSpacing: 1 });
  return [
    { input: svg(`<rect x="${left}" y="${top}" width="${text.width + 48}" height="${text.height + 24}" rx="${Math.round((text.height + 24) / 2)}" fill="${fill}"/>`), top: 0, left: 0 },
    { input: text.input, top: top + 12, left: left + 24 }
  ];
}

export async function eventVisual(background: Buffer, e: EventVisualData) {
  const kind = eventVisualKind(e.category);
  if (kind === "NETWORKING") {
    // Photo sur les 55 % du haut, bandeau bleu nuit en bas : la lecture d'une invitation professionnelle.
    const PHOTO_H = 760;
    const title = await textBlock(e.title, { font: "display", size: 64, weight: 800, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: 200, minSize: 38 });
    const meta = await textBlock(`${e.when} · ${e.district}`, { font: "text", size: 34, weight: 600, color: BRAND.onNight2, width: W - 2 * MARGIN, maxHeight: 100, minSize: 24 });
    const cta = await textBlock(e.cta, { font: "display", size: 34, weight: 700, color: BRAND.saffron, width: W - 2 * MARGIN, maxHeight: 50 });
    const titleTop = PHOTO_H + 56;
    return toJpeg(solid(BRAND.night), [
      { input: await sharp(background).resize(W, PHOTO_H, { fit: "cover", position: "attention" }).toBuffer(), top: 0, left: 0 },
      ...await categoryPill(e.category, BRAND.night, BRAND.onNight, MARGIN, MARGIN),
      { input: title.input, top: titleTop, left: MARGIN },
      { input: meta.input, top: titleTop + title.height + 16, left: MARGIN },
      { input: cta.input, top: H - MARGIN - cta.height - 50, left: MARGIN },
      ...await footer(BRAND.onNight2)
    ]);
  }
  if (kind === "OTHER") {
    // Photo encadrée sur fond safran : une sortie, une activité, un moment différent.
    const INSET = 56, PHOTO_H = 720;
    const photo = await sharp(background).resize(W - 2 * INSET, PHOTO_H, { fit: "cover", position: "attention" })
      .composite([{ input: Buffer.from(`<svg width="${W - 2 * INSET}" height="${PHOTO_H}"><rect width="100%" height="100%" rx="28" fill="#fff"/></svg>`), blend: "dest-in" }]).png().toBuffer();
    const title = await textBlock(e.title, { font: "display", size: 62, weight: 800, color: BRAND.onSaffron, width: W - 2 * MARGIN, maxHeight: 190, minSize: 38 });
    const meta = await textBlock(`${e.when} · ${e.district}`, { font: "text", size: 32, weight: 600, color: BRAND.onSaffron, width: W - 2 * MARGIN, maxHeight: 90, minSize: 24 });
    const cta = await textBlock(e.cta, { font: "display", size: 32, weight: 700, color: BRAND.saffronInk, width: W - 2 * MARGIN, maxHeight: 50 });
    const titleTop = INSET + PHOTO_H + 36;
    return toJpeg(solid(BRAND.saffron), [
      { input: photo, top: INSET, left: INSET },
      ...await categoryPill(e.category, BRAND.onSaffron, "#ffffff", INSET + 28, INSET + 28),
      { input: title.input, top: titleTop, left: MARGIN },
      { input: meta.input, top: titleTop + title.height + 12, left: MARGIN },
      { input: cta.input, top: H - MARGIN - cta.height - 50, left: MARGIN },
      ...await footer(BRAND.saffronInk)
    ]);
  }
  // Speed dating : photo plein cadre, voile bleu nuit, pastille safran.
  const base = sharp(background).resize(W, H, { fit: "cover", position: "attention" });
  const shade = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.2" stop-color="${BRAND.night3}" stop-opacity="0.15"/><stop offset="1" stop-color="${BRAND.night3}" stop-opacity="0.94"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
  const title = await textBlock(e.title, { font: "display", size: 80, weight: 800, color: BRAND.onNight, width: W - 2 * MARGIN, maxHeight: 340, minSize: 44 });
  const meta = await textBlock(`${e.when}\n${e.district}`, { font: "text", size: 40, weight: 600, color: BRAND.onNight2, width: W - 2 * MARGIN, maxHeight: 140, minSize: 28 });
  const cta = await textBlock(e.cta, { font: "display", size: 38, weight: 700, color: BRAND.saffron, width: W - 2 * MARGIN, maxHeight: 60 });
  const ctaTop = H - MARGIN - cta.height - 60;
  const metaTop = ctaTop - 36 - meta.height;
  const titleTop = metaTop - 28 - title.height;
  return toJpeg(base, [
    { input: shade, top: 0, left: 0 },
    ...await categoryPill(e.category, BRAND.saffron, BRAND.onSaffron, MARGIN, MARGIN),
    { input: title.input, top: titleTop, left: MARGIN },
    { input: meta.input, top: metaTop, left: MARGIN },
    { input: cta.input, top: ctaTop, left: MARGIN },
    ...await footer(BRAND.onNight2)
  ]);
}
