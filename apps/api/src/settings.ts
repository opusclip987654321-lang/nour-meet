import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

// Toute valeur "provisoire" du cahier des charges vit ici, jamais en dur ailleurs dans le code.
// Chaque clé a un schéma de validation et une valeur par défaut : une base de données vierge ou une
// clé absente/invalide retombe silencieusement sur cette valeur par défaut plutôt que de faire
// planter le démarrage, tout en étant modifiable par un administrateur sans redéploiement.
export const SETTINGS_SCHEMA = {
  PAYMENT_LOCK_MINUTES: {
    schema: z.number().int().positive(),
    default: 10,
    description: "Durée du verrou technique posé sur une place pendant une tentative de paiement, avant libération automatique."
  },
  WAITLIST_OFFER_WINDOW_HOURS: {
    schema: z.number().int().positive(),
    default: 24,
    description: "Délai laissé à la personne en tête de liste d'attente pour payer une place qui vient de se libérer, avant qu'elle ne soit proposée à la suivante. Distinct du verrou de paiement : la place lui est exclusivement réservée, il n'y a donc pas de risque de double vente à protéger."
  },
  ALTERNATIVE_OFFER_RESPONSE_HOURS: {
    schema: z.number().int().positive(),
    default: 24,
    description: "Délai laissé pour répondre à une proposition d'événement alternatif avant qu'elle n'expire."
  },
  ENABLE_COMMISSION_LEDGER: {
    schema: z.boolean(),
    default: false,
    description: "Active la création automatique d'une ligne comptable 30/70 (LedgerEntry) à chaque vente restaurateur. Désactivée par défaut depuis le passage à l'abonnement mensuel (§8.2) : les anciennes lignes restent en base, mais aucune nouvelle n'est créée."
  },
  MIN_PARTICIPANTS_DECISION_WINDOW_HOURS: {
    schema: z.number().int().positive(),
    default: 12,
    description: "Délai laissé au restaurateur pour maintenir ou annuler un événement dont le minimum de participants n'est pas atteint à la date limite."
  },
  MIN_PARTICIPANTS_NO_RESPONSE_ACTION: {
    schema: z.enum(["MAINTAIN", "CANCEL"]),
    default: "MAINTAIN" as const,
    description: "Action appliquée si le restaurateur ne répond pas dans le délai après un minimum de participants non atteint."
  },
  ENABLE_GENDER_PRICING: {
    schema: z.boolean(),
    default: false,
    description: "Active la tarification différenciée homme/femme sur les fiches publiques. Désactivée par défaut : non validée juridiquement."
  },
  MARKETPLACE_PAYOUTS_ENABLED: {
    schema: z.boolean(),
    default: false,
    description: "Active les virements réels de la place de marché (Stripe Connect ou équivalent). Désactivée par défaut : modèle juridique non validé."
  },
  AI_BLOG_GENERATION_MODE: {
    schema: z.enum(["DRAFT_ONLY", "AUTO_PUBLISH_DAILY"]),
    default: "AUTO_PUBLISH_DAILY" as "DRAFT_ONLY" | "AUTO_PUBLISH_DAILY",
    description: "Blog (corrections web 2026-09-24, §3). AUTO_PUBLISH_DAILY : en production, un article est généré (IA avec recherche web, ANTHROPIC_API_KEY) et publié automatiquement chaque jour, sans validation préalable ; à défaut d'IA, un article de la réserve est publié. DRAFT_ONLY : aucune publication automatique, la génération IA ne produit que des brouillons."
  },
  CONCEPT_VIDEO_URL: {
    schema: z.string(),
    default: "" as const,
    description: "URL de la vidéo de présentation (60 à 90 secondes) sur la page « Le concept ». Vide : la page affiche seulement le résumé écrit, jamais un lecteur cassé."
  },
  CONCEPT_VIDEO_THUMBNAIL_URL: {
    schema: z.string(),
    default: "" as const,
    description: "Miniature affichée avant le lancement de la vidéo de présentation."
  },
  CONCEPT_VIDEO_SUBTITLES_URL: {
    schema: z.string(),
    default: "" as const,
    description: "Fichier de sous-titres (.vtt) de la vidéo de présentation, pour l'accessibilité."
  },
  EVENT_REMINDER_HOURS_BEFORE: {
    schema: z.number().int().positive(),
    default: 24,
    description: "Délai avant le début d'un événement auquel le premier rappel (J-1, §13) est envoyé à chaque réservation confirmée, une seule fois."
  },
  EVENT_REMINDER_H2_HOURS_BEFORE: {
    schema: z.number().int().positive(),
    default: 2,
    description: "Délai avant le début d'un événement auquel le second rappel (H-2, §3 du cahier des charges 2026-09) est envoyé, en plus du rappel J-1."
  },
  SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE: {
    schema: z.number().int().positive(),
    default: 3,
    description: "Délai avant l'échéance d'un abonnement restaurateur (fin de période ou fin d'essai) auquel un rappel est envoyé, une seule fois par période."
  },
  ANALYTICS_ENABLED: {
    schema: z.boolean(),
    default: true,
    description: "Active l'enregistrement des visites (POST /analytics/pageview). Depuis les corrections web du 2026-09-24 (§15), le site n'envoie une visite qu'après consentement explicite du visiteur (bandeau cookies, choix conservé 6 mois, modifiable via « Gérer mes cookies ») : ce réglage sert seulement à couper la collecte côté serveur."
  },
  ANALYTICS_RETENTION_DAYS: {
    schema: z.number().int().positive(),
    default: 390,
    description: "Durée de conservation des visites (PageView) avant purge automatique. 390 jours par défaut (13 mois), plafond habituellement retenu pour l'exemption CNIL « mesure d'audience »."
  },
  CANCELLATION_ALERT_THRESHOLD_PERCENT: {
    schema: z.number().min(0).max(100),
    default: 20,
    description: "Seuil de taux d'annulation (sur 24h glissantes, réservations confirmées annulées / réservations confirmées) au-delà duquel une alerte admin est déclenchée (C37)."
  }
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMA)[K]["schema"]> };

