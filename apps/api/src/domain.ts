export function testCardOutcome(cardNumber: string): "SUCCEEDED" | "FAILED" {
  return cardNumber === "4000000000000002" ? "FAILED" : "SUCCEEDED";
}

export function hasCapacity(capacity: number, confirmedCount: number) {
  return confirmedCount < capacity;
}

export function canUseTicket(status: "VALID" | "USED" | "CANCELLED", usedAt?: Date | null) {
  return status === "VALID" && !usedAt;
}

export function paymentDeadline(from = new Date(), hours = 24) {
  return new Date(from.getTime() + hours * 60 * 60_000);
}
