import { isAdult } from "@nour/shared";
import { ApplicationStatus, LegalDocument, PaymentStatus, Prisma, SubscriptionStatus, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import { app, prisma, stripe } from "../context.js";
import { NOT_BOOKABLE_MESSAGE, isEventBookable, paymentLockExpiry, resolvePriceCents } from "../domain.js";
import { env } from "../env.js";
import { ADULT_ONLY_ERROR, hasAcceptedCurrent, recordAcceptance } from "../services/account.js";
import { audit } from "../services/audit.js";
import { auth, currentId } from "../services/auth.js";
import { links } from "../services/links.js";
import { notify } from "../services/notify.js";
import { recordCheckoutSession, syncSubscriptionFromStripe } from "../services/subscriptions.js";
import { claimReservation, createAlternativeOfferIfPossible } from "../services/reservations.js";
import { getSetting } from "../settings.js";

// Seul point d'entrée qui pose réellement une place : une candidature (PAYMENT_PENDING) ne garantit
// rien avant cet appel (§5). Pose un verrou technique court (AppSetting PAYMENT_LOCK_MINUTES) au
// moment même de la tentative de paiement — jamais avant — pour empêcher deux ventes de la dernière
// place ; s'il en existe déjà un actif (ex. réessai après une carte refusée), il est simplement
// réutilisé plutôt que d'en reposer un nouveau. Si la place n'est plus disponible, rejoint
// automatiquement la liste d'attente, exactement comme le faisait autrefois la candidature elle-même.
app.post("/applications/:id/payment-intent", { preHandler: auth }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Le paiement par carte n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId }, include: { event: { include: { priceTiers: true } }, reservation: true } });
  if (application.status !== ApplicationStatus.PAYMENT_PENDING) return reply.code(409).send({ error: "Cette candidature n’est pas en attente de paiement" });
  // §8 (corrections web 2026-09-24) : un événement de démonstration peut être découvert et le parcours
  // commencé, mais aucune transaction n'est jamais possible — ni PaymentIntent, ni verrou de place, ni
  // billet gratuit. Refus côté serveur, quel que soit le client (site, application mobile, appel direct).
  if (application.event && isEventBookable(application.event) === false) return reply.code(409).send({ error: NOT_BOOKABLE_MESSAGE, notBookable: true });
  // CGV A3 : la réservation ne devient ferme qu'après acceptation des CGV. Exigée avant de poser le
  // moindre verrou ou PaymentIntent, y compris pour une soirée gratuite.
  const { acceptCgv } = z.object({ acceptCgv: z.boolean().optional() }).parse(request.body ?? {});
  if (!acceptCgv && !(await hasAcceptedCurrent(userId, LegalDocument.CGV, `application:${id}`))) return reply.code(422).send({ error: "Vous devez accepter les conditions générales de vente avant de réserver.", cgvRequired: true });
  const payerProfile = await prisma.profile.findUnique({ where: { userId }, select: { birthDate: true } });
  if (!isAdult(payerProfile?.birthDate)) return reply.code(409).send({ error: ADULT_ONLY_ERROR });
  if (acceptCgv) await recordAcceptance(request, userId, LegalDocument.CGV, `application:${id}`);
  if (!application.eventId || !application.event) return reply.code(409).send({ error: "Cette candidature n’est liée à aucun événement" });
  const event = application.event;

  let reservation: Prisma.ReservationGetPayload<object> | null = application.reservation && !application.reservation.cancelledAt && application.reservation.expiresAt > new Date() ? application.reservation : null;
  if (!reservation) {
    const lockExpiresAt = paymentLockExpiry(new Date(), getSetting("PAYMENT_LOCK_MINUTES"));
    const result = await claimReservation(application.eventId, application, lockExpiresAt);
    if (!result.ok) {
      if (result.reason === "NO_CATEGORY") return reply.code(409).send({ error: "Complétez votre catégorie (homme/femme) dans votre profil avant de payer" });
      // Chevauchement horaire (§11) : rejeté franchement, jamais mis en liste d'attente pour un
      // événement qu'il ne pourrait de toute façon pas honorer.
      if (result.reason === "OVERLAP") return reply.code(409).send({ error: "Vous avez déjà une place réservée sur un événement qui chevauche cet horaire" });
      let waitlistEntry = await prisma.waitlistEntry.findUnique({ where: { eventId_userId: { eventId: application.eventId, userId } } });
      if (!waitlistEntry) {
        waitlistEntry = await prisma.waitlistEntry.create({ data: { eventId: application.eventId, userId, applicationId: application.id, quotaCategory: application.quotaCategory, position: (await prisma.waitlistEntry.count({ where: { eventId: application.eventId } })) + 1 } });
        await notify(userId, "Liste d’attente", `« ${event.title} » est complet pour votre catégorie ; vous avez été placé(e) sur liste d’attente.`, links.reservation(application.id));
        await createAlternativeOfferIfPossible(userId, event);
        await audit(userId, "APPLICATION_WAITLISTED_FULL", "Application", application.id);
      }
      return reply.code(409).send({ error: "Cet événement est désormais complet pour votre catégorie", waitlisted: true, waitlistEntry });
    }
    reservation = result.reservation;
  }
  const payment = await prisma.payment.findUnique({ where: { reservationId: reservation.id } });
  if (payment?.status === PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Cette réservation est déjà payée" });
  // Le tarif est résolu (unique ou différencié selon la catégorie) puis figé dans le paiement au
  // moment de sa création : une modification ultérieure du tarif de l'événement ne s'applique
  // jamais rétroactivement à cette vente.
  const amountCents = resolvePriceCents(event, reservation.quotaCategory, getSetting("ENABLE_GENDER_PRICING"));

  // Cahier des charges consolidé final (2026-09-20, section 3) : une soirée gratuite ne doit jamais
  // créer de PaymentIntent Stripe à 0 € (Stripe le refuse de toute façon, sous son minimum de
  // perception) — confirmation transactionnelle directe, avec la même protection anti-survente que
  // le webhook de paiement réel (place déjà verrouillée de façon atomique par claimReservation
  // ci-dessus ; on ne fait ici que transformer ce verrou en billet, jamais l'inverse).
  if (amountCents === 0) {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.payment.upsert({ where: { reservationId: reservation!.id }, update: { amountCents: 0, status: PaymentStatus.SUCCEEDED, provider: "free", paidAt: new Date() }, create: { reservationId: reservation!.id, amountCents: 0, status: PaymentStatus.SUCCEEDED, provider: "free", paidAt: new Date() } });
      const reservationUpdate = await tx.reservation.updateMany({ where: { id: reservation!.id, cancelledAt: null, confirmedAt: null }, data: { confirmedAt: new Date() } });
      if (reservationUpdate.count !== 1) return "ALREADY_CONFIRMED" as const;
      const ticketCode = `NOUR-${randomUUID().toUpperCase()}`;
      await tx.ticket.upsert({ where: { reservationId: reservation!.id }, update: {}, create: { reservationId: reservation!.id, code: ticketCode } });
      await tx.application.update({ where: { id: application.id }, data: { status: ApplicationStatus.CONFIRMED } });
      return "CONFIRMED" as const;
    });
    if (outcome === "CONFIRMED") {
      await notify(userId, "Place confirmée", `Votre billet gratuit pour « ${event.title} » est disponible.`, links.ticket(reservation.id));
      if (event.controllerRestaurantId) {
        const controllerRestaurant = await prisma.restaurant.findUnique({ where: { id: event.controllerRestaurantId } });
        if (controllerRestaurant) await notify(controllerRestaurant.ownerId, "Nouvelle inscription gratuite", `Une place gratuite pour « ${event.title} » vient d’être confirmée.`, links.adminEvent(event.id));
      }
      await audit(userId, "FREE_RESERVATION_CONFIRMED", "Reservation", reservation.id);
    }
    return { free: true, confirmed: outcome === "CONFIRMED" };
  }

  let clientSecret: string | null = null;
  if (payment?.providerRef) {
    const existing = await stripe.paymentIntents.retrieve(payment.providerRef);
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status)) clientSecret = existing.client_secret;
  }
  if (!clientSecret) {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: { reservationId: reservation.id, applicationId: application.id, userId }
    });
    clientSecret = intent.client_secret;
    await prisma.payment.upsert({
      where: { reservationId: reservation.id },
      update: { provider: "stripe", providerRef: intent.id, amountCents, status: PaymentStatus.PENDING },
      create: { reservationId: reservation.id, provider: "stripe", providerRef: intent.id, amountCents, status: PaymentStatus.PENDING }
    });
  }
  return { clientSecret, amountCents, expiresAt: reservation.expiresAt };
});

