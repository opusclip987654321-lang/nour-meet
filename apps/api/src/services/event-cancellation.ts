import { ApplicationStatus, EventStatus, PaymentStatus, Prisma, TicketStatus } from "@prisma/client";
import { httpError, prisma } from "../context.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";
import { executeRefund } from "./payments.js";
import { createAlternativeOfferIfPossible } from "./reservations.js";

// Annulation d'un événement (§7 organisateur, §10 minimum non atteint) : remboursement intégral
// automatique de tous les billets concernés, jamais "à traiter manuellement" — l'événement
// n'existant plus, les quotas tenus sont aussi réinitialisés pour ne pas laisser de données de
// capacité incohérentes. Partagée entre l'annulation manuelle et la décision minimum non atteint.
export const cancelEventWithRefunds = async (event: { id: string; title: string; status: EventStatus; category: string; zone: string | null }, actorId: string | undefined, action: string) => {
  if (event.status === EventStatus.CANCELLED) throw httpError(409, "Cet événement est déjà annulé");
  const reservations = await prisma.reservation.findMany({ where: { eventId: event.id, cancelledAt: null }, include: { payment: { include: { ledgerEntry: true } }, user: true } });
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { status: EventStatus.CANCELLED } });
    await tx.application.updateMany({ where: { eventId: event.id, status: { notIn: [ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } }, data: { status: ApplicationStatus.CANCELLED } });
    await tx.reservation.updateMany({ where: { eventId: event.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
    await tx.ticket.updateMany({ where: { reservation: { eventId: event.id }, status: { not: TicketStatus.CANCELLED } }, data: { status: TicketStatus.CANCELLED } });
    await tx.waitlistEntry.deleteMany({ where: { eventId: event.id } });
    await tx.eventQuota.updateMany({ where: { eventId: event.id }, data: { heldCount: 0 } });
  });
  const paid = reservations.filter(r => r.payment?.status === PaymentStatus.SUCCEEDED);
  const refundedIds = new Set<string>();
  for (const r of paid) {
    if (await executeRefund(r.payment!, event, {})) refundedIds.add(r.id);
  }
  // §4 : le remboursement reste automatique et inconditionnel (aucune conséquence financière laissée
  // en suspens), mais chaque personne concernée reçoit aussi jusqu'à 3 alternatives à réserver si elle
  // le souhaite — un vrai transfert du paiement existant vers un autre événement (sans repasser par un
  // nouveau paiement) demanderait de fixer des règles de gestion de l'écart de prix qui ne sont pas
  // définies dans le cahier des charges ; non construit pour éviter d'inventer cette politique.
  const offersByUser = new Map<string, Prisma.AlternativeOfferGetPayload<{ include: { alternativeEvent: true } }>[]>();
  for (const r of reservations) {
    offersByUser.set(r.userId, await createAlternativeOfferIfPossible(r.userId, event));
  }
  await Promise.all(reservations.map(r => {
    const offers = offersByUser.get(r.userId) ?? [];
    const refundNote = refundedIds.has(r.id) ? ` Vous avez été intégralement remboursé(e) (${(r.payment!.amountCents / 100).toFixed(2)} €).` : "";
    const altNote = offers.length > 0 ? ` ${offers.length > 1 ? "Des événements alternatifs" : "Un événement alternatif"} vous ${offers.length > 1 ? "sont" : "est"} proposé${offers.length > 1 ? "s" : ""} dans votre espace.` : "";
    return notify(r.userId, "Événement annulé", `« ${event.title} » a été annulé.${refundNote}${altNote}`, "/dashboard?tab=reservations");
  }));
  await audit(actorId, action, "Event", event.id, { affectedReservations: reservations.length, refunded: refundedIds.size, refundFailed: paid.length - refundedIds.size });
  return { cancelled: true, refundedCount: refundedIds.size, refundFailedCount: paid.length - refundedIds.size };
};
