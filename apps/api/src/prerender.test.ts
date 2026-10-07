import { describe, expect, it } from "vitest";
import { articleBodyHtml, articlePage, conceptPage, eventPage, eventsPage, injectPage, notFoundPage } from "./services/prerender.js";

// Pages publiques servies déjà remplies aux robots (audit SEO 2026-10-07).
const TEMPLATE = `<!doctype html>
<html lang="fr">
  <head>
    <script>try{}catch(e){}</script>
    <title>Nūr Meet — rencontres et soirées en petit comité à Paris</title>
    <meta name="description" content="Description de l'accueil" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Nūr Meet" />
    <meta property="og:title" content="Titre de l'accueil" />
    <meta property="og:description" content="Description de l'accueil" />
    <meta property="og:image" content="https://nourmeet.com/images/paris-terrace-1600.webp" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body>
    <div id="root"></div>
    <!-- Contenu lisible sans JavaScript -->
    <noscript>
      <p>Activez JavaScript pour réserver une soirée.</p>
    </noscript>
  </body>
</html>`;
const urls = { siteUrl: "https://nourmeet.com", apiUrl: "https://api.nourmeet.com", defaultImage: "https://nourmeet.com/images/paris-terrace-1600.webp" };
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json" data-seo="ssr">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

const article = {
  slug: "rencontrer-apres-35-ans", title: "Rencontrer quelqu’un après 35 ans", excerpt: "Des repères concrets.", category: "Rencontres", keywords: ["rencontre"],
  publishedAt: new Date("2026-10-01T08:00:00Z"), updatedAt: new Date("2026-10-02T08:00:00Z"), author: null, imageUrl: "photo:friends-duo", metaTitle: null, metaDescription: null,
  content: "## Pourquoi c’est différent\n\nUn paragraphe avec [les soirées](/events) et [une source](https://insee.fr) et [un lien interdit](/admin).\n\n- premier point\n- second point\n\n[[cta:/events|Voir les soirées]]"
};
const event = {
  slug: "speed-dating-paris-11", title: "Speed dating du jeudi", category: "Speed dating", description: "Une soirée en petit comité.\n\nTête-à-tête puis échanges libres.",
  startsAt: new Date("2026-11-05T18:30:00Z"), endsAt: new Date("2026-11-05T21:30:00Z"), status: "PUBLISHED", district: "Paris 11e",
  venue: { name: "Le Comptoir" }, organizer: { name: "Nūr Meet" }, priceCents: 3500, minAge: 25, maxAge: 40,
  availability: { kind: "unknown" as const }, imageUrl: "/static/defaults/speed-dating.jpg", bookable: true,
  perks: { drink: true, starter: false, main: true, dessert: false, description: null }
};

describe("injection dans l'index.html du site", () => {
  const html = injectPage(TEMPLATE, urls.siteUrl, articlePage(article, urls));
  it("pose le titre, la description et la canonique propres à la page, une seule fois", () => {
    expect(html).toContain("<title>Rencontrer quelqu’un après 35 ans — Nūr Meet</title>");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).toContain('content="Des repères concrets."');
    expect(html).toContain('<link rel="canonical" href="https://nourmeet.com/blog/rencontrer-apres-35-ans" />');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:site_name" content="Nūr Meet" />');
  });
  it("garde les fichiers JS et CSS de la version déployée et met le texte dans #root", () => {
    expect(html).toContain('src="/assets/index-abc.js"');
    expect(html).toContain('href="/assets/index-abc.css"');
    expect(html).toMatch(/<div id="root">[\s\S]*<h1>Rencontrer quelqu’un après 35 ans<\/h1>/);
    expect(html).not.toContain("Activez JavaScript");
  });
  it("déclare un BlogPosting fidèle à l'article", () => {
    const [posting, breadcrumb] = jsonLd(html);
    expect(posting).toMatchObject({ "@type": "BlogPosting", headline: article.title, mainEntityOfPage: "https://nourmeet.com/blog/rencontrer-apres-35-ans", image: "https://nourmeet.com/images/friends-duo-1600.webp" });
    expect(breadcrumb["@type"]).toBe("BreadcrumbList");
  });
  it("échappe le HTML et ne laisse jamais fermer une balise script depuis un texte", () => {
    const evil = injectPage(TEMPLATE, urls.siteUrl, articlePage({ ...article, title: "</script><script>alert(1)</script>" }, urls));
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;/script&gt;");
  });
  it("une page introuvable n'a ni canonique ni données structurées et demande noindex", () => {
    const missing = injectPage(TEMPLATE, urls.siteUrl, notFoundPage(urls));
    expect(missing).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(missing).not.toContain('rel="canonical"');
    expect(jsonLd(missing)).toHaveLength(0);
  });
});

describe("texte complet d'un article", () => {
  const body = articleBodyHtml(article.content);
  it("rend intertitres, listes et liens autorisés seulement", () => {
    expect(body).toContain("<h2>Pourquoi c’est différent</h2>");
    expect(body).toContain('<a href="/events">les soirées</a>');
    expect(body).toContain('<a href="https://insee.fr" rel="noopener noreferrer">une source</a>');
    expect(body).not.toContain('href="/admin"');
    expect(body).toContain("<li>second point</li>");
    expect(body).toContain('<a class="button" href="/events">Voir les soirées</a>');
  });
});

describe("soirées", () => {
  it("la liste porte chaque soirée réservable en Event, avec date, lieu, prix et disponibilité", () => {
    const page = eventsPage([event, { ...event, slug: "demo", bookable: false }], null, urls);
    const html = injectPage(TEMPLATE, urls.siteUrl, page);
    const events = jsonLd(html).filter(d => d["@type"] === "Event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "Speed dating du jeudi", location: { name: "Le Comptoir" }, offers: { price: "35.00", priceCurrency: "EUR", availability: "https://schema.org/InStock" }, image: ["https://api.nourmeet.com/static/defaults/speed-dating.jpg"] });
    expect(html).toContain('<a href="/events/speed-dating-paris-11">Speed dating du jeudi</a>');
    expect(html).toContain("jeudi 5 novembre 2026 à 19h30");
  });
  it("une soirée complète est déclarée SoldOut, une soirée de démonstration n'est pas indexée", () => {
    expect(jsonLd(injectPage(TEMPLATE, urls.siteUrl, eventPage({ ...event, status: "FULL" }, urls)))[0].offers.availability).toBe("https://schema.org/SoldOut");
    const demo = injectPage(TEMPLATE, urls.siteUrl, eventPage({ ...event, bookable: false }, urls));
    expect(demo).toContain('content="noindex, nofollow"');
    expect(jsonLd(demo)).toHaveLength(0);
  });
});

describe("Comment ça marche", () => {
  it("déclare la FAQ affichée sur la page", () => {
    const html = injectPage(TEMPLATE, urls.siteUrl, conceptPage(urls));
    const faq = jsonLd(html).find(d => d["@type"] === "FAQPage");
    expect(faq.mainEntity.length).toBeGreaterThan(3);
    expect(html).toContain(faq.mainEntity[0].name.replace("’", "’"));
    expect(html).toContain("<title>Comment ça marche : speed dating sur sélection et networking — Nūr Meet</title>");
  });
});
