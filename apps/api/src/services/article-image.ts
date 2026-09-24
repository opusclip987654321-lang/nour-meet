import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AIProvider } from "../ai-provider.js";

// Illustration de couverture de l'article du jour (corrections du 2026-09-24) : générée par OpenAI
// Images, contrôlée par Claude selon la charte visuelle, puis déclinée pour le site (WebP 3:2) et pour
// Instagram (JPEG carré, seul format accepté par l'API Instagram). Jusqu'à 5 essais (la photothèque,
// jugée peu qualitative, n'est qu'un dernier recours) : chaque essai reprend les raisons du refus
// précédent pour ne pas refaire la même erreur. Jamais une image non contrôlée publiée.

export type IllustrationConfig = { apiKey: string; model: string; uploadsDir: string; publicPrefix: string };
export type Illustration = { imageUrl: string; instagramImageUrl: string; altText: string };

const OPENAI_TIMEOUT_MS = 180_000;
export const MAX_ILLUSTRATION_ATTEMPTS = 5;
// Garde-fou ajouté à chaque description, indépendamment de ce que propose Claude : charte « aucun alcool
// à l'image » — y compris ce qui pourrait y ressembler (un thé glacé à la menthe passe pour un mojito).
const IMAGE_GUARDRAILS = " Strict rules: absolutely no alcohol and nothing that could be mistaken for alcohol — no cocktails, no tall glasses with ice or straws, no wine or champagne glasses, no bottles. If drinks appear, they are hot mint tea in small traditional tea glasses or coffee cups. No text, letters, logos or watermarks. No religious symbols or places.";

async function generateImage(config: IllustrationConfig, prompt: string): Promise<Buffer> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, prompt: `${prompt}${IMAGE_GUARDRAILS}`, size: "1536x1024", quality: "medium", n: 1 })
  });
  const data = await response.json().catch(() => ({})) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`OpenAI Images a refusé la génération (${response.status}) : ${data.error?.message ?? "sans détail"}`);
  const first = data.data?.[0];
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
  if (first?.url) {
    const image = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
    if (!image.ok) throw new Error(`Téléchargement de l'image générée impossible (${image.status})`);
    return Buffer.from(await image.arrayBuffer());
  }
  throw new Error("Réponse d'OpenAI Images sans image");
}

// Déclinaisons publiées : WebP 1600 px pour le site, JPEG 1080 × 1080 recadré au centre pour Instagram.
export async function saveIllustration(source: Buffer, config: Pick<IllustrationConfig, "uploadsDir" | "publicPrefix">) {
  const base = randomUUID();
  const [site, square] = await Promise.all([
    sharp(source).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer(),
    sharp(source).resize(1080, 1080, { fit: "cover", position: "centre" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer()
  ]);
  await Promise.all([
    writeFile(path.join(config.uploadsDir, `${base}.webp`), site),
    writeFile(path.join(config.uploadsDir, `${base}-instagram.jpg`), square)
  ]);
  return { imageUrl: `${config.publicPrefix}${base}.webp`, instagramImageUrl: `${config.publicPrefix}${base}-instagram.jpg` };
}

export async function illustrateArticle(config: IllustrationConfig, reviewer: AIProvider, article: { title: string; imagePrompt: string }, log: { warn: (o: unknown, m?: string) => void }): Promise<Illustration | null> {
  if (!reviewer.reviewCoverImage || !article.imagePrompt.trim()) return null;
  let previousIssues: string[] = [];
  for (let attempt = 1; attempt <= MAX_ILLUSTRATION_ATTEMPTS; attempt++) {
    try {
      const prompt = previousIssues.length ? `${article.imagePrompt} A previous version was rejected for these reasons, make sure none of them occurs: ${previousIssues.join(" ; ")}.` : article.imagePrompt;
      const raw = await generateImage(config, prompt);
      const forReview = await sharp(raw).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      const review = await reviewer.reviewCoverImage(forReview, article);
      if (!review.approved) { previousIssues = review.issues.slice(0, 5); log.warn({ attempt, issues: review.issues }, "Illustration IA refusée par le contrôle visuel"); continue; }
      return { ...(await saveIllustration(raw, config)), altText: review.altText };
    } catch (err) {
      log.warn({ attempt, err: (err as Error).message }, "Génération de l'illustration IA échouée");
    }
  }
  return null;
}

// Description d'illustration pour un article sans consigne rédigée par Claude (article de la réserve).
export const defaultImagePrompt = (article: { title: string; excerpt: string | null; category: string }) =>
  `Photorealistic, warm and natural scene illustrating a French lifestyle article titled "${article.title}" (${article.category})${article.excerpt ? ` — ${article.excerpt}` : ""}. Adults of mostly North African and West African descent, women with or without a headscarf, in a recognisable Parisian setting (café, restaurant, terrace or apartment), candid atmosphere, people seen in three-quarter view or from behind rather than close-up faces, centred composition.`;
