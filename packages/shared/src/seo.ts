// Référencement partagé par le site (balises posées en JavaScript, apps/web/src/lib/seo.ts) et par
// l'API qui sert les pages publiques déjà remplies aux robots (apps/api/src/services/prerender.ts) :
// mêmes titres, mêmes descriptions, mêmes données structurées des deux côtés, jamais deux versions
// qui divergent avec le temps.

export const SITE_NAME = "Nūr Meet";
export const DEFAULT_DESCRIPTION = "Speed dating et soirées networking en petit comité dans des restaurants partenaires à Paris et en Île-de-France. Profils vérifiés, contact uniquement si l’intérêt est réciproque.";
export const pageTitle = (title: string) => title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;

export const PAGE_META = {
  home: { title: `${SITE_NAME} — rencontres et soirées en petit comité à Paris`, description: DEFAULT_DESCRIPTION },
  events: { title: "Prochaines soirées speed dating et networking à Paris", description: "Toutes les soirées à venir, de la plus proche à la plus lointaine : lieu, organisateur, prix et ce qui est compris." },
  eventsCategory: (category: string) => ({ title: `${category} à Paris : prochaines soirées`, description: PAGE_META.events.description }),
  concept: { title: "Comment ça marche : speed dating sur sélection et networking", description: "Le parcours réel d’une soirée Nūr Meet : choix de la soirée, entretien pour les rencontres, paiement sécurisé, billet QR et mise en relation seulement si l’intérêt est réciproque." },
  restaurateurs: { title: "Restaurateurs : accueillez des soirées Nūr Meet", description: "Accueillez des soirées speed dating et networking dans votre restaurant à Paris et en Île-de-France : places payées d’avance, participants vérifiés, formules sans engagement." },
  blog: { title: "Le journal : rencontres, amitié et vie sociale", description: "Conseils, repères et études pour faire de vraies rencontres, élargir son cercle d’amis et développer son réseau professionnel à Paris." }
} as const;

export type FaqItem = { q: string; a: string };

// Questions des participants : affichées sur l'accueil et sur « Comment ça marche », déclarées en
// FAQPage là où elles sont visibles.
export const PARTICIPANT_FAQ: FaqItem[] = [
  { q: "À qui s’adresse Nūr Meet ?", a: "Aux adultes de 18 ans et plus qui veulent rencontrer des personnes partageant leurs valeurs : pour une relation sérieuse (speed dating) ou pour élargir leur réseau (networking)." },
  { q: "Pourquoi un entretien pour le speed dating ?", a: "Pour que chacun vienne avec la même intention. C’est un court appel, une seule fois, valable pour toutes les soirées de rencontre. Le networking est en accès direct." },
  { q: "Et si mon profil n’est pas validé ?", a: "L’entretien sert à vérifier que votre démarche correspond au cadre des soirées. Si ce n’est pas le cas, vous pourrez refaire une demande plus tard." },
  { q: "Comment revoir quelqu’un après la soirée ?", a: "Échangez vos codes personnels : ils fonctionnent entre personnes inscrites à la même soirée, même si l’une d’elles n’a finalement pas pu venir. La personne reçoit votre demande et choisit : la conversation ne s’ouvre que si elle accepte." },
  { q: "Qui voit mes informations ?", a: "Aucun participant ne voit votre numéro ni votre e-mail. Le restaurant ne reçoit que votre prénom pour l’accueil ; vos réponses au questionnaire de rencontre restent privées." },
  { q: "Puis-je annuler ?", a: "Oui : remboursement intégral et automatique jusqu’à 24 heures avant la soirée. Passé ce délai, ou en cas d’absence, la place n’est pas remboursée. Si l’organisateur annule, vous êtes remboursé(e)." },
  { q: "Comment se passe le paiement ?", a: "Par carte, via Stripe : Nūr Meet ne conserve jamais vos données bancaires. Votre billet avec QR code arrive dans votre espace dès la confirmation." }
];

