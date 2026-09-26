import { app, emailProvider, prisma } from "../context.js";
import { SITE_ORIGIN, env } from "../env.js";
import { renderEmail } from "./email-layout.js";

// E-mail de bienvenue (décision v2 §4, puis v3 §5.2) : un modèle Participant et un modèle Restaurateur,
// envoyé une seule fois par compte, dès que le compte a une adresse e-mail vérifiée ET un type définitif
// (choix « Participer aux événements », ou formulaire restaurateur réellement soumis — v3 §5.1). Appelé
// à chaque connexion et au moment où le type devient définitif ; la réservation se fait par une écriture
// conditionnelle (welcomeEmailSentAt encore nul), donc deux appels simultanés n'envoient jamais deux
// e-mails. Un échec d'envoi n'empêche jamais la connexion : il est journalisé et la réservation levée,
// pour un nouvel essai plus tard.

type AccountKind = "PARTICIPANT" | "RESTAURATEUR";

// Lien App Store seulement s'il est réellement configuré (application publiée) : jamais d'adresse inventée.
const appStoreLink = () => env.APP_STORE_URL ? [{ label: "Télécharger l’application Nūr Meet", url: env.APP_STORE_URL }] : [];

export function welcomeEmail(kind: AccountKind, name: string) {
  const subject = kind === "RESTAURATEUR" ? "Bienvenue dans l’espace partenaire Nūr Meet" : "Bienvenue sur Nūr Meet";
  const content = kind === "RESTAURATEUR"
    ? renderEmail({
      preheader: "Votre demande est reçue : préparez votre première soirée et suivez vos validations.",
      heading: `Bienvenue, ${name}`,
      paragraphs: [
        "Merci d’avoir présenté votre établissement à Nūr Meet. Votre demande est entre les mains de l’équipe.",
        "Depuis votre espace partenaire, vous pouvez déjà préparer votre première soirée : elle reste un brouillon, puis passe par la validation de l’équipe avant toute publication.",
        "L’onglet « Validations » vous montre à tout moment où en sont votre établissement et chacun de vos événements."
      ],
      cta: { label: "Ouvrir mon espace partenaire", url: `${SITE_ORIGIN}/restaurant` },
      links: [{ label: "Voir les formules", url: `${SITE_ORIGIN}/restaurateurs` }, ...appStoreLink()]
    })
    : renderEmail({
      preheader: "Des soirées en petit comité pour faire de vraies rencontres ou élargir votre réseau.",
      heading: `Bienvenue, ${name}`,
      paragraphs: [
        "Nūr Meet organise des soirées en petit comité dans des restaurants à Paris et en Île-de-France, pour faire de vraies rencontres ou élargir votre réseau.",
        "Pour bien commencer : complétez votre profil, puis choisissez une soirée. Le speed dating passe par un court appel de validation, une seule fois ; le networking est en accès direct.",
        "Pendant la soirée, échangez vos codes personnels : la conversation continue ensuite dans l’application, seulement si l’intérêt est réciproque."
      ],
      cta: { label: "Découvrir les prochaines soirées", url: `${SITE_ORIGIN}/events` },
      links: [{ label: "Compléter mon profil", url: `${SITE_ORIGIN}/dashboard?tab=profile` }, { label: "Comment ça marche", url: `${SITE_ORIGIN}/concept` }, ...appStoreLink()]
    });
  return { subject, ...content };
}

export async function sendWelcomeEmailOnce(userId: string) {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, accountTypeChosenAt: true, ownedRestaurant: { select: { id: true } } } });
  if (!account) return false;
  // Type encore indécis (choix interrompu) : aucun e-mail, il partira au moment du choix.
  const kind: AccountKind | null = account.ownedRestaurant || account.role === "ORGANIZER" ? "RESTAURATEUR" : account.accountTypeChosenAt || account.role !== "PARTICIPANT" ? "PARTICIPANT" : null;
  if (!kind) return false;
  const claimed = await prisma.user.updateMany({ where: { id: userId, email: { not: null }, emailVerifiedAt: { not: null }, welcomeEmailSentAt: null, deletedAt: null }, data: { welcomeEmailSentAt: new Date() } });
  if (claimed.count === 0) return false;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, displayName: true } });
  const email = welcomeEmail(kind, user.displayName);
  const outbox = await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: user.email!, subject: email.subject, body: email.text } });
  try {
    await emailProvider.send(user.email!, email.subject, email.text, email.html);
    if (emailProvider.mode === "resend") await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: "SENT", sentAt: new Date() } });
    return true;
  } catch (err) {
    await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: "FAILED", error: (err as Error).message } });
    await prisma.user.update({ where: { id: userId }, data: { welcomeEmailSentAt: null } });
    app.log.warn({ err }, "Échec d'envoi de l'e-mail de bienvenue");
    return false;
  }
}
