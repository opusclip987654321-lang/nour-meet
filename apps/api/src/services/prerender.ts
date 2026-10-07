import { ARTICLE_PHOTOS, PAGE_META, PARTICIPANT_FAQ, RESTAURANT_FAQ, SITE_NAME, breadcrumbJsonLd, blogPostingJsonLd, eventJsonLd, faqPageJsonLd, isAllowedInternalPath, pageTitle, parseArticleContent } from "@nour/shared";
import type { FaqItem, SeoArticle, SeoEvent } from "@nour/shared";

// Pages publiques servies déjà remplies (audit SEO du 2026-10-07) : le site est une application
// React, et sans ce passage chaque URL renvoyait aux robots le même HTML (titre de l'accueil puis
// « Activez JavaScript »). Bing lisait mal les pages et GPTBot, ClaudeBot ou PerplexityBot ne
// voyaient aucun article. Caddy envoie ici les pages publiques ; on reprend l'index.html du site
// (mêmes fichiers JS et CSS) et on y pose titre, description, canonique, Open Graph, données
// structurées et le texte de la page. Au chargement, React remplace ce contenu par la page
// interactive (createRoot vide #root) et useSeo retire les données structurées posées ici.
// Rien de ce qui est écrit ici n'est inventé : uniquement les textes affichés par les pages du site.

export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// JSON dans une balise <script> : « </script> » ou « <!-- » dans un texte fermeraient la balise.
const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export type PrerenderedPage = {
  title: string;
  description: string;
  path: string | null;
  image: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: object[];
  body: string;
};

const META_TO_REPLACE = /\s*<meta (?:name="(?:description|robots|twitter:[a-z]+)"|property="og:(?:type|title|description|image|url)")[^>]*>/g;

