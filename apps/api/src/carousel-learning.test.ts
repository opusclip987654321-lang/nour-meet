import { describe, expect, it } from "vitest";
import { VARIANT_OPTIONS, carouselScore, chooseVariant, collectCarouselInsights, type CarouselVariant } from "./services/carousel-learning.js";

// Boucle d'apprentissage des carrousels (diagnostic du 2026-10-03).
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe("score d'un carrousel", () => {
  it("récompense d'abord les abonnements et les partages, rapportés à la portée", () => {
    const base = { reach: 1000, likes: 40, comments: 2, saved: 5, shares: 3 };
    expect(carouselScore({ ...base, follows: 4 })).toBeGreaterThan(carouselScore({ ...base, likes: 110 }));
    expect(carouselScore({ reach: 2000, follows: 4 })).toBe(carouselScore({ reach: 1000, follows: 2 }));
  });

  it("ne s'emballe pas sur une portée minuscule", () => {
    expect(carouselScore({ reach: 3, saved: 1 })).toBe(carouselScore({ reach: 50, saved: 1 }));
  });
});

describe("choix du prochain carrousel", () => {
  const all = (v: Partial<CarouselVariant>): CarouselVariant => ({ format: "punch", hook: "question", register: "emotion", cta: "save", ...v });

  it("essaie d'abord les choix encore jamais mesurés", () => {
    const history = Object.keys(VARIANT_OPTIONS.hook).filter(h => h !== "pov").flatMap(hook => [{ variant: all({ hook: hook as CarouselVariant["hook"] }), score: 50 }, { variant: all({ hook: hook as CarouselVariant["hook"] }), score: 50 }]);
    expect(chooseVariant(history, seq(0)).hook).toBe("pov");
  });

  it("reprend le meilleur choix une fois tout essayé, sauf tirage d'exploration", () => {
    const history = Object.entries(VARIANT_OPTIONS).flatMap(([d, options]) => Object.keys(options).flatMap(o => [1, 2].map(() => ({ variant: all({ [d]: o }), score: o === "chat" || o === "scene" || o === "humour" || o === "share" ? 90 : 10 }))));
    expect(chooseVariant(history, seq(0.9))).toEqual({ format: "chat", hook: "scene", register: "humour", cta: "share" });
    // Tirage sous le taux d'exploration : un choix au hasard, pas forcément le meilleur.
    expect(Object.keys(VARIANT_OPTIONS.hook)).toContain(chooseVariant(history, seq(0.1, 0)).hook);
  });
});

describe("relevé des statistiques", () => {
  it("enregistre le score de chaque carrousel dû et continue malgré un échec", async () => {
    const updates: { id: string; score: number }[] = [];
    const prisma = {
      article: {
        findMany: async () => [{ id: "a", instagramMediaId: "m1" }, { id: "b", instagramMediaId: "m2" }],
        update: async ({ where, data }: { where: { id: string }; data: { instagramScore: number } }) => { updates.push({ id: where.id, score: data.instagramScore }); }
      }
    };
    const warnings: unknown[] = [];
    const collected = await collectCarouselInsights({
      prisma: prisma as never,
      log: { warn: o => { warnings.push(o); } },
      fetchInsights: async id => { if (id === "m1") throw new Error("permission manquante"); return { reach: 500, follows: 1, saved: 4 }; }
    });
    expect(collected).toBe(1);
    expect(updates).toEqual([{ id: "b", score: carouselScore({ reach: 500, follows: 1, saved: 4 }) }]);
    expect(warnings).toHaveLength(1);
  });
});
