import { describe, expect, it } from "vitest";
import { visualBriefs } from "./services/image-variety.js";

// Retour du 2026-09-26 : les illustrations ne doivent pas toujours montrer la même scène.
const settingOf = (brief: string) => brief.match(/^Setting: ([^.]+)\./)![1];

describe("consignes visuelles des illustrations", () => {
  it("donne 8 décors différents dans une journée, et au plus un décor commun avec la veille", () => {
    for (const seed of [20_000, 20_001, 20_723]) {
      const today = visualBriefs(seed, 0, 8).map(settingOf);
      expect(new Set(today).size).toBe(8);
      const yesterday = new Set(visualBriefs(seed - 1, 0, 8).map(settingOf));
      expect(today.filter(s => yesterday.has(s)).length).toBeLessThanOrEqual(1);
    }
  });

  it("ne propose jamais de lieu religieux", () => {
    const all = Array.from({ length: 30 }, (_, d) => visualBriefs(20_000 + d, 0, 8)).flat().join(" ");
    expect(all).not.toMatch(/mosque|church|prayer|religious/i);
  });
});
