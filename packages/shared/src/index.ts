// "color" sert à distinguer visuellement les types d'événement (§15 : couleur, icône et badge
// distincts pour le speed dating et le networking) — une teinte, pas un composant, pour rester
// utilisable aussi bien côté web que mobile sans dépendre de React. L'icône associée à chaque
// catégorie vit côté web/mobile (voir CATEGORY_ICON dans App.tsx) : une catégorie sans icône
// enregistrée retombe sur un simple point de la bonne couleur plutôt que de casser l'affichage.
export interface EventCategoryDef { name: string; defaultImage: string; color: string }
// Catégories disponibles au lancement. Pour en ajouter une nouvelle : ajouter une entrée ici
// (aucune migration de base de données n'est nécessaire, "category" est un simple champ texte).
// Visuels génériques (banque d'images libres de droits, licence Unsplash) en attendant que chaque
// restaurateur ajoute ses propres photos via la galerie d'événement — jamais présentés comme des
// photos réelles d'un lieu ou d'un participant Nūr Meet, seulement une ambiance de catégorie.
export const EVENT_CATEGORIES: EventCategoryDef[] = [
  { name: "Speed dating", defaultImage: "/static/defaults/speed-dating.jpg", color: "#cba969" },
  { name: "Networking", defaultImage: "/static/defaults/networking.jpg", color: "#b97a52" }
];
export const EVENT_CATEGORY_NAMES = EVENT_CATEGORIES.map(c => c.name);

// Catégorie dont les places peuvent être réparties en quotas (ex. hommes/femmes).
// Limité au speed dating pour l'instant ; à étendre ici si besoin plus tard, sans migration.
export const QUOTA_ELIGIBLE_CATEGORY = "Speed dating";

// Zones géographiques ; chacune appartient à une région. Les propositions d'événements alternatifs
// comparent la RÉGION (ex. Île-de-France), pas la zone précise : un participant complet à Paris
// intra-muros peut se voir proposer un événement à La Défense, tant que la région correspond.
export const EVENT_ZONE_REGIONS: Record<string, string> = {
  "Paris intra-muros": "Île-de-France",
  "La Défense": "Île-de-France",
  "Île-de-France (banlieue)": "Île-de-France"
};
export const EVENT_ZONES = Object.keys(EVENT_ZONE_REGIONS);
export const regionOfZone = (zone: string | null | undefined) => zone ? EVENT_ZONE_REGIONS[zone] ?? zone : null;

// Détermine le parcours d'inscription : jamais par comparaison de la catégorie (texte libre,
// configurable), toujours via ce champ explicite posé sur l'événement. SCREENING exige un profil
// validé (entretien) et bloque le paiement tant qu'il ne l'est pas ; DIRECT autorise le paiement
// immédiat après un simple questionnaire non bloquant. Utilisé à l'identique par l'API et le web.
export type EventFlow = "SCREENING" | "DIRECT";
export const eventRequiresScreening = (event: { flow: EventFlow }) => event.flow === "SCREENING";
// Valeur suggérée à la création d'un événement selon sa catégorie ; un administrateur peut toujours
// la corriger explicitement (le champ stocké sur l'événement reste la seule source de vérité).
export const suggestedFlowForCategory = (category: string): EventFlow => category === "Speed dating" ? "SCREENING" : "DIRECT";

