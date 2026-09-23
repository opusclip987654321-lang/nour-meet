import { describe, expect, it } from "vitest";
import { ageInYears, isAdult } from "@nour/shared";

describe("majorité (CGU §2)", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  it("compte les années révolues, anniversaire inclus", () => {
    expect(ageInYears("2008-09-23", now)).toBe(18);
    expect(ageInYears("2008-09-24", now)).toBe(17);
    expect(ageInYears("2008-10-01", now)).toBe(17);
  });
  it("refuse une date absente, invalide ou d'une personne mineure", () => {
    expect(isAdult("2008-09-23", now)).toBe(true);
    expect(isAdult("2008-09-24", now)).toBe(false);
    expect(isAdult(null, now)).toBe(false);
    expect(isAdult("pas une date", now)).toBe(false);
  });
});
