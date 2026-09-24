import { Plan, RestaurantSubscription, SubscriptionStatus } from "@prisma/client";
import Stripe from "stripe";
import { httpError, prisma, stripe } from "../context.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { mapStripeSubscriptionStatus } from "./payments.js";

// Changement de formule restaurateur (corrections web 2026-09-24, §1.4) : règle métier unique,
// jamais dupliquée dans l'interface.
// - Vers une formule plus chère (Standard → Premium) : immédiat, prorata facturé tout de suite par
//   Stripe (proration_behavior "always_invoice"). payment_behavior "pending_if_incomplete" : si le
//   prorata n'est pas payé, Stripe n'applique PAS le changement — jamais une formule supérieure
//   affichée sans avoir été réglée.
// - Vers une formule moins chère (Premium → Standard) : la formule payée reste acquise jusqu'à la fin
//   de la période en cours, la nouvelle ne s'applique qu'à l'échéance, via un calendrier d'abonnement
//   Stripe (subscription schedule) — jamais un simple drapeau local que Stripe ignorerait.
export type PlanChangeDirection = "UPGRADE" | "DOWNGRADE";
export const planChangeDirection = (current: Pick<Plan, "monthlyPriceCents">, target: Pick<Plan, "monthlyPriceCents">): PlanChangeDirection =>
  target.monthlyPriceCents > current.monthlyPriceCents ? "UPGRADE" : "DOWNGRADE";

export const priceIdFor = (plan: Pick<Plan, "stripePriceMonthlyId" | "stripePriceAnnualId">, billingPeriod: string) =>
  billingPeriod === "ANNUAL" ? plan.stripePriceAnnualId : plan.stripePriceMonthlyId;

// Retrouve la formule (et la périodicité) correspondant au prix réellement facturé par Stripe : la
// seule source de vérité après un changement, jamais la formule demandée par l'interface.
const planForStripePrice = async (priceId: string | undefined) => {
  if (!priceId) return null;
  const plan = await prisma.plan.findFirst({ where: { OR: [{ stripePriceMonthlyId: priceId }, { stripePriceAnnualId: priceId }] } });
  if (!plan) return null;
  return { plan, billingPeriod: plan.stripePriceAnnualId === priceId ? "ANNUAL" : "MONTHLY" };
};

// Recopie l'état réel d'un abonnement Stripe dans notre base (webhook customer.subscription.* et
// resynchronisation explicite après un changement de formule) : statut, période, formule facturée,
// résiliation programmée. Un changement différé encore en attente reste affiché tant que Stripe
// n'a pas réellement basculé sur la nouvelle formule, puis s'efface de lui-même.
export const syncSubscriptionFromStripe = async (existing: RestaurantSubscription, stripeSub: Stripe.Subscription, opts: { deleted?: boolean } = {}) => {
  const item = stripeSub.items.data[0];
  const billed = await planForStripePrice(item?.price?.id);
  const status = opts.deleted ? SubscriptionStatus.CANCELLED : mapStripeSubscriptionStatus(stripeSub.status);
  const planId = billed?.plan.id ?? existing.planId;
  const pendingApplied = !!existing.pendingPlanId && existing.pendingPlanId === planId;
  // Un calendrier libéré ou terminé côté Stripe (changement annulé depuis le portail, par exemple)
  // ne laisse plus rien en attente : on n'affiche jamais un changement que Stripe n'appliquera pas.
  const scheduleGone = !!existing.stripeScheduleId && !stripeSub.schedule;
  const clearPending = pendingApplied || scheduleGone || status === SubscriptionStatus.CANCELLED;
  return prisma.restaurantSubscription.update({
    where: { id: existing.id },
    data: {
      status, planId, billingPeriod: billed?.billingPeriod ?? existing.billingPeriod,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
      currentPeriodStart: item ? new Date(item.current_period_start * 1000) : existing.currentPeriodStart,
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : existing.currentPeriodEnd,
      cancelledAt: status === SubscriptionStatus.CANCELLED ? existing.cancelledAt ?? new Date() : null,
      ...(clearPending ? { pendingPlanId: null, pendingChangeAt: null, stripeScheduleId: null } : {})
    },
    include: { plan: true }
  });
};

// Libère un calendrier Stripe encore actif (changement différé annulé, ou remplacé par un passage
// immédiat à une formule supérieure) : l'abonnement continue alors normalement, sans changement prévu.
const releaseSchedule = async (scheduleId: string | null) => {
  if (!stripe || !scheduleId) return;
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  if (schedule.status === "active" || schedule.status === "not_started") await stripe.subscriptionSchedules.release(scheduleId);
};

type SubscriptionWithPlan = RestaurantSubscription & { plan: Plan };

