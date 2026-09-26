import { SITE_ORIGIN } from "../env.js";
import { BRAND } from "./social-visuals.js";

// Mise en page commune des e-mails Nūr Meet (v3 §4.3 et §5.2) : HTML compatible avec les principaux
// clients (tableaux, styles en ligne, largeur 600 px qui se réduit sur mobile, polices système — les
// polices web sont ignorées par Outlook et Gmail), toujours accompagné d'une version texte équivalente.
// Couleurs : celles des tokens du site (BRAND), les variables CSS n'existant pas dans un e-mail. Toutes
// les adresses sont absolues (site de production), jamais relatives.

export type EmailContent = {
  // Texte d'aperçu affiché par la boîte de réception à côté de l'objet.
  preheader: string;
  heading: string;
  paragraphs: string[];
  image?: { url: string; alt: string };
  details?: { label: string; value: string }[];
  cta?: { label: string; url: string };
  // Liens secondaires, sous le bouton principal.
  links?: { label: string; url: string }[];
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const paragraphs = content.paragraphs.map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BRAND.ink2};">${escape(p)}</p>`).join("");
  const image = content.image ? `<tr><td style="padding:0;"><img src="${escape(content.image.url)}" width="600" alt="${escape(content.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>` : "";
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:collapse;">${content.details.map(d => `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e5ec;font-size:14px;color:${BRAND.ink2};width:34%;vertical-align:top;">${escape(d.label)}</td><td style="padding:10px 0;border-bottom:1px solid #e3e5ec;font-size:15px;font-weight:600;color:${BRAND.ink};vertical-align:top;">${escape(d.value)}</td></tr>`).join("")}</table>`
    : "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${BRAND.night};"><a href="${escape(content.cta.url)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escape(content.cta.label)}</a></td></tr></table>`
    : "";
  const links = content.links?.length
    ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.8;">${content.links.map(l => `<a href="${escape(l.url)}" style="color:${BRAND.saffronInk};font-weight:600;text-decoration:underline;">${escape(l.label)}</a>`).join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</p>`
    : "";
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(content.heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.canvas};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.canvas};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="padding:20px 28px;background:${BRAND.night};"><a href="${SITE_ORIGIN}" style="text-decoration:none;"><img src="${SITE_ORIGIN}/images/email-mark.png" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:8px;"><span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">Nūr Meet</span></a></td></tr>
${image}
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${BRAND.ink};">${escape(content.heading)}</h1>
${paragraphs}${details}${cta}${links}
</td></tr>
<tr><td style="padding:20px 28px;background:${BRAND.canvas};font-size:12px;line-height:1.6;color:${BRAND.ink2};">Nūr Meet · des soirées en petit comité dans des restaurants partenaires à Paris et en Île-de-France.<br><a href="${SITE_ORIGIN}" style="color:${BRAND.ink2};">${new URL(SITE_ORIGIN).host}</a> · contact@nourmeet.com</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    content.heading, "",
    ...content.paragraphs.flatMap(p => [p, ""]),
    ...(content.details ?? []).map(d => `${d.label} : ${d.value}`),
    ...(content.details?.length ? [""] : []),
    ...(content.cta ? [`${content.cta.label} : ${content.cta.url}`, ""] : []),
    ...(content.links ?? []).map(l => `${l.label} : ${l.url}`),
    "", "L’équipe Nūr Meet", "contact@nourmeet.com"
  ].join("\n");
  return { html, text };
}
