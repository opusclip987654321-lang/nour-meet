import { PaymentStatus, SubscriptionStatus, UserRole } from "@prisma/client";
import Stripe from "stripe";
import { app, prisma, stripe } from "../context.js";
import { notify } from "./notify.js";

// Exécute un remboursement réel (Stripe en mode test) de façon idempotente et journalisée, partagé
// entre l'annulation automatique (§7, plus de 24h avant l'événement) et l'exception admin motivée
// (24h ou moins). Ne marque JAMAIS REFUNDED si l'appel Stripe échoue : le paiement reste SUCCEEDED
// et les administrateurs sont notifiés pour un traitement manuel plutôt que de mentir sur l'état.
export const mapStripeSubscriptionStatus = (status: Stripe.Subscription.Status): SubscriptionStatus => {
  switch (status) {
    case "trialing": return SubscriptionStatus.TRIALING;
    case "active": return SubscriptionStatus.ACTIVE;
    case "past_due": case "unpaid": return SubscriptionStatus.PAST_DUE;
    case "canceled": return SubscriptionStatus.CANCELLED;
    default: return SubscriptionStatus.INCOMPLETE;
  }
};
export const executeRefund = async (
  payment: { id: string; status: PaymentStatus; providerRef: string | null; amountCents: number; ledgerEntry: { id: string; grossAmountCents: number; paidOutAt: Date | null } | null },
  event: { title: string },
  opts: { exceptionReason?: string } = {}
): Promise<boolean> => {
  if (payment.status !== PaymentStatus.SUCCEEDED) return false;
  if (stripe && payment.providerRef) {
    try {
      await stripe.refunds.create({ payment_intent: payment.providerRef });
    } catch (err) {
      app.log.error({ err }, "Échec de l’appel de remboursement Stripe");
      const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
      await Promise.all(admins.map(a => notify(a.id, "Échec d’un remboursement Stripe", `Le remboursement pour « ${event.title} » a échoué côté prestataire : à traiter manuellement.`, "/admin/finance")));
      return false;
    }
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED, refundedAt: new Date(), refundedAmountCents: payment.amountCents, refundExceptionReason: opts.exceptionReason ?? null } });
  if (payment.ledgerEntry) {
    await prisma.ledgerEntry.update({ where: { id: payment.ledgerEntry.id }, data: { refundedAmountCents: payment.ledgerEntry.grossAmountCents } });
    if (payment.ledgerEntry.paidOutAt) {
      const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
      await Promise.all(admins.map(a => notify(a.id, "Remboursement après reversement déjà marqué", `Le paiement remboursé pour « ${event.title} » avait déjà été marqué comme reversé au restaurant : à régulariser manuellement.`, "/admin/finance")));
    }
  }
  return true;
};
