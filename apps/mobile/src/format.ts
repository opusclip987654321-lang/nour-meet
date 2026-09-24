import { EVENT_CATEGORIES } from "@nour/shared";
import { API_URL, WEB_URL } from "./env";

// §15 : même code couleur par type d'événement que le web.
export const categoryColor = (category: string) => EVENT_CATEGORIES.find(c => c.name === category)?.color ?? "#cba969";

export const money = (n: number) => `${(n / 100).toFixed(2).replace(".", ",")} €`;
export const when = (v: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
export const shortDate = (v: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)).replace(":", "h");
export const longDate = (v: string) => new Date(v).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
export const dayLabel = (v: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(v));
export const timeLabel = (v: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(v));
// Images : fichiers de l'API (/static/…), URL absolues, ou photothèque du site (« photo:nom »).
export const imgUrl = (src: string) => src.startsWith("http") ? src : src.startsWith("photo:") ? `${WEB_URL}/images/${src.slice(6)}-1024.webp` : `${API_URL}${src}`;
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
