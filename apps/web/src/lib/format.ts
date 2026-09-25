import { API_URL } from "../api";

export const imgUrl = (src: string) => src.startsWith("http") ? src : `${API_URL}${src}`;

export const money = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
// Heures au format « 19h30 » partout (fiches, espace personnel, billets), jamais « 19:30 » d'un écran à l'autre.
const withH = (text: string) => text.replace(/(\d{2}):(\d{2})/, "$1h$2");
export const dateTime = (value: string) => withH(new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value)));
export const longDate = (value: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
export const dayLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value));
export const timeLabel = (value: string) => withH(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)));
