import { app, prisma } from "../context.js";
import { env } from "../env.js";

// Envoi des notifications push via le service Expo (gratuit, sans compte Apple/Google à gérer côté
// serveur). Jamais bloquant : une notification reste enregistrée et visible dans l'application même
// si l'envoi push échoue. Le texte poussé est volontairement générique : il s'affiche sur l'écran
// verrouillé et transite par Expo, Apple et Google, et ne doit donc révéler ni l'usage d'un service
// de rencontres, ni une demande de contact, ni un résultat d'entretien. Le détail reste dans la cloche.
export const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[\w-]+\]$/;

type PushTicket = { status: "ok" | "error"; details?: { error?: string } };

export const PUSH_TITLE = "Nūr Meet";
export const PUSH_BODY = "Vous avez une nouvelle notification.";
// Au-delà, les appareils les moins récemment vus sont oubliés (un compte ne peut pas accumuler de jetons).
export const MAX_PUSH_TOKENS_PER_USER = 10;

export const sendPush = async (userId: string, data: { linkPath?: string | null }) => {
  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { token: true }, orderBy: { lastSeenAt: "desc" }, take: MAX_PUSH_TOKENS_PER_USER });
  if (tokens.length === 0) return;
  const messages = tokens.map(t => ({ to: t.token, title: PUSH_TITLE, body: PUSH_BODY, sound: "default", channelId: "default", data: { linkPath: data.linkPath ?? null } }));
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
  const { data: tickets } = await response.json() as { data: PushTicket[] };
  // Application désinstallée ou autorisation retirée : le jeton ne servira plus jamais.
  const dead = tickets.map((t, i) => t.status === "error" && t.details?.error === "DeviceNotRegistered" ? tokens[i]?.token : null).filter((t): t is string => !!t);
  if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
};

export const sendPushSafely = (userId: string, linkPath?: string | null) => {
  sendPush(userId, { linkPath }).catch(err => app.log.warn({ err }, "Échec d’envoi de notification push"));
};