export const changeSubscriptionPlan = async (subscription: SubscriptionWithPlan, target: Plan) => {
  if (!stripe) throw httpError(503, "Stripe n’est pas configuré sur ce serveur : changement de formule impossible.");
  if (!subscription.stripeSubscriptionId) throw httpError(409, "Cet abonnement n’est pas géré par Stripe : contactez l’équipe Nūr Meet pour changer de formule.");
  if (subscription.status === SubscriptionStatus.CANCELLED) throw httpError(409, "Cet abonnement est résilié : choisissez une nouvelle formule.");
  if (subscription.cancelAtPeriodEnd) throw httpError(409, "Une résiliation est programmée : réactivez votre abonnement depuis « Gérer mon moyen de paiement » avant de changer de formule.");
  if (target.id === subscription.planId) throw httpError(409, "C’est déjà votre formule actuelle.");
  if (!target.active) throw httpError(409, "Cette formule n’est plus proposée.");
  const targetPriceId = priceIdFor(target, subscription.billingPeriod);
  if (!targetPriceId) throw httpError(409, `La formule ${target.name} n’est pas disponible en facturation ${subscription.billingPeriod === "ANNUAL" ? "annuelle" : "mensuelle"}.`);
  const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  const item = stripeSub.items.data[0];
  if (!item) throw httpError(409, "Abonnement Stripe sans ligne de facturation : contactez l’équipe Nūr Meet.");
  const direction = planChangeDirection(subscription.plan, target);

  if (direction === "UPGRADE") {
    // Un passage à la baisse déjà programmé est annulé : on ne peut pas garder à la fois une montée
    // immédiate et une descente prévue à l'échéance.
    await releaseSchedule(subscription.stripeScheduleId);
    const updated = await stripe.subscriptions.update(stripeSub.id, {
      items: [{ id: item.id, price: targetPriceId }],
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete"
    });
    // pending_update non nul = le prorata n'a pas pu être encaissé : Stripe garde l'ancienne formule.
    if (updated.pending_update) throw httpError(402, "Le paiement du prorata a échoué : votre formule actuelle est conservée. Mettez à jour votre moyen de paiement puis réessayez.");
    const synced = await syncSubscriptionFromStripe({ ...subscription, stripeScheduleId: null }, updated);
    return { direction, subscription: await prisma.restaurantSubscription.update({ where: { id: synced.id }, data: { pendingPlanId: null, pendingChangeAt: null, stripeScheduleId: null }, include: { plan: true } }) };
  }

  // Passage à une formule inférieure : phase 1 = formule actuelle jusqu'à la fin de la période
  // (essai compris, recopié tel quel pour ne jamais l'écourter), phase 2 = nouvelle formule, puis le
  // calendrier se libère et l'abonnement continue normalement sur la nouvelle formule.
  const scheduleId = stripeSub.schedule ? (typeof stripeSub.schedule === "string" ? stripeSub.schedule : stripeSub.schedule.id) : (await stripe.subscriptionSchedules.create({ from_subscription: stripeSub.id })).id;
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const currentPhase = schedule.current_phase;
  const periodEnd = item.current_period_end;
  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    phases: [
      {
        items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
        start_date: currentPhase?.start_date ?? item.current_period_start,
        end_date: periodEnd,
        ...(stripeSub.trial_end && stripeSub.trial_end > Math.floor(Date.now() / 1000) ? { trial_end: stripeSub.trial_end } : {}),
        proration_behavior: "none"
      },
      {
        items: [{ price: targetPriceId, quantity: 1 }],
        duration: { interval: subscription.billingPeriod === "ANNUAL" ? "year" : "month", interval_count: 1 },
        proration_behavior: "none"
      }
    ]
  });
  const updated = await prisma.restaurantSubscription.update({
    where: { id: subscription.id },
    data: { pendingPlanId: target.id, pendingChangeAt: new Date(periodEnd * 1000), stripeScheduleId: scheduleId },
    include: { plan: true }
  });
  return { direction, subscription: updated };
};

// Annule un passage à une formule inférieure encore programmé : la formule actuelle continue.
export const cancelPendingPlanChange = async (subscription: RestaurantSubscription) => {
  if (!subscription.pendingPlanId) throw httpError(409, "Aucun changement de formule n’est programmé.");
  await releaseSchedule(subscription.stripeScheduleId);
  return prisma.restaurantSubscription.update({ where: { id: subscription.id }, data: { pendingPlanId: null, pendingChangeAt: null, stripeScheduleId: null }, include: { plan: true } });
};

// C06/C07 : enregistre l'abonnement créé par une session Checkout terminée (webhook
// checkout.session.completed, ou resynchronisation si le webhook n'est pas encore arrivé). Idempotent :
// rejouer la même session ne crée jamais un second abonnement ni une seconde notification.
export const recordCheckoutSession = async (session: Stripe.Checkout.Session) => {
  const restaurantId = session.metadata?.restaurantId;
  const planId = session.metadata?.planId;
  const billingPeriod = session.metadata?.billingPeriod ?? "MONTHLY";
  if (!stripe || !restaurantId || !planId || !session.subscription || !session.customer) return null;
  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const previous = await prisma.restaurantSubscription.findUnique({ where: { restaurantId } });
  const alreadyRecorded = previous?.stripeSubscriptionId === stripeSubscriptionId;
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const item = stripeSub.items.data[0];
  const data = {
    planId, billingPeriod, status: mapStripeSubscriptionStatus(stripeSub.status), stripeCustomerId: customerId, stripeSubscriptionId,
    currentPeriodStart: new Date(item.current_period_start * 1000), currentPeriodEnd: new Date(item.current_period_end * 1000),
    cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false, cancelledAt: null, pendingPlanId: null, pendingChangeAt: null, stripeScheduleId: null
  };
  const updated = await prisma.restaurantSubscription.upsert({ where: { restaurantId }, update: data, create: { restaurantId, ...data }, include: { plan: true } });
  if (!alreadyRecorded) {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const trial = updated.status === SubscriptionStatus.TRIALING ? ", essai gratuit de 7 jours en cours" : "";
    await notify(restaurant.ownerId, "Abonnement activé", `Votre abonnement « ${updated.plan.name} » (${billingPeriod === "ANNUAL" ? "annuel" : "mensuel"}) est confirmé${trial}.`, "/restaurant?tab=subscription");
    await audit(restaurant.ownerId, "SUBSCRIPTION_CHECKOUT_COMPLETED", "RestaurantSubscription", updated.id, { planId, billingPeriod });
  }
  return updated;
};
