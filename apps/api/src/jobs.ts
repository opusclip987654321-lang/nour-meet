import { AlternativeOfferStatus, EventStatus, UserRole } from "@prisma/client";
import Stripe from "stripe";
import { aiProvider, app, ownsBackgroundJobs, prisma, stripe } from "./context.js";
import { logArticleTransition } from "./services/articles.js";
import { audit } from "./services/audit.js";
import { illustrateArticle } from "./services/article-image.js";
import { publishDailyArticle } from "./services/blog-autopublish.js";
import { facebookConfig, illustrationConfig, instagramConfig } from "./services/social-config.js";
import { shareArticleOnFacebook } from "./services/facebook.js";
import { refreshInstagramToken, shareArticleOnInstagram } from "./services/instagram.js";
import { cancelEventWithRefunds } from "./services/event-cancellation.js";
import { links } from "./services/links.js";
import { notify } from "./services/notify.js";
import { offerNextWaitlistEntry, releaseReservationSlot } from "./services/reservations.js";
import { getSetting } from "./settings.js";

// Libère toutes les 60 secondes les réservations temporaires expirées (place + quota), enchaîne sur la
// liste d'attente correspondante, et marque comme expirées les propositions d'événements alternatifs
// restées sans réponse au-delà de leur délai.
const releaseExpiredReservations = async () => {
  const expired = await prisma.reservation.findMany({ where: { expiresAt: { lt: new Date() }, confirmedAt: null, cancelledAt: null } });
  for (const reservation of expired) {
    await prisma.$transaction(tx => releaseReservationSlot(tx, reservation));
    await notify(reservation.userId, "Délai de paiement expiré", "Le délai pour régler votre billet est dépassé ; la place a été libérée.", links.reservation(reservation.applicationId));
    await audit(undefined, "RESERVATION_EXPIRED", "Reservation", reservation.id);
    await offerNextWaitlistEntry(reservation.eventId, reservation.quotaCategory);
  }
  await prisma.alternativeOffer.updateMany({ where: { status: AlternativeOfferStatus.PENDING, respondsBy: { lt: new Date() } }, data: { status: AlternativeOfferStatus.EXPIRED } });
};
if (ownsBackgroundJobs) setInterval(() => { releaseExpiredReservations().catch(err => app.log.error(err)); }, 60_000);

// Le frais Stripe réel n'est pas toujours disponible au moment exact du webhook de paiement réussi
// (la transaction de solde peut être calculée quelques secondes après) : on le complète ici en
// deuxième passage, sans jamais bloquer la création de la ligne comptable elle-même.
const backfillStripeFees = async () => {
  if (!stripe) return;
  const pending = await prisma.ledgerEntry.findMany({ where: { stripeFeeCents: null }, include: { payment: true }, take: 20 });
  for (const entry of pending) {
    if (!entry.payment.providerRef) continue;
    try {
      const full = await stripe.paymentIntents.retrieve(entry.payment.providerRef, { expand: ["latest_charge.balance_transaction"] });
      const charge = full.latest_charge as Stripe.Charge | null;
      const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null;
      if (balanceTransaction && typeof balanceTransaction === "object") {
        await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { stripeFeeCents: balanceTransaction.fee } });
      }
    } catch (err) { app.log.warn({ err }, "Nouvelle tentative de récupération des frais Stripe échouée"); }
  }
};
if (ownsBackgroundJobs) setInterval(() => { backfillStripeFees().catch(err => app.log.error(err)); }, 60_000);

