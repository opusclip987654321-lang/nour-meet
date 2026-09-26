import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CarouselDraft, CarouselDraftSlide } from "./ai-provider.js";
import { articleCarouselPlan, parseCarouselScript, photoSlots, shortText } from "./services/instagram-carousel.js";
import { loadImage, renderArticleCarousel, renderEventVisual } from "./services/instagram.js";
import { statementSlide } from "./services/social-visuals.js";

// Carrousel Instagram de l'article du jour (décision v2 §6) et visuel d'événement (§14).
const article = {
  title: "Se faire des amis après 30 ans dans une grande ville",
  excerpt: "Déménager, changer de travail : les cercles se défont. Voici comment en recréer, simplement.",
  category: "Amitié",
  imageUrl: "/static/uploads/articles/cover.webp",
  content: [
    "Introduction qui pose le sujet avec une phrase assez longue pour être un vrai paragraphe.",
    "## Oser la régularité",
    "Revoir les mêmes personnes chaque semaine crée la confiance. C’est la répétition, plus que l’intensité, qui fait naître une amitié. Une troisième phrase qui ne tiendra pas dans la limite de longueur fixée pour une slide, et qui doit donc être retirée proprement.",
    "## Choisir des cadres qui facilitent l’échange",
    "- Un atelier ou un club\n- Un bénévolat régulier\n- Des soirées où l’on vient seul\n- Un quatrième élément ignoré",
    "```chart\n{\"title\":\"Personnes se sentant seules\",\"unit\":\"%\",\"sourceLabel\":\"Fondation de France\",\"sourceUrl\":\"https://example.org\",\"data\":[{\"label\":\"2020\",\"value\":14},{\"label\":\"2024\",\"value\":21}]}\n```",
    "## Faire le premier pas",
    "Proposer un café reste le geste le plus simple.",
    "[[cta:/events|Voir les prochaines soirées]]"
  ].join("\n\n")
};

describe("plan du carrousel d’un article", () => {
  it("reprend chapô, intertitres et graphique sourcé de l’article, dans la limite de 4 à 8 slides", () => {
    const plan = articleCarouselPlan(article);
    const total = plan.middle.length + 2;
    expect(total).toBeGreaterThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(8);
    expect(plan.middle[0]).toEqual({ kind: "point", heading: "L’essentiel", body: article.excerpt });
    const headings = plan.middle.flatMap(m => m.kind === "point" ? [m.heading] : []);
    expect(headings).toEqual(["L’essentiel", "Oser la régularité", "Choisir des cadres qui facilitent l’échange", "Faire le premier pas"]);
    const regularity = plan.middle.find(m => m.kind === "point" && m.heading === "Oser la régularité");
    expect(regularity && regularity.kind === "point" && regularity.body).toBe("Revoir les mêmes personnes chaque semaine crée la confiance. C’est la répétition, plus que l’intensité, qui fait naître une amitié.");
    const list = plan.middle.find(m => m.kind === "point" && m.heading.startsWith("Choisir"));
    expect(list && list.kind === "point" && list.body).toBe("Un atelier ou un club · Un bénévolat régulier · Des soirées où l’on vient seul");
    const chart = plan.middle.find(m => m.kind === "chart");
    expect(chart && chart.kind === "chart" && chart.chart.data).toEqual([{ label: "2020", value: 14 }, { label: "2024", value: 21 }]);
  });

  it("n’ajoute jamais de graphique sans source nommée", () => {
    const unsourced = { ...article, content: article.content.replace(",\"sourceLabel\":\"Fondation de France\"", "") };
    expect(articleCarouselPlan(unsourced).middle.some(m => m.kind === "chart")).toBe(false);
  });

  it("borne un long article à 8 slides et complète un article sans intertitres avec ses paragraphes", () => {
    const long = { ...article, content: Array.from({ length: 12 }, (_, i) => `## Partie ${i + 1}\n\nParagraphe ${i + 1} de l’article.`).join("\n\n") };
    expect(articleCarouselPlan(long).middle.length + 2).toBe(8);
    const flat = { ...article, excerpt: null, content: "Premier paragraphe de l’article.\n\nDeuxième paragraphe de l’article.\n\nTroisième." };
    const plan = articleCarouselPlan(flat);
    expect(plan.middle.length + 2).toBeGreaterThanOrEqual(4);
    expect(plan.middle.map(m => m.kind === "point" && m.body)).toEqual(["Premier paragraphe de l’article.", "Deuxième paragraphe de l’article."]);
  });

  it("coupe un texte trop long à une fin de phrase, sinon à un mot entier", () => {
    expect(shortText("Une phrase. Une autre phrase bien plus longue que la limite.", 20)).toBe("Une phrase.");
    expect(shortText("Un seul très long segment sans ponctuation finale qui dépasse", 30)).toBe("Un seul très long segment sans…");
    expect(shortText("Voir [le site](https://exemple.fr) et **ceci**.")).toBe("Voir le site et ceci.");
  });
});