// Les 7 questions imposées par le cahier des charges pour chaque parcours (§4.1 et §4.2). Les clés
// correspondent aux colonnes de ScreeningAnswer / NetworkingAnswer côté API.
export const SCREENING_QUESTIONS: { key: keyof ScreeningAnswers; label: string }[] = [
  { key: "motivation", label: "Qu’est-ce qui vous motive à participer à cette rencontre ?" },
  { key: "relationshipGoal", label: "Quel type de relation recherchez-vous et dans quelle perspective ?" },
  { key: "personality", label: "Comment décririez-vous votre personnalité ?" },
  { key: "desiredQualities", label: "Quelles qualités recherchez-vous chez l’autre ?" },
  { key: "ageRangeSought", label: "Quelle tranche d’âge recherchez-vous ?" },
  { key: "valuesAndLifestyle", label: "Quelles valeurs ou habitudes de vie souhaitez-vous partager ?" },
  { key: "noteForOrganizer", label: "Quelle information utile souhaitez-vous communiquer à l’organisateur ?" }
];
export interface ScreeningAnswers {
  motivation: string;
  relationshipGoal: string;
  personality: string;
  desiredQualities: string;
  ageRangeSought: string;
  valuesAndLifestyle: string;
  noteForOrganizer?: string | null;
}

export const NETWORKING_QUESTIONS: { key: keyof NetworkingAnswers; label: string }[] = [
  { key: "sector", label: "Dans quel secteur professionnel évoluez-vous ?" },
  { key: "currentRole", label: "Quelle est votre activité ou fonction actuelle ?" },
  { key: "experienceLevel", label: "Quel est votre niveau ou nombre d’années d’expérience ?" },
  { key: "goal", label: "Quel est votre objectif : associés, clients, emploi, réseau ou autre ?" },
  { key: "soughtProfiles", label: "Quels profils souhaitez-vous rencontrer ?" },
  { key: "contribution", label: "Que pouvez-vous apporter aux autres participants ?" },
  { key: "topics", label: "Sur quels projets ou opportunités souhaitez-vous échanger ?" }
];
export interface NetworkingAnswers {
  sector: string;
  currentRole: string;
  experienceLevel: string;
  goal: string;
  soughtProfiles: string;
  contribution: string;
  topics: string;
}

export type UserRole = "PARTICIPANT" | "ORGANIZER" | "MODERATOR" | "RECEPTION" | "ADMIN";
export type EventStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "FULL" | "CANCELLED" | "COMPLETED";
export type RestaurantStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type ApplicationStatus = "PENDING_CALL" | "CALL_SCHEDULED" | "CALL_COMPLETED" | "ACCEPTED" | "REFUSED" | "PAYMENT_PENDING" | "CONFIRMED" | "CANCELLED" | "NO_SHOW";
export type QuotaCategory = "HOMME" | "FEMME";
export type AlternativeOfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export interface SessionUser {
  id: string;
  // Facultatif depuis la connexion par Google ou e-mail (2026-09-24) ; vérifié une seule fois par
  // SMS avant la première réservation (phoneVerified).
  phone: string | null;
  phoneVerified?: boolean;
  googleLinked?: boolean;
  email?: string | null;
  displayName: string;
  role: UserRole;
  profileCompleted: boolean;
  hasRestaurant: boolean;
  // true si la version en vigueur des CGU (LEGAL_VERSIONS.CGU) a été acceptée par ce compte.
  cguAccepted?: boolean;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  flow: EventFlow;
  description: string;
  startsAt: string;
  endsAt: string;
  district: string;
  address?: string | null;
  zone: string | null;
  imageUrl: string;
  photos: string[];
  perks: { drink: boolean; starter: boolean; main: boolean; dessert: boolean; description: string | null };
  minAge: number | null;
  maxAge: number | null;
  // C24 (ordre correctif 2026-09-20) : jamais capacity/quotas bruts au participant, seulement une
  // disponibilité déjà réduite à ce qui le concerne (voir eventAvailability côté API).
  availability: { kind: "category"; remaining: number; full: boolean } | { kind: "general"; remaining: number; full: boolean } | { kind: "unknown" };
  hasQuotas: boolean;
  priceCents: number;
  priceTiers: { category: QuotaCategory; amountCents: number }[];
  status: EventStatus;
  organizer: {id: string | null; name: string};
  venue: {id: string; name: string} | null;
  highlightTier: "simple" | "priority" | null;
  // Statut du visiteur connecté sur cet événement (null pour un visiteur anonyme ou sans lien avec
  // l'événement) — voir eventViewerStatus.
  viewerStatus: EventViewerStatus;
  // false pour un événement qui ne peut pas être réservé (données de démonstration) : jamais affiché,
  // utilisé seulement pour ne pas l'annoncer aux moteurs de recherche.
  bookable: boolean;
}

