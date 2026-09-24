import { app, emailProvider, prisma } from "../context.js";
import { sendPushSafely } from "./push.js";

// SMS hors connexion (Twilio Verify n'est utilisé que pour le code de connexion) : reste simulé
// pour l'instant, jamais présenté comme envoyé. L'e-mail est réellement envoyé via Resend dès que
// RESEND_API_KEY et RESEND_FROM_EMAIL sont configurés ; sinon il reste lui aussi simulé (mode mock).
// Le statut réel (en file, envoyé, échoué) est toujours tracé dans OutboxMessage.
export const notify = async (userId: string, title: string, body: string, linkPath?: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Un compte anonymisé (§20) n'a plus de coordonnées réelles : rien à notifier, et surtout jamais
  // rien à envoyer vers le numéro/e-mail de substitution posé par la suppression RGPD.
  if (user.deletedAt) return;
  await prisma.notification.create({ data: { userId, title, body, linkPath } });
  // Compte suspendu : la notification reste consultable, mais rien n'est poussé vers ses appareils.
  if (!user.suspendedAt) sendPushSafely(userId, linkPath);
  if (user.phone) await prisma.outboxMessage.create({ data: { channel: "SMS", recipient: user.phone, body: `${title} — ${body}` } });
  if (user.email) {
    const outboxEmail = await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: user.email, subject: title, body } });
    if (emailProvider.mode === "resend") {
      try {
        await emailProvider.send(user.email, title, body);
        await prisma.outboxMessage.update({ where: { id: outboxEmail.id }, data: { status: "SENT", sentAt: new Date() } });
      } catch (err) {
        await prisma.outboxMessage.update({ where: { id: outboxEmail.id }, data: { status: "FAILED", error: (err as Error).message } });
        app.log.warn({ err }, "Échec d’envoi d’e-mail réel via Resend");
      }
    }
  }
};