function defaults(): Settings {
  const out = {} as Settings;
  for (const key of Object.keys(SETTINGS_SCHEMA) as SettingKey[]) (out as any)[key] = SETTINGS_SCHEMA[key].default;
  return out;
}

let cache: Settings = defaults();

// Appelé une fois au démarrage : lit les valeurs en base et les fusionne par-dessus les valeurs par
// défaut. Une ligne dont la clé est inconnue (paramètre retiré) ou dont la valeur ne correspond plus
// au schéma est ignorée plutôt que de faire échouer le démarrage.
export async function loadSettings(prisma: PrismaClient): Promise<Settings> {
  const rows = await prisma.appSetting.findMany();
  const next = defaults();
  for (const row of rows) {
    const def = (SETTINGS_SCHEMA as Record<string, (typeof SETTINGS_SCHEMA)[SettingKey]>)[row.key];
    if (!def) continue;
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) (next as any)[row.key] = parsed.data;
  }
  cache = next;
  return cache;
}

// Sous node:cluster, chaque processus a son propre cache : une modification faite par l'un restait
// invisible aux autres jusqu'au redémarrage (un même réglage — durée d'essai Stripe, tarif homme/
// femme — pouvait donc valoir deux choses selon la requête). Le processus qui enregistre prévient
// les autres par le canal IPC du cluster (relayé par cluster-entry.ts), qui relisent la base ; une
// relecture périodique rattrape tout message perdu.
export const SETTINGS_CHANGED_MESSAGE = "nour:settings-changed";
const SETTINGS_REFRESH_MS = 30_000;
// Canal IPC réel par défaut ; remplaçable dans les tests (le processus de test a son propre IPC).
export const settingsChannel = {
  broadcast: () => { if (process.connected) process.send?.({ type: SETTINGS_CHANGED_MESSAGE }, undefined, {}, () => {}); },
  subscribe: (onMessage: (message: unknown) => void) => { process.on("message", onMessage); return () => { process.off("message", onMessage); }; }
};
export function watchSettings(prisma: PrismaClient, onError: (err: unknown) => void) {
  const reload = () => { loadSettings(prisma).catch(onError); };
  const unsubscribe = settingsChannel.subscribe(message => { if ((message as { type?: string } | null)?.type === SETTINGS_CHANGED_MESSAGE) reload(); });
  const timer = setInterval(reload, SETTINGS_REFRESH_MS);
  timer.unref();
  return () => { unsubscribe(); clearInterval(timer); };
}

export function getSettings(): Settings { return cache; }
export function getSetting<K extends SettingKey>(key: K): Settings[K] { return cache[key]; }

export async function updateSetting<K extends SettingKey>(prisma: PrismaClient, key: K, value: unknown, updatedBy?: string): Promise<Settings[K]> {
  const parsed = SETTINGS_SCHEMA[key].schema.parse(value);
  await prisma.appSetting.upsert({ where: { key }, update: { value: parsed as any, updatedBy }, create: { key, value: parsed as any, updatedBy } });
  cache = { ...cache, [key]: parsed };
  settingsChannel.broadcast();
  return parsed as Settings[K];
}

export function listSettingsForAdmin() {
  return (Object.keys(SETTINGS_SCHEMA) as SettingKey[]).map(key => ({
    key,
    value: cache[key] as unknown,
    default: SETTINGS_SCHEMA[key].default as unknown,
    description: SETTINGS_SCHEMA[key].description
  }));
}