// Minimum de participants (§10) : à la date limite, si le seuil n'est pas atteint, notifie le
// restaurateur et ouvre une fenêtre de réponse courte (AppSetting MIN_PARTICIPANTS_DECISION_WINDOW_HOURS) ;
// sans décision explicite dans ce délai, applique l'action par défaut (AppSetting
// MIN_PARTICIPANTS_NO_RESPONSE_ACTION, "maintien" par défaut pour éviter une annulation surprise).
const checkMinParticipantsThresholds = async () => {
  const dueForNotification = await prisma.event.findMany({
    where: { status: EventStatus.PUBLISHED, minParticipants: { not: null }, minParticipantsDeadline: { lt: new Date() }, minParticipantsNotifiedAt: null },
    include: { controllerRestaurant: true, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } }
  });
  for (const event of dueForNotification) {
    if (event._count.reservations >= (event.minParticipants ?? 0)) { await prisma.event.update({ where: { id: event.id }, data: { minParticipantsNotifiedAt: new Date() } }); continue; }
    await prisma.event.update({ where: { id: event.id }, data: { minParticipantsNotifiedAt: new Date() } });
    const windowHours = getSetting("MIN_PARTICIPANTS_DECISION_WINDOW_HOURS");
    if (event.controllerRestaurant) await notify(event.controllerRestaurant.ownerId, "Minimum de participants non atteint", `« ${event.title} » n’a pas atteint son minimum de ${event.minParticipants} participants. Vous avez ${windowHours}h pour maintenir ou annuler, sans quoi l’événement sera maintenu par défaut.`, links.restaurantEvent(event.id));
    const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
    await Promise.all(admins.map(a => notify(a.id, "Minimum de participants non atteint", `« ${event.title} » n’a pas atteint son minimum de participants.`, `/admin/events?highlight=${event.id}`)));
    await audit(undefined, "MIN_PARTICIPANTS_NOT_REACHED", "Event", event.id, { minParticipants: event.minParticipants, confirmedCount: event._count.reservations });
  }
  const windowHours = getSetting("MIN_PARTICIPANTS_DECISION_WINDOW_HOURS");
  const dueForDefaultDecision = await prisma.event.findMany({ where: { status: EventStatus.PUBLISHED, minParticipantsNotifiedAt: { not: null, lt: new Date(Date.now() - windowHours * 60 * 60_000) }, minParticipantsOutcome: null } });
  for (const event of dueForDefaultDecision) {
    const action = getSetting("MIN_PARTICIPANTS_NO_RESPONSE_ACTION");
    if (action === "CANCEL") {
      await cancelEventWithRefunds(event, undefined, "MIN_PARTICIPANTS_AUTO_CANCELLED");
      await prisma.event.update({ where: { id: event.id }, data: { minParticipantsOutcome: "CANCELLED", minParticipantsDecidedAt: new Date() } });
    } else {
      await prisma.event.update({ where: { id: event.id }, data: { minParticipantsOutcome: "MAINTAINED", minParticipantsDecidedAt: new Date() } });
      await audit(undefined, "MIN_PARTICIPANTS_AUTO_MAINTAINED", "Event", event.id);
    }
  }
};
if (ownsBackgroundJobs) setInterval(() => { checkMinParticipantsThresholds().catch(err => app.log.error(err)); }, 60_000);

