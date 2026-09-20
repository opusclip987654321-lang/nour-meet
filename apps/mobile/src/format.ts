import { EVENT_CATEGORIES } from "@nour/shared";
import { API_URL } from "./env";

// §15 : même code couleur par type d'événement que le web, pour une identité cohérente entre les
// deux plateformes (§2). Une catégorie inconnue retombe sur la couleur or par défaut.
export const categoryColor = (category: string) => EVENT_CATEGORIES.find(c => c.name === category)?.color ?? "#cba969";

export const money = (n: number) => `${(n / 100).toFixed(2).replace(".", ",")} €`;
export const when = (v: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
export const dayLabel = (v: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(v));
export const timeLabel = (v: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(v));
export const imgUrl = (src: string) => src.startsWith("http") ? src : `${API_URL}${src}`;
