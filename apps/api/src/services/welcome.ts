import { app, emailProvider, prisma } from "../context.js";

// E-mail de bienvenue (décision v2 §4) : envoyé une seule fois par compte, dès qu'il possède une
// adresse e-mail vérifiée — inscription par e-mail, par Google (adresse vérifiée par Google), ou
// adresse vérifiée plus tard. Appelé à chaque connexion ; la réservation se fait par une écriture
// conditionnelle (welcomeEmailSentAt encore nul), donc deux connexions simultanées n'envoient jamais
// deux e-mails. Un échec d'envoi n'empêche jamais la connexion : il est journalisé et la réservation
// est levée, pour un nouvel essai à la connexion suivante.
const SUBJECT = "Bienvenue sur Nūr Meet";
const body = (name: string) => [
  `Bonjour ${name},`,
  "",
  "Bienvenue sur Nūr Meet : des soirées en petit comité, dans des restaurants à Paris et en Île-de-France, pour faire de vraies rencontres ou élargir votre réseau.",
  "",
  "Pour bien commencer :",
  "1. Complétez votre profil dans votre espace.",
  "2. Choisissez une soirée : speed dating (après un court appel de validation, une seule fois) ou networking (accès direct).",
  "3. Réservez votre place : votre billet arrive aussitôt dans votre espace.",
  "",
  "Après la soirée, échangez vos codes personnels : la conversation ne s'ouvre que si l'intérêt est réciproque.",
  "",
  "À très bientôt autour d'une table,",
  "L'équipe Nūr Meet",
  "contact@nourmeet.com"
].join("\n");

export async function sendWelcomeEmailOnce(userId: string) {
  const claimed = await prisma.user.updateMany({ where: { id: userId, email: { not: null }, emailVerifiedAt: { not: null }, welcomeEmailSentAt: null, deletedAt: null }, data: { welcomeEmailSentAt: new Date() } });
  if (claimed.count === 0) return false;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, displayName: true } });
  const outbox = await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: user.email!, subject: SUBJECT, body: body(user.displayName) } });
  try {
    await emailProvider.send(user.email!, SUBJECT, body(user.displayName));
    if (emailProvider.mode === "resend") await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: "SENT", sentAt: new Date() } });
    return true;
  } catch (err) {
    await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: "FAILED", error: (err as Error).message } });
    await prisma.user.update({ where: { id: userId }, data: { welcomeEmailSentAt: null } });
    app.log.warn({ err }, "Échec d'envoi de l'e-mail de bienvenue");
    return false;
  }
}