// Rappel d'événement en deux temps (§13, complété §3 du cahier des charges 2026-09) : un rappel J-1
// (AppSetting EVENT_REMINDER_HOURS_BEFORE) puis un second rappel plus proche H-2 (AppSetting
// EVENT_REMINDER_H2_HOURS_BEFORE), chacun envoyé une seule fois par réservation confirmée grâce à son
// propre marqueur (reminderSentAt / reminderH2SentAt), qui rend le balayage idempotent même si le
// serveur redémarre entre deux passages.
const sendEventReminders = async () => {
  const sendBatch = async (hoursBefore: number, field: "reminderSentAt" | "reminderH2SentAt", label: string) => {
    const due = await prisma.reservation.findMany({
      where: { confirmedAt: { not: null }, cancelledAt: null, [field]: null, event: { startsAt: { gt: new Date(), lte: new Date(Date.now() + hoursBefore * 60 * 60_000) } } },
      include: { event: true }
    });
    for (const reservation of due) {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { [field]: new Date() } });
      await notify(reservation.userId, "Votre événement approche", `« ${reservation.event.title} » a lieu ${label} (${reservation.event.startsAt.toLocaleString("fr-FR")}). À très vite !`, links.ticket(reservation.id));
    }
  };
  await sendBatch(getSetting("EVENT_REMINDER_HOURS_BEFORE"), "reminderSentAt", "demain");
  await sendBatch(getSetting("EVENT_REMINDER_H2_HOURS_BEFORE"), "reminderH2SentAt", "dans un peu plus de 2h");
};
// §3 (cahier des charges 2026-09) : rappel d'abonnement restaurateur bientôt expiré (fin de période ou
// fin d'essai), envoyé une seule fois par période via expiryReminderSentAt.
const checkSubscriptionExpirySoon = async () => {
  const daysBefore = getSetting("SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE");
  const candidates = await prisma.restaurantSubscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] }, cancelledAt: null,
      currentPeriodEnd: { gt: new Date(), lte: new Date(Date.now() + daysBefore * 24 * 60 * 60_000) }
    },
    include: { restaurant: true, plan: true }
  });
  const due = candidates.filter(sub => !sub.expiryReminderSentAt || sub.expiryReminderSentAt < sub.currentPeriodStart);
  for (const sub of due) {
    await prisma.restaurantSubscription.update({ where: { id: sub.id }, data: { expiryReminderSentAt: new Date() } });
    const label = sub.status === "TRIALING" ? "votre essai gratuit se termine" : "votre abonnement se renouvelle";
    await notify(sub.restaurant.ownerId, "Abonnement bientôt renouvelé", `Formule ${sub.plan.name} : ${label} le ${sub.currentPeriodEnd.toLocaleDateString("fr-FR")}.`, "/restaurant?tab=subscription");
  }
};
if (ownsBackgroundJobs) setInterval(() => { checkSubscriptionExpirySoon().catch(err => app.log.error(err)); }, 60_000);
// §7 (cahier des charges 2026-09) : « on enclenche le paiement au bout de 7 jours s'il n'annule pas ».
// Ne concerne QUE les abonnements sans objet Stripe réel (assignation manuelle admin historique,
// voir /admin/restaurants/:id/subscription) : un abonnement souscrit via Checkout est piloté par
// Stripe lui-même (trial_period_days) et synchronisé par les webhooks customer.subscription.*,
// jamais par ce balayage, pour ne jamais désynchroniser notre statut de la réalité Stripe.
const checkTrialSubscriptionsDue = async () => {
  const due = await prisma.restaurantSubscription.findMany({ where: { status: "TRIALING", currentPeriodEnd: { lt: new Date() }, stripeSubscriptionId: null }, include: { restaurant: true, plan: true } });
  for (const sub of due) {
    await prisma.restaurantSubscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000) } });
    await notify(sub.restaurant.ownerId, "Abonnement activé", `Votre essai gratuit est terminé : l’abonnement « ${sub.plan.name} » (${(sub.plan.monthlyPriceCents / 100).toFixed(0)} €/mois) est maintenant actif.`, "/restaurant?tab=subscription");
    await audit(undefined, "TRIAL_SUBSCRIPTION_ACTIVATED", "RestaurantSubscription", sub.id);
  }
};
if (ownsBackgroundJobs) setInterval(() => { checkTrialSubscriptionsDue().catch(err => app.log.error(err)); }, 60_000);
// Plus d'essai gratuit pour les nouveaux abonnements (décision du 2026-09-25) : seuls d'éventuels
// abonnements souscrits avant cette date peuvent encore être en essai ; Stripe gère seul leur échéance.
if (ownsBackgroundJobs) setInterval(() => { sendEventReminders().catch(err => app.log.error(err)); }, 60_000);

// Programmation d'articles (§18) : ne publie jamais depuis DRAFT ou IN_REVIEW, uniquement un
// article déjà explicitement validé (APPROVED) dont la date programmée est atteinte.
const publishScheduledArticles = async () => {
  const due = await prisma.article.findMany({ where: { status: "APPROVED", scheduledAt: { lte: new Date() } } });
  for (const article of due) {
    await prisma.article.update({ where: { id: article.id }, data: { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null } });
    await logArticleTransition(article.id, undefined, article.status, "PUBLISHED", "Publication automatique programmée");
  }
};
if (ownsBackgroundJobs) setInterval(() => { publishScheduledArticles().catch(err => app.log.error(err)); }, 60_000);

