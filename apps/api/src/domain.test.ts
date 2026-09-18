import { describe, expect, it } from "vitest";
import { canUseTicket, hasCapacity, paymentDeadline } from "./domain.js";

describe("règles métier Nūr Meet", () => {
  it("empêche la survente", () => {
    expect(hasCapacity(28, 27)).toBe(true);
    expect(hasCapacity(28, 28)).toBe(false);
  });

  it("empêche le double scan et les billets annulés", () => {
    expect(canUseTicket("VALID", null)).toBe(true);
    expect(canUseTicket("USED", new Date())).toBe(false);
    expect(canUseTicket("CANCELLED", null)).toBe(false);
  });

  it("crée une échéance de paiement de 24 heures", () => {
    const start = new Date("2026-09-17T12:00:00Z");
    expect(paymentDeadline(start).toISOString()).toBe("2026-09-18T12:00:00.000Z");
  });
});
