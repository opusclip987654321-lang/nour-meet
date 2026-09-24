import { EVENT_ZONES, regionOfZone } from "@nour/shared";
import { AlternativeOfferStatus, ApplicationStatus, EventStatus, Prisma, QuotaCategory } from "@prisma/client";
import { prisma } from "../context.js";
import { paymentDeadline } from "../domain.js";
import { getSetting } from "../settings.js";
import { profileAge } from "./account.js";
import { links } from "./links.js";
import { notify } from "./notify.js";

type ClaimableApplication = { id: string; userId: string; quotaCategory: QuotaCategory | null };
type ClaimResult = { ok: true; reservation: Awaited<ReturnType<typeof prisma.reservation.upsert>> } | { ok: false; reason: "NO_CATEGORY" | "FULL" | "OVERLAP" };

// Attribue une place de manière atomique (créneau à quota ou capacité globale) et pose une réservation
// dont la durée de vie est TOUJOURS fournie par l'appelant : un verrou court (§5) pendant une tentative
// de paiement directe, une fenêtre plus longue (mais toujours sans risque de survente, la place étant
// déjà décomptée de façon atomique) pour une offre exclusive de liste d'attente. Pour les événements à
// quotas, l'atomicité vient de l'UPDATE conditionné sur heldCount < capacity (comme pour les créneaux
// d'entretien). Pour la capacité globale (sans quota), on utilise une transaction PostgreSQL sérialisable
// pour empêcher toute survente en cas de réservations simultanées.
export const claimReservation = async (eventId: string, application: ClaimableApplication, expiresAt: Date): Promise<ClaimResult> => {
  const hasQuotas = (await prisma.eventQuota.count({ where: { eventId } })) > 0;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const run = async (tx: Prisma.TransactionClient): Promise<ClaimResult> => {
    // Chevauchement horaire (§11) : centralisé ici, car les trois chemins qui attribuent réellement
    // une place (paiement direct, offre de liste d'attente, événement alternatif accepté) passent
    // tous par cette fonction — jamais deux réservations actives sur des événements qui se chevauchent.
    const overlapping = await tx.reservation.findFirst({ where: { userId: application.userId, cancelledAt: null, applicationId: { not: application.id }, event: { startsAt: { lt: event.endsAt }, endsAt: { gt: event.startsAt } } } });
    if (overlapping) return { ok: false, reason: "OVERLAP" };
    if (hasQuotas) {
      if (!application.quotaCategory) return { ok: false, reason: "NO_CATEGORY" };
      const quota = await tx.eventQuota.findUnique({ where: { eventId_category: { eventId, category: application.quotaCategory } } });
      if (!quota) return { ok: false, reason: "NO_CATEGORY" };
      const updated = await tx.eventQuota.updateMany({ where: { id: quota.id, heldCount: { lt: quota.capacity } }, data: { heldCount: { increment: 1 } } });
      if (updated.count !== 1) return { ok: false, reason: "FULL" };
    } else {
      const occupied = await tx.reservation.count({ where: { eventId, cancelledAt: null, applicationId: { not: application.id } } });
      if (occupied >= event.capacity) return { ok: false, reason: "FULL" };
    }
    const reservation = await tx.reservation.upsert({
      where: { applicationId: application.id },
      update: { expiresAt, cancelledAt: null, quotaCategory: application.quotaCategory },
      create: { eventId, userId: application.userId, applicationId: application.id, expiresAt, quotaCategory: application.quotaCategory }
    });
    await tx.application.update({ where: { id: application.id }, data: { status: ApplicationStatus.PAYMENT_PENDING } });
    return { ok: true, reservation };
  };
  try {
    return await prisma.$transaction(run, hasQuotas ? undefined : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if ((err as { code?: string }).code === "P2034") return { ok: false, reason: "FULL" };
    throw err;
  }
};

// Libère la place tenue par une réservation (quota ou capacité globale), annule la candidature associée
// si elle était en attente de paiement, et retire l'entrée de liste d'attente correspondante le cas échéant.
export const releaseReservationSlot = async (tx: Prisma.TransactionClient, reservation: { id: string; eventId: string; applicationId: string; quotaCategory: QuotaCategory | null }) => {
  await tx.reservation.update({ where: { id: reservation.id }, data: { cancelledAt: new Date() } });
  await tx.application.updateMany({ where: { id: reservation.applicationId, status: ApplicationStatus.PAYMENT_PENDING }, data: { status: ApplicationStatus.CANCELLED } });
  await tx.waitlistEntry.deleteMany({ where: { applicationId: reservation.applicationId } });
  if (reservation.quotaCategory) {
    await tx.eventQuota.updateMany({ where: { eventId: reservation.eventId, category: reservation.quotaCategory, heldCount: { gt: 0 } }, data: { heldCount: { decrement: 1 } } });
  }
};

// Arbitrage final 07 (2026-09-20) : PLUS d'offre exclusive à une seule personne pendant 24h. Dès
// qu'une place se libère, TOUS les inscrits éligibles de la liste d'attente sont notifiés
// simultanément ; aucune réservation n'est pré-attribuée ici. Le premier qui ouvre réellement le
// paiement (POST /applications/:id/payment-intent, plus bas) obtient le verrou atomique via
// claimReservation — exactement le même mécanisme qui protège déjà une inscription directe contre
// la survente, jamais une exclusivité posée à l'avance. La catégorie ne partitionne la liste
// d'attente que si l'événement a de vrais quotas.
export const offerNextWaitlistEntry = async (eventId: string, category: QuotaCategory | null) => {
  const hasQuotas = (await prisma.eventQuota.count({ where: { eventId } })) > 0;
  const candidates = await prisma.waitlistEntry.findMany({ where: { eventId, offeredAt: null, ...(hasQuotas ? { quotaCategory: category } : {}) }, orderBy: { createdAt: "asc" }, include: { application: true } });
  if (candidates.length === 0) return;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  await prisma.waitlistEntry.updateMany({ where: { id: { in: candidates.map(c => c.id) } }, data: { offeredAt: new Date() } });
  await Promise.all(candidates.map(entry => notify(entry.userId, "Une place s’est libérée !", `Une place pour « ${event.title} » est disponible. Réglez votre billet dès maintenant : elle revient au premier qui finalise son paiement.`, links.event(event.slug))));
};

// Une place existe réellement pour cette catégorie (ou en capacité globale si l'événement n'a pas
// de quotas) : condition nécessaire avant de proposer un événement alternatif, pour que la personne
// ne se retrouve pas de nouveau sur liste d'attente en l'acceptant.
const hasAvailableSpace = async (event: { id: string; capacity: number }, quotaCategory: QuotaCategory | null) => {
  const quotas = await prisma.eventQuota.findMany({ where: { eventId: event.id } });
  if (quotas.length > 0) {
    if (!quotaCategory) return false;
    const tier = quotas.find(q => q.category === quotaCategory);
    return !!tier && tier.heldCount < tier.capacity;
  }
  const occupied = await prisma.reservation.count({ where: { eventId: event.id, cancelledAt: null } });
  return occupied < event.capacity;
};
// Propose automatiquement jusqu'à 3 événements alternatifs lorsqu'un participant ne peut pas obtenir
// de place, selon : même thème (catégorie), même région géographique (ex. Île-de-France — pas la zone
// précise, pour élargir les possibilités), une tranche d'âge compatible si l'événement en définit une,
// et une place réellement disponible pour sa catégorie (sinon il se retrouverait aussitôt de nouveau
// sur liste d'attente). §4 : contrairement à la version précédente, l'alternative n'est plus restreinte
// au même restaurateur — tous les événements Nour compatibles sont candidats. Une offre déjà refusée
// par ce participant pour cet événement d'origine n'est jamais reproposée. Ne crée jamais de nouvelles
// propositions tant que des propositions PENDING existent déjà pour cet événement d'origine (elles sont
// alors simplement retournées telles quelles). Entièrement automatique : aucune proposition manuelle.
export const createAlternativeOfferIfPossible = async (userId: string, originalEvent: { id: string; category: string; zone: string | null }) => {
  if (!originalEvent.zone) return [];
  const existingPending = await prisma.alternativeOffer.findMany({ where: { userId, originalEventId: originalEvent.id, status: AlternativeOfferStatus.PENDING }, include: { alternativeEvent: true } });
  if (existingPending.length > 0) return existingPending;
  const region = regionOfZone(originalEvent.zone);
  const zonesInRegion = EVENT_ZONES.filter(z => regionOfZone(z) === region);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  const age = profileAge(profile?.birthDate);
  const candidates = await prisma.event.findMany({
    where: {
      id: { not: originalEvent.id }, category: originalEvent.category, zone: { in: zonesInRegion },
      // Jamais un événement de démonstration (§8) : proposé en alternative, il ne serait pas réservable.
      status: EventStatus.PUBLISHED, isDemo: false, startsAt: { gt: new Date() }, applications: { none: { userId } },
      alternativeOffers: { none: { userId, originalEventId: originalEvent.id, status: AlternativeOfferStatus.DECLINED } }
    },
    orderBy: { startsAt: "asc" },
    take: 20
  });
  const offers: Prisma.AlternativeOfferGetPayload<{ include: { alternativeEvent: true } }>[] = [];
  for (const candidate of candidates) {
    if (offers.length >= 3) break;
    if (age != null && candidate.minAge != null && age < candidate.minAge) continue;
    if (age != null && candidate.maxAge != null && age > candidate.maxAge) continue;
    if (!(await hasAvailableSpace(candidate, profile?.quotaCategory ?? null))) continue;
    const offer = await prisma.alternativeOffer.create({
      data: { userId, originalEventId: originalEvent.id, alternativeEventId: candidate.id, respondsBy: paymentDeadline(new Date(), getSetting("ALTERNATIVE_OFFER_RESPONSE_HOURS")) },
      include: { alternativeEvent: true }
    });
    offers.push(offer);
  }
  if (offers.length === 0) return [];
  const originalApplication = await prisma.application.findUnique({ where: { eventId_userId: { eventId: originalEvent.id, userId } }, select: { id: true } });
  await notify(userId, offers.length > 1 ? "Des événements similaires pourraient vous intéresser" : "Un événement similaire pourrait vous intéresser", offers.map(o => `« ${o.alternativeEvent.title} » (${o.alternativeEvent.district}, ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(o.alternativeEvent.startsAt)})`).join(" · "), originalApplication ? links.reservation(originalApplication.id) : "/dashboard?tab=reservations");
  return offers;
};