describe("rendu des visuels Instagram", () => {
  it("produit des JPEG carrés 1080 × 1080 : carrousel d’article et visuel d’événement", async () => {
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "nour-ig-"));
    await mkdir(path.join(publicDir, "uploads", "articles"), { recursive: true });
    const cover = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#8a6d5a" } }).webp().toBuffer();
    await writeFile(path.join(publicDir, "uploads", "articles", "cover.webp"), cover);
    const config = { publicDir, webOrigin: "https://nour-meet.fr" };
    const slides = await renderArticleCarousel(article, config);
    expect(slides.length).toBe(articleCarouselPlan(article).middle.length + 2);
    for (const slide of slides) {
      const meta = await sharp(slide).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 1080]);
    }
    await mkdir(path.join(publicDir, "uploads", "events"), { recursive: true });
    await writeFile(path.join(publicDir, "uploads", "events", "event.webp"), cover);
    const visual = await renderEventVisual({ title: "Soirée networking des entrepreneurs", category: "Networking", startsAt: new Date("2026-10-15T17:30:00Z"), district: "Paris 11e", imageUrl: "/static/uploads/events/event.webp" }, config, "/static/uploads/events/event.webp");
    expect((await sharp(visual).metadata()).width).toBe(1080);
  }, 60_000);

  it("refuse une photo de profil ou une adresse arbitraire comme source d’image", async () => {
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "nour-ig-"));
    await mkdir(path.join(publicDir, "uploads", "profiles"), { recursive: true });
    await writeFile(path.join(publicDir, "uploads", "profiles", "p.webp"), "x");
    const config = { publicDir, webOrigin: "http://127.0.0.1:9" };
    await expect(loadImage("/static/uploads/profiles/p.webp", config)).rejects.toThrow("Image refusée");
    await expect(loadImage("photo:../../secret", config)).rejects.toThrow("invalide");
  });

  it("refuse de lire une image en dehors du dossier public", async () => {
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "nour-ig-"));
    await expect(renderEventVisual({ title: "T", category: "Networking", startsAt: new Date(), district: "Paris", imageUrl: "/static/../../etc/passwd" }, { publicDir, webOrigin: "http://127.0.0.1:9" }, "/static/x.jpg")).rejects.toThrow();
  });
});

// Carrousel réécrit par Claude (refonte du 2026-09-26) : formats variés, aucun chiffre ajouté, et au
// moins une image tous les deux écrans.
const slide = (fields: Partial<CarouselDraftSlide> & Pick<CarouselDraftSlide, "kind">): CarouselDraftSlide => ({ title: "", text: "", items: [], myth: "", reality: "", highlight: "", value: "", source: "", imagePrompt: "A warm Parisian scene", ...fields });
const draft: CarouselDraft = {
  hook: "Tu n’es pas « trop exigeant(e) ».",
  subtitle: "Pourquoi se faire des amis devient plus dur après 30 ans, et comment y remédier.",
  slides: [
    slide({ kind: "stat", value: "21 %", text: "des gens se sentent seuls. Tu n’es pas un cas à part.", source: "Fondation de France" }),
    slide({ kind: "contrast", myth: "Les amitiés viennent toutes seules", reality: "C’est la répétition, plus que l’intensité, qui fait naître une amitié." }),
    slide({ kind: "scene", title: "Oser la régularité", text: "Revoir les mêmes personnes chaque semaine crée la confiance." }),
    slide({ kind: "list", title: "Des cadres qui aident", items: ["Un atelier ou un club", "Un bénévolat régulier", "Des soirées où l’on vient seul"] }),
    slide({ kind: "quote", text: "Proposer un café reste le geste le plus simple." })
  ],
  ctaHeadline: "Recrée le hasard, ce soir.",
  ctaDetail: "Une soirée Nūr Meet près de chez toi, avec des gens qui cherchent la même chose.",
  ctaImagePrompt: "A small group dinner in a Parisian restaurant",
  caption: "Se faire des amis après 30 ans ? C’est possible.\n\nArticle complet : lien en bio\n\n#amitie #paris"
};

