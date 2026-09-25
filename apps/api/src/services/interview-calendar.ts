import {
  INTERVIEW_HORIZON_DAYS, INTERVIEW_MIN_NOTICE_MINUTES, addDays, defaultInterviewSlots, isDefaultInterviewSlotStart, parisDayKey
} from "@nour/shared";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { httpError, prisma } from "../context.js";

// Calendrier des entretiens (décision v2 §11) : disponibilité par défaut (10h–22h, 15 min, heure de
// Paris) moins les plages bloquées par l'équipe, moins les rendez-vous déjà réservés. Rien n'est stocké
// d'avance : un rendez-vous ne crée sa ligne ScreeningCall qu'au moment de la réservation.

type Tx = Prisma.TransactionClient;

// Un rendez-vous occupe son horaire tant que sa démarche n'est pas annulée. Les lignes sans démarche
// (anciens créneaux créés à la main, créneaux libérés) n'occupent rien.
const busyCallWhere = (from: Date, to: Date): Prisma.ScreeningCallWhereInput => ({
  eventId: null,
  applicationId: { not: null },
  application: { status: { not: ApplicationStatus.CANCELLED } },
  startsAt: { lt: to },
  endsAt: { gt: from }
});

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
const earliestBookable = () => new Date(Date.now() + INTERVIEW_MIN_NOTICE_MINUTES * 60_000);
const latestDay = () => addDays(parisDayKey(new Date()), INTERVIEW_HORIZON_DAYS);

/** Créneaux réservables sur `days` jours à partir du jour `from` (AAAA-MM-JJ, heure de Paris). */
export async function availableInterviewSlots(from: string, days: number) {
  const today = parisDayKey(new Date());
  const first = from < today ? today : from;
  const dayKeys = Array.from({ length: days }, (_, i) => addDays(first, i)).filter(d => d <= latestDay());
  if (dayKeys.length === 0) return [];
  const candidates = dayKeys.flatMap(defaultInterviewSlots);
  const windowStart = candidates[0].startsAt, windowEnd = candidates[candidates.length - 1].endsAt;
  const [blocks, busy] = await Promise.all([
    prisma.interviewBlock.findMany({ where: { startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } }, select: { startsAt: true, endsAt: true } }),
    prisma.screeningCall.findMany({ where: busyCallWhere(windowStart, windowEnd), select: { startsAt: true, endsAt: true } })
  ]);
  const notBefore = earliestBookable();
  return candidates
    .filter(slot => slot.startsAt >= notBefore && !blocks.some(b => overlaps(slot, b)) && !busy.some(c => overlaps(slot, c)))
    .map(slot => ({ id: slot.startsAt.toISOString(), startsAt: slot.startsAt, endsAt: slot.endsAt }));
}

/**
 * Réserve l'horaire `startsAt` pour la démarche `applicationId`, dans la transaction `tx`.
 * Un verrou consultatif PostgreSQL sérialise les réservations : deux personnes qui visent le même
 * horaire au même instant ne peuvent pas l'obtenir toutes les deux (la seconde reçoit un 409).
 * `releaseCallId` : rendez-vous à libérer dans la même transaction (déplacement atomique) — il n'est
 * libéré que si le nouveau horaire est effectivement obtenu, sinon tout est annulé.
 */
export async function bookInterviewSlot(tx: Tx, applicationId: string, startsAt: Date, releaseCallId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4211)`;
  if (!isDefaultInterviewSlotStart(startsAt)) throw httpError(400, "Cet horaire ne correspond à aucun créneau d’entretien.");
  if (startsAt < earliestBookable()) throw httpError(409, "Ce créneau est trop proche ou déjà passé. Choisissez-en un autre.");
  if (parisDayKey(startsAt) > latestDay()) throw httpError(400, "Ce créneau est trop éloigné dans le temps.");
  const slot = defaultInterviewSlots(parisDayKey(startsAt)).find(s => s.startsAt.getTime() === startsAt.getTime())!;
  const blocked = await tx.interviewBlock.findFirst({ where: { startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } }, select: { id: true } });
  if (blocked) throw httpError(409, "Ce créneau n’est plus disponible. Choisissez-en un autre.");
  // Déplacement : le rendez-vous d'origine doit toujours appartenir à cette démarche une fois le verrou
  // obtenu (deux déplacements simultanés : le second reçoit un 409, jamais une erreur serveur).
  if (releaseCallId && !(await tx.screeningCall.findFirst({ where: { id: releaseCallId, applicationId }, select: { id: true } }))) throw httpError(409, "Votre entretien vient d’être modifié. Rechargez la page.");
  const taken = await tx.screeningCall.findFirst({ where: { ...busyCallWhere(slot.startsAt, slot.endsAt), ...(releaseCallId ? { id: { not: releaseCallId } } : {}) }, select: { id: true } });
  if (taken) throw httpError(409, "Ce créneau vient d’être réservé par un autre participant. Choisissez-en un autre.");
  // ScreeningCall.applicationId est unique : l'ancien rendez-vous est détaché avant d'attacher le nouveau.
  if (releaseCallId) await tx.screeningCall.update({ where: { id: releaseCallId }, data: { applicationId: null } });
  return tx.screeningCall.create({ data: { applicationId, startsAt: slot.startsAt, endsAt: slot.endsAt } });
}

/** Rendez-vous réservés qui chevauchent une période (pour prévenir l'équipe avant de la bloquer). */
export function bookedCallsBetween(from: Date, to: Date) {
  return prisma.screeningCall.findMany({ where: busyCallWhere(from, to), include: { application: { select: { id: true, user: { select: { displayName: true } } } } }, orderBy: { startsAt: "asc" } });
}
