export interface EventCategoryDef { name: string; defaultImage: string }
// Catégories disponibles au lancement. Pour en ajouter une nouvelle : ajouter une entrée ici
// (aucune migration de base de données n'est nécessaire, "category" est un simple champ texte).
export const EVENT_CATEGORIES: EventCategoryDef[] = [
  { name: "Speed dating", defaultImage: "/static/defaults/speed-dating.svg" },
  { name: "Networking", defaultImage: "/static/defaults/networking.svg" }
];
export const EVENT_CATEGORY_NAMES = EVENT_CATEGORIES.map(c => c.name);

export type UserRole = "PARTICIPANT" | "ORGANIZER" | "MODERATOR" | "RECEPTION" | "ADMIN";
export type EventStatus = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "FULL" | "CANCELLED" | "COMPLETED";
export type RestaurantStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type ApplicationStatus = "PENDING_CALL" | "CALL_SCHEDULED" | "CALL_COMPLETED" | "ACCEPTED" | "REFUSED" | "PAYMENT_PENDING" | "CONFIRMED" | "CANCELLED" | "NO_SHOW";

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
  imageUrl: string;
  capacity: number;
  confirmedCount: number;
  priceCents: number;
  status: EventStatus;
  organizer: {id: string | null; name: string};
  venue: {id: string; name: string} | null;
}

export interface ApiError { error: string; details?: unknown }
