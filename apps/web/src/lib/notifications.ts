import { api } from "../api";

export type AppNotification = { id: string; title: string; body: string; linkPath: string | null; readAt: string | null; createdAt: string };

// Corrections web 2026-09-24 (§4.3) : une seule règle de destination pour toutes les notifications,
// quel que soit l'endroit où elles s'affichent (cloche, page complète). Le chemin précis est posé
// par l'API (services/links.ts) ; une ancienne notification sans chemin mène à l'espace du compte
// plutôt que de rester un texte non cliquable.
export const notificationHref = (n: Pick<AppNotification, "linkPath">, role: string | undefined) => {
  if (n.linkPath && n.linkPath.startsWith("/")) return n.linkPath;
  if (role === "PARTICIPANT") return "/dashboard?tab=reservations";
  if (role === "ORGANIZER" || role === "ADMIN") return "/admin";
  return "/notifications";
};

export const markNotificationRead = (id: string) => api(`/notifications/${id}/read`, { method: "POST" }).catch(() => { /* déjà lue ou introuvable */ });
export const markAllNotificationsRead = () => api<{ count: number }>("/notifications/read-all", { method: "POST" });

// La cloche et la page complète partagent le compteur : un événement navigateur suffit à les garder
// synchronisés sans état global supplémentaire.
export const NOTIFICATIONS_CHANGED = "nour:notifications-changed";
export const announceNotificationsChanged = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

export const relativeTime = (value: string, now = Date.now()) => {
  const minutes = Math.round((now - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
