import { INTERVIEW_HORIZON_DAYS, addDays, parisDateTime, parisTime, weekdayOf } from "@nour/shared";
import { ApplicationStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { app, httpError, prisma } from "../context.js";
import { interviewRetryDate } from "../domain.js";
import { audit } from "../services/audit.js";
import { currentId, roles } from "../services/auth.js";
import { bookInterviewSlot, bookedCallsBetween } from "../services/interview-calendar.js";
import { links } from "../services/links.js";
import { notify } from "../services/notify.js";

// Entretiens globaux : uniquement le super-admin, jamais un restaurateur (voir cahier des charges §6).
app.get("/admin/global-interviews", { preHandler: roles(UserRole.ADMIN) }, async () =>
  prisma.application.findMany({ where: { eventId: null }, include: { user: { include: { profile: true } }, call: true }, orderBy: { createdAt: "desc" } })
);
app.post("/admin/global-interviews/:id/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, notes } = z.object({ accept: z.boolean(), notes: z.string().max(1000).optional() }).parse(request.body);
  const application = await prisma.application.findUniqueOrThrow({ where: { id } });
  if (application.eventId) throw httpError(409, "Cette démarche concerne un événement précis, pas l’entretien global");
  if (application.status === ApplicationStatus.ACCEPTED || application.status === ApplicationStatus.REFUSED) return reply.code(409).send({ error: "Cet entretien a déjà été décidé" });
  const adminId = currentId(request);
  if (!accept) {
    const refused = await prisma.application.update({ where: { id }, data: { status: ApplicationStatus.REFUSED, notes, decidedAt: new Date() } });
    // §4.1 : un refus reste neutre et sans motif pour le participant, quoi que l'admin ait consigné
    // dans `notes` (visible uniquement en interne, jamais renvoyé dans la notification).
    await notify(application.userId, "Profil non validé", `Votre profil n’a pas été validé pour le moment. Vous pourrez redemander un entretien à partir du ${interviewRetryDate(refused.decidedAt!).toLocaleDateString("fr-FR")}.`, links.interview());
    await audit(adminId, "REFUSE_GLOBAL_INTERVIEW", "Application", id, { notes });
    return refused;
  }
  const [, updatedApplication] = await prisma.$transaction([
    prisma.profile.update({ where: { userId: application.userId }, data: { validatedAt: new Date() } }),
    prisma.application.update({ where: { id }, data: { status: ApplicationStatus.ACCEPTED, notes, decidedAt: new Date() } })
  ]);
  await notify(application.userId, "Profil validé", "Votre profil est validé : vous pouvez désormais vous inscrire directement aux événements, sans nouvel entretien.", links.interview());
  await audit(adminId, "VALIDATE_PROFILE", "Application", id);
  return updatedApplication;
});
// §2 : retrait du badge Vérifié par un administrateur (aucun endpoint n'existait avant ce point —
// jusqu'ici validatedAt ne pouvait être posé que par un entretien, jamais retiré).
app.post("/admin/profiles/:userId/revoke-validation", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { userId } = z.object({ userId: z.string() }).parse(request.params);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.validatedAt) return reply.code(409).send({ error: "Ce profil n’est pas validé" });
  await prisma.profile.update({ where: { userId }, data: { validatedAt: null } });
  await notify(userId, "Validation de profil retirée", "Votre profil n’est plus marqué comme vérifié. Vous pouvez redemander un entretien de validation.", links.interview());
  await audit(currentId(request), "REVOKE_PROFILE_VALIDATION", "Profile", userId);
  return { ok: true };
});
// §13/§14 : reprogrammer l'entretien d'un candidat (action rapide admin), jamais laissée à la charge
// du participant qui devrait sinon annuler puis reprendre un nouveau créneau. L'ancien créneau est
// libéré (redevient disponible pour quelqu'un d'autre) dans la même transaction que la prise du
// nouveau, pour ne jamais perdre le créneau d'origine si le nouveau est déjà pris entre-temps.
app.post("/admin/global-interviews/:id/reschedule", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { startsAt } = z.object({ startsAt: z.string().datetime() }).parse(request.body);
  const application = await prisma.application.findFirstOrThrow({ where: { id, eventId: null }, include: { call: true } });
  if (!application.call) return reply.code(409).send({ error: "Aucun entretien programmé pour cette candidature" });
  const slot = await prisma.$transaction(tx => bookInterviewSlot(tx, application.id, new Date(startsAt), application.call!.id));
  await notify(application.userId, "Entretien reprogrammé", `Votre appel est désormais prévu le ${parisDateTime(slot.startsAt)}.`, links.interview());
  await audit(currentId(request), "RESCHEDULE_GLOBAL_INTERVIEW", "Application", id, { startsAt: slot.startsAt });
  return { rescheduled: true, slot };
});

