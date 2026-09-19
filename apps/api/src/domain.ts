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

// Politique d'annulation/remboursement (§7) : plus de 24h avant le début de l'événement, annulation
// et remboursement intégral automatiques ; 24h ou moins avant, aucun remboursement de plein droit
// (seule une exception admin motivée peut en accorder un). Calcul strictement serveur, jamais
// dupliqué côté interface comme seule source de vérité.
export function refundEligibility(eventStartsAt: Date, now = new Date()) {
  const hoursUntilEvent = (eventStartsAt.getTime() - now.getTime()) / (60 * 60_000);
  return { eligible: hoursUntilEvent > 24, hoursUntilEvent };
}
