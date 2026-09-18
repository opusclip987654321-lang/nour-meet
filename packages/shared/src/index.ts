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

// Zones géographiques utilisées pour proposer des événements alternatifs (même catégorie + même zone).
export const EVENT_ZONES = ["Paris intra-muros", "La Défense", "Île-de-France (banlieue)"];

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
  capacity: number;
  confirmedCount: number;
  priceCents: number;
  status: EventStatus;
  organizer: {id: string | null; name: string};
  venue: {id: string; name: string} | null;
  quotas: {category: QuotaCategory; capacity: number; heldCount: number}[];
}

export interface ApiError { error: string; details?: unknown }
