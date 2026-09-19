export interface EventCategoryDef { name: string; defaultImage: string }
// Catégories disponibles au lancement. Pour en ajouter une nouvelle : ajouter une entrée ici
// (aucune migration de base de données n'est nécessaire, "category" est un simple champ texte).
export const EVENT_CATEGORIES: EventCategoryDef[] = [
  { name: "Speed dating", defaultImage: "/static/defaults/speed-dating.svg" },
  { name: "Networking", defaultImage: "/static/defaults/networking.svg" }
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

export type UserRole = "PARTICIPANT" | "ORGANIZER" | "MODERATOR" | "RECEPTION" | "ADMIN";
export type EventStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "FULL" | "CANCELLED" | "COMPLETED";
export type RestaurantStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type ApplicationStatus = "PENDING_CALL" | "CALL_SCHEDULED" | "CALL_COMPLETED" | "ACCEPTED" | "REFUSED" | "PAYMENT_PENDING" | "CONFIRMED" | "CANCELLED" | "NO_SHOW";
export type QuotaCategory = "HOMME" | "FEMME";
export type AlternativeOfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export interface SessionUser {
  id: string;
  phone: string;
  email?: string | null;
  displayName: string;
  role: UserRole;
  profileCompleted: boolean;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  startsAt: string;
  endsAt: string;
  district: string;
  address?: string | null;
  zone: string | null;
  imageUrl: string;
  photos: string[];
  perks: { drink: boolean; starter: boolean; main: boolean; dessert: boolean; description: string | null };
  capacity: number;
  confirmedCount: number;
  priceCents: number;
  priceTiers: { category: QuotaCategory; amountCents: number }[];
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
  status: EventStatus;
  organizer: {id: string | null; name: string};
  venue: {id: string; name: string} | null;
  quotas: {category: QuotaCategory; capacity: number; heldCount: number}[];
}

export interface ApiError { error: string; details?: unknown }