// C32-C34 : purge automatique des visites au-delà de la rétention configurée (ANALYTICS_RETENTION_DAYS,
// 13 mois par défaut — plafond habituel de l'exemption CNIL « mesure d'audience »).
const purgeOldPageViews = async () => {
  const retentionDays = getSetting("ANALYTICS_RETENTION_DAYS");
  await prisma.pageView.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - retentionDays * 24 * 60 * 60_000) } } });
};
if (ownsBackgroundJobs) setInterval(() => { purgeOldPageViews().catch(err => app.log.error(err)); }, 24 * 60 * 60_000);
// C37 : hausse inhabituelle des annulations sur 24h glissantes, seuil configurable
// (CANCELLATION_ALERT_THRESHOLD_PERCENT) ; une seule alerte par fenêtre pour éviter les doublons.
let lastCancellationAlertAt: Date | null = null;
const checkCancellationSpike = async () => {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [confirmed, cancelled] = await Promise.all([
    prisma.reservation.count({ where: { confirmedAt: { gte: since } } }),
    prisma.reservation.count({ where: { confirmedAt: { not: null }, cancelledAt: { gte: since } } })
  ]);
  if (confirmed === 0) return;
  const rate = (cancelled / confirmed) * 100;
  const threshold = getSetting("CANCELLATION_ALERT_THRESHOLD_PERCENT");
  if (rate < threshold) return;
  if (lastCancellationAlertAt && Date.now() - lastCancellationAlertAt.getTime() < 6 * 60 * 60_000) return;
  lastCancellationAlertAt = new Date();
  const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
  await Promise.all(admins.map(a => notify(a.id, "Hausse inhabituelle des annulations", `Taux d’annulation sur 24h : ${rate.toFixed(0)}% (seuil ${threshold}%).`, "/admin/stats")));
  await audit(undefined, "CANCELLATION_SPIKE_ALERT", "Reservation", "n/a", { rate, threshold, confirmed, cancelled });
};
if (ownsBackgroundJobs) setInterval(() => { checkCancellationSpike().catch(err => app.log.error(err)); }, 60 * 60_000);

// Corrections web 2026-09-24 (§3) : un article publié automatiquement chaque jour en production, sans
// validation manuelle préalable (le super-admin peut le consulter et le supprimer ensuite). Généré
// par Claude avec recherche web ; si l'IA est indisponible, la réserve d'articles déjà rédigés prend
// le relais. Passage toutes les 30 minutes : l'heure exacte importe peu, l'unicité par jour est
// garantie par la base (Article.autoPublishDay), jamais par ce minuteur. Une panne de l'IA n'affecte
// rien d'autre que cette tâche (erreurs capturées ici, jamais propagées au reste de l'API).
const runDailyArticle = async () => {
  if (process.env.NODE_ENV !== "production" || getSetting("AI_BLOG_GENERATION_MODE") !== "AUTO_PUBLISH_DAILY") return;
  const illustration = illustrationConfig, instagram = instagramConfig, facebook = facebookConfig;
  const outcome = await publishDailyArticle({ prisma, aiProvider, notify, log: app.log, illustrate: illustration ? article => illustrateArticle(illustration, aiProvider, article, app.log) : undefined, shareOnInstagram: instagram ? articleId => shareArticleOnInstagram(prisma, instagram, articleId) : undefined, shareOnFacebook: facebook ? articleId => shareArticleOnFacebook(prisma, facebook, articleId) : undefined });
  if (outcome === "PUBLISHED_AI" || outcome === "PUBLISHED_QUEUE") app.log.info({ outcome }, "Article du jour publié");
};
// Jeton Instagram (60 jours) renouvelé chaque semaine, indépendamment de la publication du jour.
const instagramForRefresh = instagramConfig;
if (ownsBackgroundJobs && instagramForRefresh && process.env.NODE_ENV === "production") {
  const refresh = () => refreshInstagramToken(prisma, instagramForRefresh).then(done => { if (done) app.log.info("Jeton Instagram renouvelé"); }).catch(err => app.log.warn({ err: (err as Error).message }, "Renouvellement du jeton Instagram échoué"));
  setTimeout(refresh, 5 * 60_000);
  setInterval(refresh, 24 * 60 * 60_000);
}
if (ownsBackgroundJobs) {
  setTimeout(() => { runDailyArticle().catch(err => app.log.error(err)); }, 60_000);
  setInterval(() => { runDailyArticle().catch(err => app.log.error(err)); }, 30 * 60_000);
}

// Codes de retour de la connexion Google mobile : valables 2 minutes, purgés après une heure.
const purgeLoginHandoffs = () => prisma.loginHandoff.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
if (ownsBackgroundJobs) setInterval(() => { purgeLoginHandoffs().catch(err => app.log.error(err)); }, 60 * 60_000);
