export function hasCapacity(capacity: number, confirmedCount: number) {
  return confirmedCount < capacity;
}

export function canUseTicket(status: "VALID" | "USED" | "CANCELLED", usedAt?: Date | null) {
  return status === "VALID" && !usedAt;
}

export function paymentDeadline(from = new Date(), hours = 24) {
  return new Date(from.getTime() + hours * 60 * 60_000);
}

// Verrou technique court posé sur une place pendant une tentative de paiement (§5 du cahier des
// charges) : remplace l'ancienne réservation automatique de 24h posée dès la candidature/acceptation.
export function paymentLockExpiry(from = new Date(), minutes = 10) {
  return new Date(from.getTime() + minutes * 60_000);
}

// Après un refus d'entretien global, délai minimum avant de pouvoir en redemander un autre.
export function interviewRetryDate(from: Date, months = 3) {
  const date = new Date(from);
  date.setMonth(date.getMonth() + months);
  return date;
}

// Clé de mois calendaire (fuseau UTC, cohérent avec le stockage) utilisée pour le quota mensuel
// restaurateur (§8.2) : "2026-09" par exemple. Un événement brouillon ne consomme jamais ce
// compteur ; seule la toute première publication le fait (voir index.ts, review-decision).
export function currentYearMonth(from = new Date()) {
  return `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Politique d'annulation/remboursement (§7) : plus de 24h avant le début de l'événement, annulation
// et remboursement intégral automatiques ; 24h ou moins avant, aucun remboursement de plein droit
// (seule une exception admin motivée peut en accorder un). Calcul strictement serveur, jamais
// dupliqué côté interface comme seule source de vérité.
export function refundEligibility(eventStartsAt: Date, now = new Date()) {
  const hoursUntilEvent = (eventStartsAt.getTime() - now.getTime()) / (60 * 60_000);
  return { eligible: hoursUntilEvent > 24, hoursUntilEvent };
}

// Tarification différenciée homme/femme (§6) : non validée juridiquement, donc désactivée par
// défaut. `genderPricingEnabled` est passé explicitement par l'appelant (jamais lu ici depuis
// AppSetting) pour que cette règle reste une fonction pure, testable sans dépendre de l'état
// mutable du cache de settings.
export type PriceTier = { category: "HOMME" | "FEMME"; amountCents: number };
export function resolvePriceCents(event: { priceCents: number; priceTiers?: PriceTier[] }, quotaCategory: "HOMME" | "FEMME" | null, genderPricingEnabled: boolean) {
  if (!genderPricingEnabled) return event.priceCents;
  const tier = quotaCategory ? event.priceTiers?.find(t => t.category === quotaCategory) : undefined;
  return tier ? tier.amountCents : event.priceCents;
}

// Chevauchement horaire entre deux événements (§11) : intersection stricte des intervalles
// [startsAt, endsAt) — deux créneaux contigus (l'un finit quand l'autre commence) ne se
// chevauchent pas.
export function eventsOverlap(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