// Agenda central des entretiens (v2 §11) : ouvert par défaut de 10h à 22h, l'équipe ne crée plus de
// créneaux — elle ferme des périodes. Réservé au super-admin, jamais aux restaurateurs.
app.get("/admin/interview-slots", { preHandler: roles(UserRole.ADMIN) }, async () =>
  prisma.screeningCall.findMany({ where: { eventId: null, applicationId: { not: null }, application: { status: { not: ApplicationStatus.CANCELLED } }, startsAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, include: { application: { include: { user: true } } }, orderBy: { startsAt: "asc" } })
);

app.get("/admin/interview-blocks", { preHandler: roles(UserRole.ADMIN) }, async () =>
  prisma.interviewBlock.findMany({ where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 500 })
);

// Fermer une période : un jour, plusieurs jours, des heures précises, ou seulement certains jours de la
// semaine d'une période (ex. tous les dimanches d'octobre). Les dates et heures sont celles de Paris.
// Une plage continue = une seule ligne ; seuls les jours de semaine choisis donnent une ligne par jour.
const blockInput = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  reason: z.string().trim().max(200).optional()
}).refine(v => v.endDate >= v.startDate, { message: "La date de fin doit être après la date de début", path: ["endDate"] })
  .refine(v => !v.startTime === !v.endTime, { message: "Indiquez l’heure de début et l’heure de fin, ou aucune des deux", path: ["endTime"] })
  .refine(v => !v.startTime || v.endTime! > v.startTime, { message: "L’heure de fin doit être après l’heure de début", path: ["endTime"] });
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

app.post("/admin/interview-blocks", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = blockInput.parse(request.body);
  const dayCount = Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000) + 1;
  if (dayCount > INTERVIEW_HORIZON_DAYS + 1) return reply.code(400).send({ error: "Période trop longue : un an au maximum." });
  const perDay = !!input.startTime || !!input.weekdays?.length;
  const days = Array.from({ length: dayCount }, (_, i) => addDays(input.startDate, i)).filter(d => !input.weekdays?.length || input.weekdays.includes(weekdayOf(d)));
  if (days.length === 0) return reply.code(400).send({ error: "Aucun jour de la période ne correspond aux jours choisis." });
  const ranges = perDay
    ? days.map(d => ({ startsAt: parisTime(d, input.startTime ? minutesOf(input.startTime) : 0), endsAt: input.endTime ? parisTime(d, minutesOf(input.endTime)) : parisTime(addDays(d, 1), 0) }))
    : [{ startsAt: parisTime(input.startDate, 0), endsAt: parisTime(addDays(input.endDate, 1), 0) }];
  const adminId = currentId(request);
  await prisma.interviewBlock.createMany({ data: ranges.map(r => ({ ...r, reason: input.reason || null, createdById: adminId })) });
  // Les rendez-vous déjà pris dans la période ne sont ni déplacés ni annulés : ils sont signalés pour
  // que l'équipe décide (reprogrammer ou maintenir l'appel).
  // Une seule requête sur toute la période, puis tri en mémoire des rendez-vous tombant dans une plage.
  const booked = await bookedCallsBetween(ranges[0].startsAt, ranges[ranges.length - 1].endsAt);
  const conflicts = booked.filter(c => ranges.some(r => c.startsAt < r.endsAt && r.startsAt < c.endsAt));
  await audit(adminId, "BLOCK_INTERVIEW_PERIOD", "InterviewBlock", undefined, { ...input, created: ranges.length, conflicts: conflicts.length });
  return reply.code(201).send({ created: ranges.length, conflicts: conflicts.map(c => ({ applicationId: c.application!.id, displayName: c.application!.user.displayName, startsAt: c.startsAt })) });
});

app.delete("/admin/interview-blocks/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const deleted = await prisma.interviewBlock.deleteMany({ where: { id } });
  if (deleted.count === 0) return reply.code(404).send({ error: "Période introuvable" });
  await audit(currentId(request), "UNBLOCK_INTERVIEW_PERIOD", "InterviewBlock", id);
  return reply.code(204).send();
});
