import { describe, expect, it } from "vitest";
import { canUseTicket, hasCapacity, paymentDeadline, paymentLockExpiry, refundEligibility, interviewRetryDate, currentYearMonth, resolvePriceCents, eventsOverlap } from "./domain.js";
import { eventRequiresScreening, suggestedFlowForCategory } from "@nour/shared";

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

  it("pose un verrou de paiement court (10 minutes par défaut)", () => {
    const start = new Date("2026-09-17T12:00:00Z");
    expect(paymentLockExpiry(start).toISOString()).toBe("2026-09-17T12:10:00.000Z");
    expect(paymentLockExpiry(start, 5).toISOString()).toBe("2026-09-17T12:05:00.000Z");
  });

  it("détermine le parcours d'un événement de façon centralisée, jamais par la catégorie affichée", () => {
    expect(eventRequiresScreening({ flow: "SCREENING" })).toBe(true);
    expect(eventRequiresScreening({ flow: "DIRECT" })).toBe(false);
    // La catégorie ne sert qu'à suggérer une valeur par défaut à la création, jamais à décider en direct.
    expect(suggestedFlowForCategory("Speed dating")).toBe("SCREENING");
    expect(suggestedFlowForCategory("Networking")).toBe("DIRECT");
    expect(suggestedFlowForCategory("Autre chose")).toBe("DIRECT");
  });

  it("calcule le délai de trois mois avant une nouvelle demande d'entretien", () => {
    const refusedAt = new Date("2026-01-15T10:00:00Z");
    const retry = interviewRetryDate(refusedAt);
    expect(retry.getUTCFullYear()).toBe(2026);
    expect(retry.getUTCMonth()).toBe(3); // avril (0-indexé)
    expect(retry.getUTCDate()).toBe(15);
  });

  it("calcule l'éligibilité au remboursement autour de la limite exacte de 24 heures", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const justOver = new Date(now.getTime() + 24 * 60 * 60_000 + 1000);
    const exactly24h = new Date(now.getTime() + 24 * 60 * 60_000);
    const justUnder = new Date(now.getTime() + 24 * 60 * 60_000 - 1000);
    expect(refundEligibility(justOver, now).eligible).toBe(true);
    expect(refundEligibility(exactly24h, now).eligible).toBe(false);
    expect(refundEligibility(justUnder, now).eligible).toBe(false);
  });

  it("calcule la clé de mois calendaire utilisée pour le quota mensuel restaurateur", () => {
    expect(currentYearMonth(new Date("2026-09-19T23:00:00Z"))).toBe("2026-09");
    expect(currentYearMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(currentYearMonth(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("ignore tout tarif différencié tant que la tarification homme/femme est désactivée (§6)", () => {
    const event = { priceCents: 2500, priceTiers: [{ category: "HOMME" as const, amountCents: 3000 }, { category: "FEMME" as const, amountCents: 2000 }] };
    expect(resolvePriceCents(event, "FEMME", false)).toBe(2500);
    expect(resolvePriceCents(event, "HOMME", false)).toBe(2500);
    expect(resolvePriceCents(event, null, false)).toBe(2500);
  });

  it("applique le tarif de la catégorie une fois la tarification homme/femme activée", () => {
    const event = { priceCents: 2500, priceTiers: [{ category: "HOMME" as const, amountCents: 3000 }, { category: "FEMME" as const, amountCents: 2000 }] };
    expect(resolvePriceCents(event, "FEMME", true)).toBe(2000);
    expect(resolvePriceCents(event, "HOMME", true)).toBe(3000);
    // Catégorie sans tarif défini, ou non renseignée : retombe sur le tarif unique.
    expect(resolvePriceCents({ priceCents: 2500 }, "FEMME", true)).toBe(2500);
    expect(resolvePriceCents(event, null, true)).toBe(2500);
  });

  it("détecte un chevauchement horaire par intersection stricte, jamais deux créneaux simplement contigus (§11)", () => {
    const a = { startsAt: new Date("2026-10-01T19:00:00Z"), endsAt: new Date("2026-10-01T22:00:00Z") };
    const overlapping = { startsAt: new Date("2026-10-01T21:00:00Z"), endsAt: new Date("2026-10-01T23:00:00Z") };
    const contiguous = { startsAt: new Date("2026-10-01T22:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z") };
    const separate = { startsAt: new Date("2026-10-02T10:00:00Z"), endsAt: new Date("2026-10-02T12:00:00Z") };
    expect(eventsOverlap(a, overlapping)).toBe(true);
    expect(eventsOverlap(overlapping, a)).toBe(true);
    expect(eventsOverlap(a, contiguous)).toBe(false);
    expect(eventsOverlap(a, separate)).toBe(false);
  });
});