export function injectPage(template: string, siteUrl: string, page: PrerenderedPage) {
  const title = escapeHtml(pageTitle(page.title));
  const description = escapeHtml(page.description);
  const url = page.path != null ? escapeHtml(`${siteUrl}${page.path}`) : null;
  const image = escapeHtml(page.image);
  const head = [
    `<meta name="description" content="${description}" />`,
    page.noindex ? `<meta name="robots" content="noindex, nofollow" />` : url ? `<link rel="canonical" href="${url}" />` : "",
    `<meta property="og:type" content="${page.type ?? "website"}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    url ? `<meta property="og:url" content="${url}" />` : "",
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    ...(page.noindex ? [] : page.jsonLd ?? []).map(data => `<script type="application/ld+json" data-seo="ssr">${jsonForScript(data)}</script>`)
  ].filter(Boolean).join("\n    ");
  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(META_TO_REPLACE, "")
    .replace(/<link rel="canonical"[^>]*>/g, "")
    .replace("</head>", `    ${head}\n  </head>`)
    // Le bloc <noscript> générique (texte de l'accueil) n'a plus lieu d'être : la page porte le sien.
    .replace(/\s*(?:<!--[^>]*?-->\s*)?<noscript>[\s\S]*?<\/noscript>/, "")
    .replace(/<div id="root"><\/div>/, `<div id="root">${page.body}</div>`);
}

// Gabarit commun : en-tête et pied de page réduits aux liens publics, lisibles sans JavaScript.
const shell = (main: string) => `<header class="site-header"><div class="site-header-inner"><a href="/" class="logo">${SITE_NAME}</a><nav class="site-nav" aria-label="Navigation principale"><a href="/events">Événements</a> <a href="/concept">Comment ça marche</a> <a href="/blog">Le journal</a> <a href="/restaurateurs">Restaurateurs</a></nav></div></header>
<main>${main}</main>
<footer class="site-footer"><nav aria-label="Informations légales"><a href="/legal/mentions-legales">Mentions légales</a> · <a href="/legal/cgu">CGU</a> · <a href="/legal/cgv">CGV</a> · <a href="/legal/confidentialite">Confidentialité</a> · <a href="/legal/cookies">Cookies</a></nav><p><a href="mailto:contact@nourmeet.com">contact@nourmeet.com</a></p></footer>`;

const faqHtml = (items: FaqItem[]) => `<section class="section faq"><h2>Vos questions</h2><div class="faq-list">${items.map(f => `<details open><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join("")}</div></section>`;

const dateFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
export const eventDate = (value: Date | string) => dateFormat.format(new Date(value)).replace(/(\d{2}):(\d{2})/, "$1h$2");
const money = (cents: number) => cents === 0 ? "Gratuit" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

// Texte d'un paragraphe d'article : mêmes règles de liens que le site (ArticleBody.renderInline).
const inline = (text: string) => text.split(/(\[[^\]]+\]\([^)\s]+\))/g).map(part => {
  const match = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (!match) return escapeHtml(part);
  const [, label, url] = match;
  if (url.startsWith("/")) return isAllowedInternalPath(url) ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
  if (/^https?:\/\//.test(url)) return `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  return escapeHtml(label);
}).join("");

export const articleBodyHtml = (content: string) => parseArticleContent(content).map(block => {
  switch (block.type) {
    case "heading": return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    case "paragraph": return `<p>${inline(block.text)}</p>`;
    case "list": return `<ul>${block.items.map(item => `<li>${inline(item)}</li>`).join("")}</ul>`;
    case "quote": return `<blockquote>${inline(block.text)}</blockquote>`;
    case "image": return ARTICLE_PHOTOS[block.photo] ? `<figure class="article-figure"><img src="/images/${escapeHtml(block.photo)}-1024.webp" alt="${escapeHtml(block.alt)}" loading="lazy" /><figcaption>Photo d’illustration</figcaption></figure>` : "";
    case "chart": {
      const unit = block.chart.unit ? `\u202f${block.chart.unit}` : "";
      return `<figure class="article-chart"><figcaption>${escapeHtml(block.chart.title)}</figcaption><table><thead><tr><th scope="col">Libellé</th><th scope="col">Valeur</th></tr></thead><tbody>${block.chart.data.map(d => `<tr><td>${escapeHtml(d.label)}</td><td>${escapeHtml(`${d.value.toLocaleString("fr-FR")}${unit}`)}</td></tr>`).join("")}</tbody></table><p class="article-chart-source">Source : <a href="${escapeHtml(block.chart.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(block.chart.sourceLabel)}</a></p></figure>`;
    }
    case "cta": return isAllowedInternalPath(block.path) ? `<p class="article-cta"><a class="button" href="${escapeHtml(block.path)}">${escapeHtml(block.label)}</a></p>` : "";
  }
}).join("\n");

// Image absolue : photothèque du site (« photo:nom ») ou fichier servi par l'API (comme imgUrl côté web).
export const articleCoverUrl = (imageUrl: string | null, siteUrl: string, apiUrl: string) => {
  if (imageUrl?.startsWith("photo:")) return `${siteUrl}/images/${imageUrl.slice(6)}-1600.webp`;
  if (!imageUrl) return null;
  return /^https?:\/\//.test(imageUrl) ? imageUrl : `${apiUrl}${imageUrl}`;
};
export const eventImageUrl = (imageUrl: string, apiUrl: string) => /^https?:\/\//.test(imageUrl) ? imageUrl : `${apiUrl}${imageUrl}`;

export type PrerenderEvent = SeoEvent & { category: string; imageUrl: string; bookable: boolean; perks: { drink: boolean; starter: boolean; main: boolean; dessert: boolean; description: string | null } };
export type PrerenderArticle = SeoArticle & { content: string; imageUrl: string | null; metaTitle?: string | null; metaDescription?: string | null };

// Disponibilité anonyme (C24) : jamais un nombre de places d'une soirée à quotas.
const availabilityText = (event: PrerenderEvent) => event.status === "FULL" || (event.availability.kind !== "unknown" && event.availability.full) ? "Complet (liste d’attente)" : "Places disponibles";
const perksText = (perks: PrerenderEvent["perks"]) => [perks.drink && "boisson", perks.starter && "entrée", perks.main && "plat", perks.dessert && "dessert"].filter(Boolean).join(", ");

const eventCardHtml = (event: PrerenderEvent, headingLevel: 2 | 3) => `<article class="event-card"><div class="event-copy"><p class="event-date">${escapeHtml(event.category)} · <time datetime="${new Date(event.startsAt).toISOString()}">${escapeHtml(eventDate(event.startsAt))}</time></p><h${headingLevel} class="event-title"><a href="/events/${escapeHtml(event.slug)}">${escapeHtml(event.title)}</a></h${headingLevel}><p>${escapeHtml(event.venue ? `${event.venue.name}, ${event.district}` : event.district)} · ${escapeHtml(money(event.priceCents))} · ${availabilityText(event)}</p></div></article>`;

type Urls = { siteUrl: string; apiUrl: string; defaultImage: string };

export function homePage(events: PrerenderEvent[], urls: Urls, social: string[]): PrerenderedPage {
  return {
    ...PAGE_META.home, path: "/", image: urls.defaultImage,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, url: urls.siteUrl, logo: `${urls.siteUrl}/icon-512.png`, email: "contact@nourmeet.com", areaServed: { "@type": "AdministrativeArea", name: "Île-de-France" }, sameAs: social },
      { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: urls.siteUrl, inLanguage: "fr-FR" },
      faqPageJsonLd(PARTICIPANT_FAQ)
    ],
    body: shell(`<section class="home-hero"><h1>Des soirées pour faire de vraies rencontres.</h1><p class="hero-lead">Speed dating et networking en petit comité, dans des restaurants à Paris et en Île-de-France. Des participants vérifiés, qui partagent vos valeurs.</p><p><a class="button accent" href="/events">Voir les prochaines soirées</a></p></section>
<section class="section"><h2>Le principe, en trois points</h2><h3>Une vraie table, pas une appli</h3><p>Une soirée en petit comité, dans un restaurant partenaire.</p><h3>Des personnes vérifiées</h3><p>Numéro confirmé pour tous, entretien pour les rencontres.</p><h3>Vous choisissez qui vous revoyez</h3><p>Rien ne s’ouvre sans votre accord mutuel.</p></section>
<section class="section"><h2>Les prochaines soirées</h2>${events.length ? `<div class="event-grid">${events.map(e => eventCardHtml(e, 3)).join("")}</div>` : "<p>Aucune soirée publiée pour le moment.</p>"}<p><a href="/events">Tout le calendrier</a></p></section>
${faqHtml(PARTICIPANT_FAQ)}`)
  };
}

export function eventsPage(events: PrerenderEvent[], category: string | null, urls: Urls): PrerenderedPage {
  const bookable = events.filter(e => e.bookable);
  return {
    ...(category ? PAGE_META.eventsCategory(category) : PAGE_META.events), path: "/events", image: urls.defaultImage,
    jsonLd: [breadcrumbJsonLd(urls.siteUrl, [{ name: "Accueil", path: "/" }, { name: "Soirées", path: "/events" }]), ...bookable.map(e => eventJsonLd(e, urls.siteUrl, eventImageUrl(e.imageUrl, urls.apiUrl)))],
    body: shell(`<section class="page"><h1>Les prochaines soirées</h1><p class="page-lead">Speed dating sur sélection ou networking en accès direct, dans des restaurants partenaires à Paris et en Île-de-France. Chaque fiche indique le lieu, l’organisateur, le prix et ce qui est compris.</p>${events.length ? `<p class="results-count">${events.length} soirée${events.length > 1 ? "s" : ""} à venir</p><div class="event-grid">${events.map(e => eventCardHtml(e, 2)).join("")}</div>` : "<p>Aucune soirée ne correspond pour le moment : de nouvelles dates sont publiées régulièrement.</p>"}</section>`)
  };
}

export function eventPage(event: PrerenderEvent, urls: Urls): PrerenderedPage {
  const path = `/events/${event.slug}`;
  const perks = perksText(event.perks);
  return {
    title: `${event.title} · ${event.category} à ${event.district}`, description: event.description.slice(0, 155), path,
    image: eventImageUrl(event.imageUrl, urls.apiUrl), noindex: !event.bookable,
    jsonLd: [eventJsonLd(event, urls.siteUrl, eventImageUrl(event.imageUrl, urls.apiUrl)), breadcrumbJsonLd(urls.siteUrl, [{ name: "Accueil", path: "/" }, { name: "Soirées", path: "/events" }, { name: event.title, path }])],
    body: shell(`<article class="page"><nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/events">Toutes les soirées</a></nav><p>${escapeHtml(event.category)}</p><h1>${escapeHtml(event.title)}</h1>
<ul><li>Date : <time datetime="${new Date(event.startsAt).toISOString()}">${escapeHtml(eventDate(event.startsAt))}</time></li><li>Lieu : ${escapeHtml(event.venue ? `${event.venue.name}, ${event.district}` : event.district)} (adresse exacte communiquée avec le billet)</li><li>Organisateur : ${escapeHtml(event.organizer.name)}</li><li>Prix : ${escapeHtml(money(event.priceCents))} TTC${perks ? `, ${escapeHtml(perks)} compris` : ""}</li>${event.perks.description ? `<li>${escapeHtml(event.perks.description)}</li>` : ""}<li>${availabilityText(event)}</li>${event.minAge ? `<li>Âge : ${event.maxAge ? `de ${event.minAge} à ${event.maxAge} ans` : `à partir de ${event.minAge} ans`}</li>` : ""}</ul>
${event.description.split(/\n{2,}/).map(p => `<p>${escapeHtml(p.trim())}</p>`).join("")}
<p>Annulation gratuite jusqu’à 24 heures avant la soirée, avec remboursement intégral. Paiement par carte via Stripe, billet avec QR code dans votre espace.</p></article>`)
  };
}

export function conceptPage(urls: Urls): PrerenderedPage {
  return {
    ...PAGE_META.concept, path: "/concept", image: urls.defaultImage,
    jsonLd: [breadcrumbJsonLd(urls.siteUrl, [{ name: "Accueil", path: "/" }, { name: "Comment ça marche", path: "/concept" }]), faqPageJsonLd(PARTICIPANT_FAQ)],
    body: shell(`<section class="page"><h1>Comment fonctionne Nūr Meet</h1><p class="page-lead">Vous choisissez une soirée, vous réservez, vous venez. Après, c’est vous qui décidez qui vous revoyez.</p><p><a class="button" href="/events">Voir les prochaines soirées</a></p></section>
<section class="section"><h2>Deux formats, deux parcours</h2>
<h3>Speed dating : pour une relation sérieuse</h3><ol><li><b>Entretien de validation</b> : un court appel, une seule fois.</li><li><b>Questionnaire privé</b> : ce que vous recherchez. Jamais partagé.</li><li><b>Réservation</b> : paiement, puis billet QR.</li><li><b>La soirée</b> : tête-à-tête courts, puis échanges libres.</li></ol>
<h3>Networking : pour élargir votre réseau</h3><ol><li><b>Inscription directe</b> : aucun entretien.</li><li><b>Réservation</b> : paiement, puis billet QR.</li><li><b>La soirée</b> : des échanges entre professionnels, autour d’une table.</li></ol></section>
<section class="section"><h2>Réserver, payer, venir</h2><ul><li>Prix final affiché, TTC, avec ce qui est compris</li><li>Paiement par carte via Stripe</li><li>Billet QR et adresse exacte dans votre espace</li><li>Annulation gratuite jusqu’à 24 h, remboursement automatique</li><li>Soirée complète ? Liste d’attente, et une soirée comparable si elle existe</li><li>Compte supprimable à tout moment</li></ul></section>
${faqHtml(PARTICIPANT_FAQ)}`)
  };
}

export function restaurateursPage(urls: Urls): PrerenderedPage {
  return {
    ...PAGE_META.restaurateurs, path: "/restaurateurs", image: urls.defaultImage,
    jsonLd: [breadcrumbJsonLd(urls.siteUrl, [{ name: "Accueil", path: "/" }, { name: "Restaurateurs", path: "/restaurateurs" }]), faqPageJsonLd(RESTAURANT_FAQ)],
    body: shell(`<section class="page"><h1>Restaurateurs : accueillez des soirées Nūr Meet</h1><p class="page-lead">${escapeHtml(PAGE_META.restaurateurs.description)}</p><p><a class="button" href="/login">Créer mon compte restaurateur</a></p></section>
${faqHtml(RESTAURANT_FAQ)}`)
  };
}

export function blogPage(articles: (Pick<PrerenderArticle, "slug" | "title" | "excerpt" | "category" | "publishedAt">)[], urls: Urls): PrerenderedPage {
  return {
    ...PAGE_META.blog, path: "/blog", image: urls.defaultImage,
    jsonLd: [breadcrumbJsonLd(urls.siteUrl, [{ name: "Accueil", path: "/" }, { name: "Le journal", path: "/blog" }])],
    body: shell(`<section class="page"><h1>Rencontres, amitié et vie sociale</h1><p class="page-lead">Des repères concrets et des études sourcées pour rencontrer, se faire des amis et développer son réseau.</p>${articles.length ? `<div class="event-grid">${articles.map(a => `<article class="event-card"><div class="event-copy"><p class="event-date">${escapeHtml(a.category)}${a.publishedAt ? ` · ${escapeHtml(dayFormat.format(new Date(a.publishedAt)))}` : ""}</p><h2 class="event-title"><a href="/blog/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a></h2>${a.excerpt ? `<p class="article-excerpt">${escapeHtml(a.excerpt)}</p>` : ""}</div></article>`).join("")}</div>` : "<p>Aucun article pour le moment.</p>"}</section>`)
  };
}

export function articlePage(article: PrerenderArticle, urls: Urls): PrerenderedPage {
  const path = `/blog/${article.slug}`;
  const cover = articleCoverUrl(article.imageUrl, urls.siteUrl, urls.apiUrl);
  return {
    title: article.metaTitle || article.title, description: article.metaDescription || article.excerpt || PAGE_META.blog.description, path,
    image: cover ?? urls.defaultImage, type: "article",
    jsonLd: [blogPostingJsonLd(article, urls.siteUrl, cover), breadcrumbJsonLd(urls.siteUrl, [{ name: "Accueil", path: "/" }, { name: "Le journal", path: "/blog" }, { name: article.title, path }])],
    body: shell(`<article class="page article-page"><nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/blog">Le journal</a></nav><p class="article-meta">${escapeHtml(article.category)}${article.publishedAt ? ` · <time datetime="${new Date(article.publishedAt).toISOString()}">${escapeHtml(dayFormat.format(new Date(article.publishedAt)))}</time>` : ""}</p><h1>${escapeHtml(article.title)}</h1>${article.excerpt ? `<p class="page-lead">${escapeHtml(article.excerpt)}</p>` : ""}
<div class="article-body">${articleBodyHtml(article.content)}</div>
<aside class="article-end"><p>Envie de passer de la lecture à la rencontre ?</p><a class="button" href="/events">Voir les prochaines soirées</a></aside></article>`)
  };
}

export function notFoundPage(urls: Urls): PrerenderedPage {
  return { title: "Page introuvable", description: "Cette page n’existe pas ou n’est plus en ligne.", path: null, image: urls.defaultImage, noindex: true, body: shell(`<section class="page"><h1>Page introuvable</h1><p>Cette page n’existe pas ou n’est plus en ligne.</p><p><a href="/events">Voir les prochaines soirées</a></p></section>`) };
}