await app.register(async (webhooks) => {
  webhooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  webhooks.post("/webhooks/stripe", async (request, reply) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "Webhook Stripe non configuré" });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, request.headers["stripe-signature"] as string, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return reply.code(400).send({ error: `Signature Stripe invalide : ${(err as Error).message}` });
    }
    if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const reservationId = intent.metadata.reservationId;
      const reservation = reservationId ? await prisma.reservation.findUnique({ where: { id: reservationId }, include: { payment: true, event: { include: { controllerRestaurant: true } } } }) : null;
      if (reservation && reservation.payment?.providerRef === intent.id && reservation.payment.status !== PaymentStatus.SUCCEEDED) {
        if (event.type === "payment_intent.succeeded") {
          // Course entre le paiement et l'expiration de la réservation : si la place a déjà été
          // libérée (et potentiellement réattribuée à quelqu'un d'autre) avant que ce paiement
          // n'arrive, on n'émet JAMAIS de billet pour éviter toute survente. L'argent reste capturé
          // (paiement marqué réussi) mais le remboursement reste manuel, comme pour toute annulation.
          const outcome = await prisma.$transaction(async (tx) => {
            const paidUpdate = await tx.payment.updateMany({ where: { reservationId, status: { not: PaymentStatus.SUCCEEDED } }, data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() } });
            if (paidUpdate.count !== 1) return "ALREADY_HANDLED" as const;
            const reservationUpdate = await tx.reservation.updateMany({ where: { id: reservationId, cancelledAt: null }, data: { confirmedAt: new Date() } });
            if (reservationUpdate.count !== 1) return "LATE_AFTER_RELEASE" as const;
            const ticketCode = `NOUR-${randomUUID().toUpperCase()}`;
            await tx.ticket.upsert({ where: { reservationId }, update: {}, create: { reservationId, code: ticketCode } });
            await tx.application.update({ where: { id: reservation.applicationId }, data: { status: ApplicationStatus.CONFIRMED } });
            return "CONFIRMED" as const;
          });
          if (outcome === "CONFIRMED") {
            await notify(reservation.userId, "Paiement confirmé", `Votre billet pour ${reservation.event.title} est disponible.`, links.ticket(reservationId));
            // C16 (ordre correctif 2026-09-20) : le restaurateur est informé d'une vente une seule
            // fois, ici, après confirmation réelle du webhook — jamais à la simple ouverture de la
            // page de paiement par le participant.
            if (reservation.event.controllerRestaurant) await notify(reservation.event.controllerRestaurant.ownerId, "Nouvelle place vendue", `Un billet pour « ${reservation.event.title} » vient d’être payé.`, links.adminEvent(reservation.eventId));
            await audit(reservation.userId, "PAYMENT_SUCCEEDED", "Reservation", reservationId, { amountCents: reservation.event.priceCents, paymentIntentId: intent.id });
            // Comptabilité 30/70 : neutralisée par défaut depuis le passage à l'abonnement mensuel
            // (§8.2 — voir ENABLE_COMMISSION_LEDGER). Les anciennes lignes restent en base, aucune
            // nouvelle n'est créée tant que le drapeau n'est pas explicitement réactivé, et
            // uniquement pour les événements qu'un restaurant organise commercialement (jamais pour
            // un événement Nour où ce restaurant n'est que le lieu). Le taux et les frais Stripe
            // réels sont figés au moment de la vente.
            if (reservation.event.controllerRestaurantId && getSetting("ENABLE_COMMISSION_LEDGER")) {
              const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: reservation.event.controllerRestaurantId } });
              const grossAmountCents = reservation.payment!.amountCents;
              const commissionRate = restaurant.commissionRate;
              const commissionAmountCents = Math.round((grossAmountCents * commissionRate) / 100);
              const restaurantDueCents = grossAmountCents - commissionAmountCents;
              let stripeFeeCents: number | null = null;
              try {
                const full = await stripe.paymentIntents.retrieve(intent.id, { expand: ["latest_charge.balance_transaction"] });
                const charge = full.latest_charge as Stripe.Charge | null;
                const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null;
                if (balanceTransaction && typeof balanceTransaction === "object") stripeFeeCents = balanceTransaction.fee;
              } catch (err) { app.log.warn({ err }, "Impossible de récupérer les frais Stripe réels pour cette vente"); }
              await prisma.ledgerEntry.create({ data: { paymentId: reservation.payment!.id, eventId: reservation.eventId, restaurantId: restaurant.id, grossAmountCents, commissionRate, commissionAmountCents, restaurantDueCents, stripeFeeCents } });
            }
          } else if (outcome === "LATE_AFTER_RELEASE") {
            await notify(reservation.userId, "Paiement reçu après expiration", "Votre place n’était plus disponible au moment où votre paiement a été confirmé. Le remboursement sera traité manuellement par notre équipe.", links.reservation(reservation.applicationId));
            const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
            await Promise.all(admins.map(a => notify(a.id, "Paiement tardif après libération de place", `Un paiement a été confirmé pour « ${reservation.event.title} » après l’expiration de la réservation : remboursement à traiter manuellement.`, "/admin/finance")));
            await audit(reservation.userId, "PAYMENT_SUCCEEDED_AFTER_RELEASE", "Reservation", reservationId, { amountCents: reservation.event.priceCents, paymentIntentId: intent.id });
          }
        } else {
          await prisma.payment.updateMany({ where: { reservationId, status: { not: PaymentStatus.SUCCEEDED } }, data: { status: PaymentStatus.FAILED } });
          await audit(reservation.userId, "PAYMENT_FAILED", "Reservation", reservationId, { paymentIntentId: intent.id });
        }
      }
    } else if (event.type === "checkout.session.completed") {
      // C06/C07 (instructions définitives 2026-09-20) : la session Checkout confirme le moyen de
      // paiement et l'essai démarre réellement côté Stripe (trial_period_days, voir la création de la
      // session) — jamais un simple changement de statut local sans passage par Stripe.
      await recordCheckoutSession(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const stripeSub = event.data.object as Stripe.Subscription;
      const existing = await prisma.restaurantSubscription.findFirst({ where: { stripeSubscriptionId: stripeSub.id }, include: { restaurant: true, plan: true } });
      if (existing) {
        const wasActiveOrTrialing = existing.status === SubscriptionStatus.ACTIVE || existing.status === SubscriptionStatus.TRIALING;
        // §1.4 (corrections web 2026-09-24) : formule, statut, période et changement différé toujours
        // recopiés depuis Stripe par la même fonction que la resynchronisation manuelle.
        const synced = await syncSubscriptionFromStripe(existing, stripeSub, { deleted: event.type === "customer.subscription.deleted" });
        const status = synced.status;
        if (synced.planId !== existing.planId) await notify(existing.restaurant.ownerId, "Formule d’abonnement modifiée", `Votre établissement est désormais en formule « ${synced.plan.name} ».`, "/restaurant?tab=subscription");
        // C09 : ne notifier une expiration/désactivation que sur une vraie transition, jamais à
        // chaque événement Stripe de mise à jour mineure (ex. changement de carte).
        if (wasActiveOrTrialing && status === SubscriptionStatus.CANCELLED) {
          await notify(existing.restaurant.ownerId, "Abonnement résilié", `Votre abonnement « ${existing.plan.name} » est résilié. Vos soirées déjà confirmées restent valables ; les nouvelles publications sont bloquées.`, "/restaurant?tab=subscription");
        } else if (wasActiveOrTrialing && status === SubscriptionStatus.PAST_DUE) {
          await notify(existing.restaurant.ownerId, "Paiement d’abonnement échoué", `Le prélèvement pour « ${existing.plan.name} » a échoué. Merci de mettre à jour votre moyen de paiement pour conserver votre accès.`, "/restaurant?tab=subscription");
        } else if (existing.status === SubscriptionStatus.TRIALING && status === SubscriptionStatus.ACTIVE) {
          await notify(existing.restaurant.ownerId, "Abonnement activé", `Votre essai gratuit est terminé : l’abonnement « ${existing.plan.name} » est maintenant actif.`, "/restaurant?tab=subscription");
        }
        await audit(existing.restaurant.ownerId, "SUBSCRIPTION_STRIPE_SYNCED", "RestaurantSubscription", existing.id, { stripeStatus: stripeSub.status });
      }
    } else if (event.type === "invoice.payment_succeeded") {
      // Arbitrage final 01 (cahier des charges consolidé 2026-09-20) : le premier paiement
      // d'abonnement RÉELLEMENT réussi (jamais le simple enregistrement d'une carte ni le seul
      // démarrage de l'essai) approuve automatiquement une candidature encore en attente. Un
      // paiement échoué (invoice.payment_failed, déjà couvert par la synchronisation de statut
      // ci-dessus via PAST_DUE) n'approuve jamais rien.
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionRef = invoice.parent?.subscription_details?.subscription;
      const stripeSubscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
      if (stripeSubscriptionId) {
        const existing = await prisma.restaurantSubscription.findFirst({ where: { stripeSubscriptionId }, include: { restaurant: { include: { owner: true } } } });
        if (existing && existing.restaurant.status === "PENDING") {
          await prisma.$transaction([
            prisma.restaurant.update({ where: { id: existing.restaurant.id }, data: { status: "APPROVED", verifiedAt: new Date() } }),
            prisma.user.update({ where: { id: existing.restaurant.ownerId }, data: { role: existing.restaurant.owner.role === UserRole.PARTICIPANT ? UserRole.ORGANIZER : existing.restaurant.owner.role } })
          ]);
          await notify(existing.restaurant.ownerId, "Compte restaurateur approuvé automatiquement", "Votre premier paiement d’abonnement a été confirmé : votre établissement est approuvé. Vous pouvez proposer des soirées, chacune restant soumise à validation.", "/restaurant?tab=subscription");
          await audit(undefined, "AUTO_APPROVE_RESTAURANT_ON_PAYMENT", "Restaurant", existing.restaurant.id, { invoiceId: invoice.id });
        }
      }
    }
    return reply.send({ received: true });
  });
});
