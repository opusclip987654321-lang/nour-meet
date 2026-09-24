import { PaymentStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { app, prisma, stripe } from "../context.js";
import { refundEligibility } from "../domain.js";
import { audit } from "../services/audit.js";
import { currentId, roles } from "../services/auth.js";
import { links } from "../services/links.js";
import { notify } from "../services/notify.js";
import { executeRefund } from "../services/payments.js";
import { getSetting } from "../settings.js";

// Exception admin motivée (§7) : en dehors du délai de 24h, un motif est obligatoire — sinon le
// remboursement relève du calcul automatique déjà exécuté à l'annulation, pas de cette route.
app.post("/admin/payments/:id/refund", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { reason } = z.object({ reason: z.string().min(3).max(1000).optional() }).parse(request.body ?? {});
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { reservation: { include: { user: true, event: true } }, ledgerEntry: true } });
  if (payment.status !== PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Seul un paiement réussi peut être remboursé" });
  if (!payment.providerRef) return reply.code(409).send({ error: "Aucune référence de paiement Stripe associée" });
  const { eligible } = refundEligibility(payment.reservation.event.startsAt);
  if (!eligible && !reason) return reply.code(400).send({ error: "Motif obligatoire : cette annulation est à 24 heures ou moins de l’événement, il s’agit d’une exception à la politique de remboursement." });
  const ok = await executeRefund(payment, payment.reservation.event, { exceptionReason: eligible ? undefined : reason });
  if (!ok) return reply.code(502).send({ error: "Le remboursement a échoué côté prestataire ; les administrateurs ont été notifiés." });
  const alreadyPaidOutWarning = !!payment.ledgerEntry?.paidOutAt;
  await notify(payment.reservation.userId, "Remboursement effectué", `Votre paiement pour « ${payment.reservation.event.title} » a été remboursé.`, links.reservation(payment.reservation.applicationId));
  await audit(currentId(request), "REFUND_PAYMENT", "Payment", id, { alreadyPaidOutWarning, exception: !eligible, reason });
  return { refunded: true, alreadyPaidOutWarning, exception: !eligible };
});
// Corrections web 2026-09-24 (§6.1) : un restaurateur ne demande ni ne déclenche jamais lui-même un
// remboursement — l'ancienne route de « demande de remboursement » ouverte aux restaurateurs est
// supprimée. Seuls le super-admin (route ci-dessus) et les règles automatiques de Nūr Meet
// (annulation plus de 24h avant, annulation d'événement) remboursent.
// Grand livre 30/70 et synthèse financière : informations internes de Nūr Meet (montant dû, reversements,
// commissions, solde Stripe), réservées au super-admin (corrections web 2026-09-24, §6.2). Le
// restaurateur retrouve ses propres ventes dans son tableau de bord (GET /admin/dashboard).
// "Prêt à reverser" n'est qu'une indication (7 jours après la fin de l'événement, pour laisser le
// temps à une éventuelle contestation) — jamais un blocage : "Marquer comme reversé" reste possible
// à tout moment, à la seule discrétion du super-admin.
const PAYOUT_COOLDOWN_MS = 7 * 24 * 60 * 60_000;
app.get("/admin/finance/ledger", { preHandler: roles(UserRole.ADMIN) }, async () => {
  const entries = await prisma.ledgerEntry.findMany({
    include: { event: true, restaurant: true, payment: { include: { reservation: { include: { user: true } } } } },
    orderBy: { createdAt: "desc" }
  });
  const now = new Date();
  return entries.map(e => ({ ...e, readyToPayOut: !e.paidOutAt && now.getTime() - e.event.endsAt.getTime() >= PAYOUT_COOLDOWN_MS }));
});
// Sépare strictement (§9/§14) : volume brut et montant dû au restaurateur (LedgerEntry, restant
// pertinent pour les anciennes ventes sous commission), chiffre d'affaires PROPRE de Nour (ses
// événements en direct, controllerRestaurantId null) et abonnements restaurateur (revenu récurrent
// distinct, jamais mélangé avec le volume de billets vendu pour compte de tiers).
app.get("/admin/finance/summary", { preHandler: roles(UserRole.ADMIN) }, async () => {
  const where = {};
  // grossTicketVolumeCents vient directement de Payment, indépendamment de LedgerEntry : depuis le
  // passage à l'abonnement (§8.2, Lot 2), ENABLE_COMMISSION_LEDGER est désactivé par défaut et plus
  // aucune LedgerEntry n'est créée pour les nouvelles ventes restaurateur. gross/commission/due/
  // paidOut ci-dessous restent donc corrects pour l'historique sous l'ancien modèle 30/70, mais
  // resteraient figés à zéro pour toute vente récente si on s'y fiait seul — d'où ce calcul séparé,
  // toujours à jour, qui ne mélange jamais le CA propre de Nour avec l'argent encaissé pour un tiers.
  const [gross, commission, due, paidOut, refunded, grossTicketVolume, fees] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where, _sum: { grossAmountCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { commissionAmountCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { restaurantDueCents: true } }),
    prisma.ledgerEntry.aggregate({ where: { paidOutAt: { not: null } }, _sum: { restaurantDueCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { refundedAmountCents: true } }),
    prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCEEDED, reservation: { event: { controllerRestaurantId: { not: null } } } },
      _sum: { amountCents: true }
    }),
    // H2/§14 (cahier des charges consolidé 2026-09-20) : frais Stripe déjà connus (voir la
    // synchronisation en tâche de fond ci-dessous, LedgerEntry.stripeFeeCents), jamais mélangés au
    // chiffre d'affaires brut ni à la commission.
    prisma.ledgerEntry.aggregate({ where, _sum: { stripeFeeCents: true } })
  ]);
  const summary = {
    grossCents: gross._sum.grossAmountCents ?? 0,
    commissionCents: commission._sum.commissionAmountCents ?? 0,
    restaurantDueCents: due._sum.restaurantDueCents ?? 0,
    paidOutCents: paidOut._sum.restaurantDueCents ?? 0,
    refundedCents: refunded._sum.refundedAmountCents ?? 0,
    grossTicketVolumeCents: grossTicketVolume._sum.amountCents ?? 0,
    feesCents: fees._sum.stripeFeeCents ?? 0,
    commissionLedgerEnabled: getSetting("ENABLE_COMMISSION_LEDGER")
  };
  // Le reste n'a de sens qu'à l'échelle de la plateforme, jamais restreint à un seul restaurateur.
  // Le revenu récurrent d'abonnement ne compte que les abonnements ACTIVE (jamais TRIALING, qui
  // n'ont encore rien payé) : chez Stripe, ACTIVE signifie précisément que la dernière facture de
  // la période en cours a été réglée — ce chiffre reflète donc déjà un revenu réellement encaissé,
  // jamais une simple projection sur des abonnements non facturés.
  const [nourOwnRevenue, activeSubscriptions, balance, disputes] = await Promise.all([
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, reservation: { event: { controllerRestaurantId: null } } }, _sum: { amountCents: true } }),
    prisma.restaurantSubscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
    stripe ? stripe.balance.retrieve().catch(() => null) : Promise.resolve(null),
    stripe ? stripe.disputes.list({ limit: 100 }).catch(() => null) : Promise.resolve(null)
  ]);
  const openDisputes = disputes?.data.filter(d => !["won", "lost"].includes(d.status)) ?? [];
  return {
    ...summary,
    nourOwnRevenueCents: nourOwnRevenue._sum.amountCents ?? 0,
    subscriptionMonthlyRevenueCents: activeSubscriptions.reduce((sum, s) => sum + s.plan.monthlyPriceCents, 0),
    activeSubscriptionsCount: activeSubscriptions.length,
    // Solde Stripe TEST en temps réel (disponible/en attente) : purement informatif pour la
    // réconciliation, jamais utilisé pour déclencher un virement automatique.
    stripeBalance: balance ? {
      availableCents: balance.available.filter(b => b.currency === "eur").reduce((s, b) => s + b.amount, 0),
      pendingCents: balance.pending.filter(b => b.currency === "eur").reduce((s, b) => s + b.amount, 0)
    } : null,
    disputesCount: openDisputes.length,
    disputesAmountCents: openDisputes.reduce((s, d) => s + d.amount, 0)
  };
});
app.post("/admin/finance/ledger/:id/mark-paid", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { note } = z.object({ note: z.string().max(500).optional() }).parse(request.body);
  const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
  if (entry.paidOutAt) return reply.code(409).send({ error: "Déjà marqué comme reversé" });
  const updated = await prisma.ledgerEntry.update({ where: { id }, data: { paidOutAt: new Date(), paidOutBy: currentId(request), payoutNote: note } });
  await audit(currentId(request), "MARK_LEDGER_PAID_OUT", "LedgerEntry", id, { note });
  return updated;
});
app.post("/admin/restaurants/:id/commission-rate", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { commissionRate } = z.object({ commissionRate: z.number().int().min(0).max(100) }).parse(request.body);
  const updated = await prisma.restaurant.update({ where: { id }, data: { commissionRate } });
  await audit(currentId(request), "SET_COMMISSION_RATE", "Restaurant", id, { commissionRate });
  return updated;
});