export const RESTAURANT_FAQ: FaqItem[] = [
  { q: "Suis-je engagé sur la durée ?", a: "Non. Vous résiliez depuis votre espace quand vous le souhaitez : la résiliation prend effet à la fin de la période déjà payée." },
  { q: "Qui fixe le prix des places ?", a: "Vous. Le prix est affiché TTC aux participants, avec ce qui est compris. L’équipe Nūr Meet peut demander un ajustement avant publication." },
  { q: "Comment suis-je payé pour les places vendues ?", a: "Nūr Meet encaisse les paiements via Stripe. Les sommes qui vous reviennent sont reversées au plus tard 15 jours ouvrés après la soirée. La commission et les frais applicables sont précisés dans votre offre professionnelle." },
  { q: "Et si ma soirée ne se remplit pas ?", a: "Vous pouvez fixer un nombre minimum de participants et une date de décision. À cette date, vous maintenez ou annulez la soirée ; en cas d’annulation, les participants sont remboursés automatiquement." },
  { q: "Mes soirées sont-elles publiées automatiquement ?", a: "Non. Chaque soirée est vérifiée par l’équipe avant publication, pour garantir la qualité de ce qui est proposé aux membres. Elle compte alors dans le nombre de soirées de votre formule." },
  { q: "Que recevez-vous des participants ?", a: "Le prénom de chaque participant pour l’accueil, et son billet à scanner. Leur numéro et leur e-mail ne sont jamais transmis aux restaurants." },
  { q: "Puis-je changer de formule ?", a: "Oui, depuis votre espace. Formule supérieure : immédiat, au prorata. Formule inférieure : à la fin de la période déjà payée." }
];

export const faqPageJsonLd = (items: FaqItem[]) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
});

export const breadcrumbJsonLd = (siteUrl: string, items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: `${siteUrl}${item.path}` }))
});

// Article publié : uniquement les champs réellement affichés sur la page.
export type SeoArticle = { slug: string; title: string; excerpt: string | null; category: string; keywords?: string[] | null; publishedAt: string | Date | null; updatedAt?: string | Date | null; author?: { displayName: string } | null };
export const blogPostingJsonLd = (article: SeoArticle, siteUrl: string, image: string | null) => ({
  "@context": "https://schema.org", "@type": "BlogPosting",
  headline: article.title, description: article.excerpt ?? undefined,
  image: image ?? undefined,
  datePublished: article.publishedAt ?? undefined, dateModified: article.updatedAt ?? article.publishedAt ?? undefined,
  author: article.author ? { "@type": "Person", name: article.author.displayName } : { "@type": "Organization", name: SITE_NAME },
  publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: `${siteUrl}/icon-512.png` } },
  mainEntityOfPage: `${siteUrl}/blog/${article.slug}`,
  articleSection: article.category, keywords: article.keywords?.join(", ") || undefined, inLanguage: "fr-FR"
});

// Soirée réservable (§19/§20) : jamais pour un événement de démonstration, que l'appelant écarte.
export type SeoEvent = {
  slug: string; title: string; description: string; startsAt: string | Date; endsAt: string | Date; status: string; district: string;
  venue: { name: string } | null; organizer: { name: string }; priceCents: number; minAge: number | null; maxAge: number | null;
  availability: { kind: "category" | "general"; full: boolean } | { kind: "unknown" };
};
export const eventJsonLd = (event: SeoEvent, siteUrl: string, image: string) => ({
  "@context": "https://schema.org", "@type": "Event", name: event.title, description: event.description,
  startDate: event.startsAt, endDate: event.endsAt,
  eventStatus: event.status === "CANCELLED" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", image: [image],
  location: { "@type": event.venue ? "Restaurant" : "Place", name: event.venue?.name ?? event.district, address: { "@type": "PostalAddress", addressLocality: event.district, addressRegion: "Île-de-France", addressCountry: "FR" } },
  organizer: { "@type": "Organization", name: event.organizer.name },
  offers: {
    "@type": "Offer", url: `${siteUrl}/events/${event.slug}`, price: (event.priceCents / 100).toFixed(2), priceCurrency: "EUR",
    // Une soirée à quotas n'a pas de disponibilité anonyme (C24) : seule une soirée complète pour tous
    // (statut FULL) ou une jauge générale épuisée est déclarée SoldOut.
    availability: event.status === "FULL" || (event.availability.kind !== "unknown" && event.availability.full) ? "https://schema.org/SoldOut" : "https://schema.org/InStock"
  },
  ...(event.minAge ? { typicalAgeRange: event.maxAge ? `${event.minAge}-${event.maxAge}` : `${event.minAge}-` } : {})
});