// Corrections web 2026-09-24 (§5.2) : seuls deux états sont signalés sur une carte d'événement —
// « Participe déjà » (place réellement confirmée, billet émis) et « Liste d'attente » (inscrit sur la
// liste d'attente sans place confirmée). Tout le reste n'affiche rien : pas de statut « Pas intéressé ».
export type EventViewerStatus = "CONFIRMED" | "WAITLIST" | null;
export const EVENT_VIEWER_STATUS_LABEL: Record<"CONFIRMED" | "WAITLIST", string> = { CONFIRMED: "Participe déjà", WAITLIST: "Liste d’attente" };
export const eventViewerStatus = (link: { reservation?: { confirmedAt: Date | string | null; cancelledAt: Date | string | null } | null; onWaitlist?: boolean }): EventViewerStatus => {
  if (link.reservation?.confirmedAt && !link.reservation.cancelledAt) return "CONFIRMED";
  if (link.onWaitlist) return "WAITLIST";
  return null;
};

// §5.1 : catalogue participant = uniquement les événements futurs, du plus proche au plus éloigné,
// triés sur la vraie date (jamais sur une chaîne formatée, où « 10/10 » passerait avant « 26/09 »).
export const upcomingEventsInOrder = <T extends { startsAt: Date | string }>(events: T[], now: Date = new Date()): T[] =>
  events.filter(e => new Date(e.startsAt).getTime() > now.getTime()).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

export interface ApiError { error: string; details?: unknown }

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Abonnement restaurateur (décision du 2026-09-25) : une seule règle, appliquée par l'API et
// seulement affichée par le site et l'application. Immédiat (avec prorata facturé par Stripe) pour une
// formule plus chère ou le passage du mensuel à l'annuel ; à la fin de la période déjà payée pour une
// formule moins chère ou le passage de l'annuel au mensuel — jamais de période payée écourtée.
export type BillingPeriod = "MONTHLY" | "ANNUAL";
export type SubscriptionChangeTiming = "IMMEDIATE" | "AT_PERIOD_END";
export function subscriptionChangeTiming(current: { monthlyPriceCents: number; billingPeriod: BillingPeriod }, target: { monthlyPriceCents: number; billingPeriod: BillingPeriod }): SubscriptionChangeTiming {
  if (current.billingPeriod === "ANNUAL" && target.billingPeriod === "MONTHLY") return "AT_PERIOD_END";
  if (target.monthlyPriceCents < current.monthlyPriceCents) return "AT_PERIOD_END";
  return "IMMEDIATE";
}

// Versions en vigueur des textes juridiques (apps/web/src/legal/*.md) : à changer ici à chaque
// modification substantielle d'un texte. L'API refuse alors toute action couverte par ce texte tant
// qu'une nouvelle acceptation n'a pas été enregistrée (voir le modèle LegalAcceptance).
export const LEGAL_VERSIONS = { CGU: "2026-09-25", CGV: "2026-09-25" } as const;

// Service réservé aux personnes majeures (CGU §2) : l'âge est calculé en années révolues, à la
// date du jour, jamais approximé en divisant une durée par 365,25 jours.
export const MINIMUM_AGE = 18;
export const ageInYears = (birthDate: Date | string, now: Date = new Date()): number => {
  const birth = new Date(birthDate);
  const age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
};
export const isAdult = (birthDate: Date | string | null | undefined, now: Date = new Date()): boolean =>
  !!birthDate && !Number.isNaN(new Date(birthDate).getTime()) && ageInYears(birthDate, now) >= MINIMUM_AGE;
export * from "./article.js";
export * from "./interests.js";
export * from "./interviews.js";
