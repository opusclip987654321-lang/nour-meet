import { ApplicationStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { app, httpError, prisma } from "../context.js";
import { interviewRetryDate } from "../domain.js";
import { audit } from "../services/audit.js";
import { currentId, roles } from "../services/auth.js";
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
    await notify(application.userId, "Profil non validé", `Votre profil n’a pas été validé pour le moment. Vous pourrez redemander un entretien à partir du ${interviewRetryDate(refused.decidedAt!).toLocaleDateString("fr-FR")}.`, "/dashboard?tab=interview");
    await audit(adminId, "REFUSE_GLOBAL_INTERVIEW", "Application", id, { notes });
    return refused;
  }
  const [, updatedApplication] = await prisma.$transaction([
    prisma.profile.update({ where: { userId: application.userId }, data: { validatedAt: new Date() } }),
    prisma.application.update({ where: { id }, data: { status: ApplicationStatus.ACCEPTED, notes, decidedAt: new Date() } })
  ]);
  await notify(application.userId, "Profil validé", "Votre profil est validé : vous pouvez désormais vous inscrire directement aux événements, sans nouvel entretien.", "/dashboard?tab=profile");
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
  await notify(userId, "Validation de profil retirée", "Votre profil n’est plus marqué comme vérifié. Vous pouvez redemander un entretien de validation.", "/dashboard?tab=profile");
  await audit(currentId(request), "REVOKE_PROFILE_VALIDATION", "Profile", userId);
  return { ok: true };
});
// §13/§14 : reprogrammer l'entretien d'un candidat (action rapide admin), jamais laissée à la charge
// du participant qui devrait sinon annuler puis reprendre un nouveau créneau. L'ancien créneau est
// libéré (redevient disponible pour quelqu'un d'autre) dans la même transaction que la prise du
// nouveau, pour ne jamais perdre le créneau d'origine si le nouveau est déjà pris entre-temps.
app.post("/admin/global-interviews/:id/reschedule", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { slotId } = z.object({ slotId: z.string() }).parse(request.body);
  const application = await prisma.application.findFirstOrThrow({ where: { id, eventId: null }, include: { call: true } });
  if (!application.call) return reply.code(409).send({ error: "Aucun entretien programmé pour cette candidature" });
  const slot = await prisma.$transaction(async (tx) => {
    await tx.screeningCall.update({ where: { id: application.call!.id }, data: { applicationId: null } });
    const updated = await tx.screeningCall.updateMany({ where: { id: slotId, eventId: null, applicationId: null }, data: { applicationId: application.id } });
    if (updated.count !== 1) throw httpError(409, "Ce créneau vient d’être réservé par un autre participant. Choisissez-en un autre.");
    return tx.screeningCall.findUniqueOrThrow({ where: { id: slotId } });
  });
  await notify(application.userId, "Entretien reprogrammé", `Votre appel est désormais prévu le ${slot.startsAt.toLocaleString("fr-FR")}.`, "/dashboard?tab=interview");
  await audit(currentId(request), "RESCHEDULE_GLOBAL_INTERVIEW", "Application", id, { slotId });
  return { rescheduled: true, slot };
});

// Agenda central des entretiens : un seul agenda pour toute la plateforme, non lié à un événement.
// Aujourd'hui réservé au super-admin (seul interlocuteur), sans agenda autonome pour les restaurateurs.
app.get("/admin/interview-slots", { preHandler: roles(UserRole.ADMIN) }, async () =>
  prisma.screeningCall.findMany({ where: { eventId: null }, include: { application: { include: { user: true } } }, orderBy: { startsAt: "asc" } })
);
app.post("/admin/interview-slots/generate", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    durationMinutes: z.number().int().min(5).max(180)
  }).parse(request.body);
  const dayStart = new Date(`${input.date}T${input.startTime}:00`);
  const dayEnd = new Date(`${input.date}T${input.endTime}:00`);
  if (dayEnd <= dayStart) return reply.code(400).send({ error: "L’heure de fin doit être après l’heure de début" });
  if (dayStart < new Date()) return reply.code(400).send({ error: "Impossible de proposer des créneaux dans le passé" });
  const candidates: { startsAt: Date; endsAt: Date }[] = [];
  for (let cursor = dayStart.getTime(); cursor + input.durationMinutes * 60_000 <= dayEnd.getTime(); cursor += input.durationMinutes * 60_000) {
    candidates.push({ startsAt: new Date(cursor), endsAt: new Date(cursor + input.durationMinutes * 60_000) });
  }
  if (candidates.length === 0) return reply.code(400).send({ error: "Aucun créneau ne peut être généré avec ces horaires" });
  const existing = await prisma.screeningCall.findMany({ where: { eventId: null, startsAt: { gte: dayStart, lt: dayEnd } }, select: { startsAt: true } });
  const existingTimes = new Set(existing.map(s => s.startsAt.getTime()));
  const toCreate = candidates.filter(c => !existingTimes.has(c.startsAt.getTime()));
  if (toCreate.length > 0) await prisma.screeningCall.createMany({ data: toCreate.map(c => ({ startsAt: c.startsAt, endsAt: c.endsAt })) });
  await audit(currentId(request), "GENERATE_INTERVIEW_SLOTS", "ScreeningCall", undefined, { date: input.date, created: toCreate.length });
  return reply.code(201).send({ created: toCreate.length, skipped: candidates.length - toCreate.length });
});
app.delete("/admin/interview-slots/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const deleted = await prisma.screeningCall.deleteMany({ where: { id, eventId: null, applicationId: null } });
  if (deleted.count === 0) return reply.code(409).send({ error: "Ce créneau est réservé ou introuvable : il ne peut pas être supprimé" });
  return reply.code(204).send();
});
