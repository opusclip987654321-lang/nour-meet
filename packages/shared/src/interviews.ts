// Calendrier des entretiens de validation (décision v2 §11, 2026-09-25) : ouvert par défaut tous les
// jours de 10h à 22h (heure de Paris), par créneaux de 15 minutes. L'équipe ne crée plus de créneaux :
// elle ferme des périodes (plages bloquées), et les rendez-vous déjà réservés restent la seule source
// de vérité pour les horaires occupés. Les créneaux se calculent à la volée, jamais stockés d'avance.
export const INTERVIEW_TIME_ZONE = "Europe/Paris";
export const INTERVIEW_OPEN_MINUTES = 10 * 60;
export const INTERVIEW_CLOSE_MINUTES = 22 * 60;
export const INTERVIEW_SLOT_MINUTES = 15;
// Délai minimal avant un appel réservable : l'équipe doit voir la réservation avant d'appeler.
export const INTERVIEW_MIN_NOTICE_MINUTES = 60;
// Horizon de réservation : aucune limite courte, seulement une borne technique d'un an.
export const INTERVIEW_HORIZON_DAYS = 365;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: INTERVIEW_TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
});

function parisParts(date: Date) {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map(x => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

// Décalage de Paris par rapport à UTC à cet instant (heure d'été comprise), en millisecondes.
function parisOffsetMs(date: Date) {
  const p = parisParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Jour calendaire à Paris d'un instant, au format AAAA-MM-JJ. */
export function parisDayKey(date: Date): string {
  const p = parisParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Instant UTC correspondant à « jour AAAA-MM-JJ, N minutes après minuit » à Paris. */
export function parisTime(dayKey: string, minutes: number): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  // Deux passes : la seconde corrige le cas où le décalage change entre l'estimation et le résultat.
  let result = naive - parisOffsetMs(new Date(naive));
  result = naive - parisOffsetMs(new Date(result));
  return new Date(result);
}

/** Jour suivant (ou précédent) d'un AAAA-MM-JJ, sans dépendre du fuseau de la machine. */
export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Tous les créneaux d'ouverture par défaut d'une journée à Paris. */
export function defaultInterviewSlots(dayKey: string): { startsAt: Date; endsAt: Date }[] {
  const slots: { startsAt: Date; endsAt: Date }[] = [];
  for (let m = INTERVIEW_OPEN_MINUTES; m + INTERVIEW_SLOT_MINUTES <= INTERVIEW_CLOSE_MINUTES; m += INTERVIEW_SLOT_MINUTES) {
    slots.push({ startsAt: parisTime(dayKey, m), endsAt: parisTime(dayKey, m + INTERVIEW_SLOT_MINUTES) });
  }
  return slots;
}

/** Vrai si cet instant est le début d'un créneau d'ouverture par défaut (10h–21h45, par quart d'heure). */
export function isDefaultInterviewSlotStart(startsAt: Date): boolean {
  const p = parisParts(startsAt);
  const minutes = p.hour * 60 + p.minute;
  return p.second === 0 && startsAt.getUTCMilliseconds() === 0
    && minutes >= INTERVIEW_OPEN_MINUTES && minutes + INTERVIEW_SLOT_MINUTES <= INTERVIEW_CLOSE_MINUTES
    && (minutes - INTERVIEW_OPEN_MINUTES) % INTERVIEW_SLOT_MINUTES === 0;
}

/** Jour de la semaine à Paris (0 = dimanche … 6 = samedi) d'un AAAA-MM-JJ. */
export function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const frenchFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: INTERVIEW_TIME_ZONE, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
/** « lundi 12 octobre à 14h30 », toujours à l'heure de Paris quel que soit le fuseau du serveur. */
export function parisDateTime(date: Date): string {
  return frenchFormatter.format(date).replace(/(\d{2}):(\d{2})/, "$1h$2");
}
