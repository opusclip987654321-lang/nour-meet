export type UserRole = "PARTICIPANT" | "ORGANIZER" | "MODERATOR" | "RECEPTION" | "ADMIN";
export type EventStatus = "DRAFT" | "PUBLISHED" | "FULL" | "CANCELLED" | "COMPLETED";
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
  capacity: number;
  confirmedCount: number;
  priceCents: number;
  status: EventStatus;
  organizer: {id: string; name: string};
}

export interface ApiError { error: string; details?: unknown }
