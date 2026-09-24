import { articleUploadsDir } from "../context.js";
import { env } from "../env.js";
import type { IllustrationConfig } from "./article-image.js";
import type { InstagramConfig } from "./instagram.js";

// Configuration des illustrations IA et d'Instagram, dérivée de l'environnement : null quand le
// service n'est pas configuré (la fonction correspondante est alors simplement désactivée).
const publicPrefix = "/static/uploads/articles/";
export const illustrationConfig: IllustrationConfig | null = env.OPENAI_API_KEY
  ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_IMAGE_MODEL, uploadsDir: articleUploadsDir, publicPrefix }
  : null;
export const instagramConfig: InstagramConfig | null = env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_USER_ID && env.API_PUBLIC_URL
  ? { userId: env.INSTAGRAM_USER_ID, initialToken: env.INSTAGRAM_ACCESS_TOKEN, graphVersion: env.INSTAGRAM_GRAPH_VERSION, publicApiOrigin: env.API_PUBLIC_URL.replace(/\/$/, ""), webOrigin: env.WEB_ORIGIN.split(",")[0].replace(/\/$/, ""), uploadsDir: articleUploadsDir, publicPrefix }
  : null;
