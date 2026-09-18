export function hasCapacity(capacity: number, confirmedCount: number) {
  return confirmedCount < capacity;
}

export function canUseTicket(status: "VALID" | "USED" | "CANCELLED", usedAt?: Date | null) {
  return status === "VALID" && !usedAt;
}

export function paymentDeadline(from = new Date(), hours = 24) {
  return new Date(from.getTime() + hours * 60 * 60_000);
}

// Après un refus d'entretien global, délai minimum avant de pouvoir en redemander un autre.
export function interviewRetryDate(from: Date, months = 3) {
  const date = new Date(from);
  date.setMonth(date.getMonth() + months);
  return date;
}
