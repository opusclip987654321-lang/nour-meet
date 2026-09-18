import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "./phone.js";

describe("normalisation des numéros", () => {
  it("convertit un numéro français local au format E.164", () => {
    expect(normalizePhoneNumber("06 12 34 56 78")).toBe("+33612345678");
  });

  it("conserve un numéro international valide", () => {
    expect(normalizePhoneNumber("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("refuse un numéro invalide", () => {
    expect(() => normalizePhoneNumber("123")).toThrow("Numéro de téléphone invalide");
  });
});