describe("carrousel réécrit", () => {
  it("garde les formats valides, place le graphique sourcé après la couverture et reprend la légende courte", () => {
    const script = parseCarouselScript(draft, article);
    expect(script.slides.map(s => s.kind)).toEqual(["chart", "stat", "contrast", "scene", "list", "quote"]);
    expect(script.caption).toContain("lien en bio");
  });

  it("ne montre un chiffre qu’avec une source citée dans l’article", () => {
    const unsourced = parseCarouselScript({ ...draft, slides: [slide({ kind: "stat", value: "21 %", text: "Seuls.", source: "Institut inconnu" }), ...draft.slides.slice(1)] }, article);
    expect(unsourced.slides.some(s => s.kind === "stat")).toBe(false);
  });

  it("met une image au moins tous les deux écrans, et toujours sur une scène", () => {
    const script = parseCarouselScript(draft, article);
    const slots = new Set(photoSlots(script));
    // Écrans : couverture (photo), graphique, chiffre, contraste, scène, liste, citation, appel à l'action.
    const screens = [true, ...script.slides.map(s => slots.has(s)), slots.has(script.cta)];
    for (let i = 1; i < screens.length; i++) expect(screens[i] || screens[i - 1]).toBe(true);
    expect(slots.has(script.slides.find(s => s.kind === "scene")!)).toBe(true);
    expect(slots.has(script.slides.find(s => s.kind === "chart")!)).toBe(false);
  });

  it("refuse tout chiffre absent de l’article, et un texte contraire à la charte", () => {
    const invented = { ...draft, slides: [...draft.slides.slice(1, 3), slide({ kind: "quote", text: "67 % des gens se sentent seuls." })] };
    expect(() => parseCarouselScript(invented, article)).toThrow("Chiffre absent");
    expect(() => parseCarouselScript({ ...draft, hook: "Rencontres musulmanes" }, article)).toThrow("charte");
    expect(() => parseCarouselScript({ ...draft, slides: draft.slides.slice(0, 1) }, article)).toThrow("trop court");
  });

  it("rend chaque format, avec et sans photo, en JPEG carré 1080 × 1080", async () => {
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "nour-ig-"));
    await mkdir(path.join(publicDir, "uploads", "articles"), { recursive: true });
    const photo = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#8a6d5a" } }).webp().toBuffer();
    await writeFile(path.join(publicDir, "uploads", "articles", "cover.webp"), photo);
    await writeFile(path.join(publicDir, "uploads", "articles", "scene-slide.jpg"), await sharp(photo).jpeg().toBuffer());
    const script = parseCarouselScript(draft, article);
    // Une photo générée, les autres écrans en détail de la couverture, et chaque format aussi sans photo.
    photoSlots(script).forEach((slot, i) => Object.assign(slot, i === 0 ? { image: "/static/uploads/articles/scene-slide.jpg" } : { image: article.imageUrl, fromCover: true }));
    const bare = { ...script, slides: script.slides.map(s => ({ ...s, image: null })) };
    for (const s of [script, bare]) {
      const slides = await renderArticleCarousel({ ...article, instagramCarousel: s }, { publicDir, webOrigin: "https://nourmeet.com" });
      expect(slides.length).toBe(8);
      for (const jpeg of slides) expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1080 });
    }
  }, 120_000);
});

it("met en couleur un mot sans casser un caractère échappé (&)", async () => {
  const jpeg = await statementSlide(null, "Toi & ta soirée", "a", "2/6");
  expect((await sharp(jpeg).metadata()).width).toBe(1080);
});
