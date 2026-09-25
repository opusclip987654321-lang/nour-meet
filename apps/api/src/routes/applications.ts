import { eventRequiresScreening, isAdult, parisDateTime, parisDayKey } from "@nour/shared";
import { ApplicationStatus, PaymentStatus, QuotaCategory, TicketStatus } from "@prisma/client";
import { z } from "zod";
import { assertPhoneVerified } from "../services/session.js";
import { app, httpError, prisma } from "../context.js";
import { interviewRetryDate, refundEligibility, resolvePriceCents } from "../domain.js";
import { ADULT_ONLY_ERROR } from "../services/account.js";
import { audit } from "../services/audit.js";
import { auth, currentId } from "../services/auth.js";
import { applicationAmountCents, defaultCategoryImage } from "../services/events.js";
import { availableInterviewSlots, bookInterviewSlot } from "../services/interview-calendar.js";
import { links } from "../services/links.js";
import { notify } from "../services/notify.js";
import { executeRefund } from "../services/payments.js";
import { offerNextWaitlistEntry, releaseReservationSlot } from "../services/reservations.js";
import { getSetting } from "../settings.js";

const screeningAnswersSchema = z.object({
  motivation: z.string().min(10).max(1000),
  relationshipGoal: z.string().min(5).max(500),
  personality: z.string().min(5).max(500),
  desiredQualities: z.string().min(5).max(500),
  ageRangeSought: z.string().min(2).max(200),
  valuesAndLifestyle: z.string().min(5).max(500),
  noteForOrganizer: z.string().max(500).optional()
});
const networkingAnswersSchema = z.object({
  sector: z.string().min(2).max(200),
  currentRole: z.string().min(2).max(200),
  experienceLevel: z.string().min(1).max(200),
  goal: z.string().min(2).max(300),
  soughtProfiles: z.string().min(2).max(300),
  contribution: z.string().min(2).max(300),
  topics: z.string().min(2).max(300)
});

// Candidature : ne garantit jamais une place (§5 du cahier des charges). Selon le parcours de
// l'événement (voir eventRequiresScreening, jamais une comparaison de catégorie) :
// - SCREENING (speed dating) : exige un profil déjà validé par l'entretien global (une seule
//   démarche par personne, décision antérieure du produit conservée telle quelle — voir le résumé
//   de fin de lot) et un questionnaire privé (7 questions), jamais transmis au restaurateur.
// - DIRECT (networking) : aucune validation de profil requise, aucun questionnaire ici. Arbitrage
//   12/E3 (cahier des charges consolidé 2026-09-20) : les questions professionnelles ne sont plus
//   jamais posées avant l'achat — elles ne doivent ni ralentir ni conditionner le paiement. Elles
//   sont proposées, facultatives, une fois la place confirmée (voir POST
//   /applications/:id/networking-answers).
// Dans les deux cas, aucune place n'est retenue ici : la candidature autorise seulement à tenter le
// paiement via POST /applications/:id/payment-intent, qui pose le verrou technique court.
app.post("/events/:id/apply", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  // Un compte restaurateur (candidature en cours ou déjà approuvée) n'a jamais le droit de participer
  // aux événements en tant que participant, quel que soit le statut de sa fiche Restaurant.
  if (await prisma.restaurant.findUnique({ where: { ownerId: userId } })) return reply.code(403).send({ error: "Les comptes restaurateurs ne peuvent pas participer aux événements" });
  // Numéro vérifié une seule fois par SMS avant la première inscription (connexion Google/e-mail).
  await assertPhoneVerified(userId);
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { priceTiers: true } });
  const requiresScreening = eventRequiresScreening(event);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.profileCompleted) return reply.code(409).send({ error: "Complétez votre profil avant de vous inscrire" });
  // Profils complétés avant l'obligation de date de naissance : bloqués ici jusqu'à mise à jour.
  if (!isAdult(profile.birthDate)) return reply.code(409).send({ error: ADULT_ONLY_ERROR });
  if (requiresScreening && !profile.validatedAt) return reply.code(409).send({ error: "Votre profil doit d’abord être validé lors d’un entretien avant de vous inscrire à un événement de ce type" });
  const existing = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (existing) return reply.code(409).send({ error: "Vous êtes déjà inscrit(e) à cet événement", application: existing });
  const input = requiresScreening
    ? z.object({ screeningAnswers: screeningAnswersSchema, shareCode: z.string().optional() }).parse(request.body)
    : z.object({ shareCode: z.string().optional() }).parse(request.body);
  // Partage attribué (§12) : le code vient de l'URL au moment de la visite, jamais recalculé après
  // coup ; un code inconnu ou expiré n'échoue jamais la candidature, il est simplement ignoré.
  const shareLink = input.shareCode ? await prisma.shareLink.findUnique({ where: { code: input.shareCode } }) : null;
  const quotas = await prisma.eventQuota.findMany({ where: { eventId: id } });
  // La catégorie est nécessaire pour les quotas (speed dating) ET pour résoudre un tarif différencié
  // éventuel (networking inclus) — sans jamais transformer ce tarif en quota implicite pour autant.
  // Un tarif différencié configuré mais inactif (ENABLE_GENDER_PRICING=false, §6) ne doit rien exiger.
  const needsCategory = quotas.length > 0 || (getSetting("ENABLE_GENDER_PRICING") && event.priceTiers.length > 0);
  let quotaCategory: QuotaCategory | null = null;
  if (needsCategory) {
    if (!profile.quotaCategory) return reply.code(409).send({ error: "Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement" });
    quotaCategory = profile.quotaCategory;
  }
  const application = await prisma.application.create({
    data: {
      eventId: id, userId, quotaCategory, status: ApplicationStatus.PAYMENT_PENDING,
      attributedShareLinkId: shareLink && shareLink.eventId === id && shareLink.userId !== userId ? shareLink.id : undefined,
      ...(requiresScreening
        ? { screeningAnswer: { create: (input as { screeningAnswers: z.infer<typeof screeningAnswersSchema> }).screeningAnswers } }
        : {})
    }
  });
  await audit(userId, "CREATE_APPLICATION", "Application", application.id);
  await notify(userId, "Inscription enregistrée", `Vous pouvez maintenant régler votre billet pour « ${event.title} » (${(resolvePriceCents(event, quotaCategory, getSetting("ENABLE_GENDER_PRICING")) / 100).toFixed(2)} €). La place n’est confirmée qu’une fois le paiement réussi.`, links.reservation(application.id));
  return reply.code(201).send({ application: { ...application, amountCents: applicationAmountCents(event, application.quotaCategory) } });
});

// Arbitrage 12/E3 (cahier des charges consolidé 2026-09-20) : les questions professionnelles d'un
// événement networking sont facultatives et ne se posent qu'une fois la place réellement confirmée
// (jamais avant ou pendant le paiement). Peut être appelé plusieurs fois pour corriger une réponse.
app.post("/applications/:id/networking-answers", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const application = await prisma.application.findFirst({ where: { id, userId }, include: { event: true } });
  if (!application) return reply.code(404).send({ error: "Candidature introuvable" });
  if (!application.event || eventRequiresScreening(application.event)) return reply.code(409).send({ error: "Cet événement ne propose pas de questionnaire professionnel" });
  if (application.status !== ApplicationStatus.CONFIRMED) return reply.code(409).send({ error: "Ce questionnaire n’est disponible qu’une fois votre place confirmée" });
  const answers = networkingAnswersSchema.parse(request.body);
  await prisma.networkingAnswer.upsert({ where: { applicationId: id }, update: answers, create: { applicationId: id, ...answers } });
  await audit(userId, "SUBMIT_NETWORKING_ANSWERS", "Application", id);
  return { ok: true };
});

// Entretien global de validation du profil : une seule démarche par personne (pas par événement).
app.get("/me/global-interview", { preHandler: auth }, async (request) => {
  const userId = currentId(request);
  const latest = await prisma.application.findFirst({ where: { userId, eventId: null }, orderBy: { createdAt: "desc" }, include: { call: true } });
  if (!latest) return { status: null };
  const retryAvailableAt = latest.status === ApplicationStatus.REFUSED && latest.decidedAt ? interviewRetryDate(latest.decidedAt) : null;
  // §4.1 : un refus reste neutre — les notes de l'administration sont internes, jamais renvoyées.
  const { notes: _notes, ...visible } = latest;
  return { ...visible, retryAvailableAt };
});
app.post("/me/global-interview", { preHandler: auth }, async (request, reply) => {
  const { motivation } = z.object({ motivation: z.string().min(30).max(1200) }).parse(request.body);
  const userId = currentId(request);
  if (await prisma.restaurant.findUnique({ where: { ownerId: userId } })) return reply.code(403).send({ error: "Les comptes restaurateurs ne peuvent pas participer aux événements" });
  // Numéro vérifié une seule fois par SMS avant la première inscription (connexion Google/e-mail).
  await assertPhoneVerified(userId);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.profileCompleted) return reply.code(409).send({ error: "Complétez votre profil avant de demander un entretien" });
  if (profile.validatedAt) return reply.code(409).send({ error: "Votre profil est déjà validé" });
  const latest = await prisma.application.findFirst({ where: { userId, eventId: null }, orderBy: { createdAt: "desc" } });
  if (latest && latest.status !== ApplicationStatus.REFUSED && latest.status !== ApplicationStatus.CANCELLED) {
    return reply.code(409).send({ error: "Une demande d’entretien est déjà en cours", application: latest });
  }
  if (latest?.status === ApplicationStatus.REFUSED && latest.decidedAt) {
    const retryAt = interviewRetryDate(latest.decidedAt);
    if (retryAt > new Date()) return reply.code(409).send({ error: `Vous pourrez redemander un entretien à partir du ${retryAt.toLocaleDateString("fr-FR")}`, retryAvailableAt: retryAt });
  }
  const application = await prisma.application.create({ data: { userId, motivation } });
  await notify(userId, "Demande d’entretien reçue", "Choisissez maintenant un créneau pour votre entretien.", links.interview());
  await audit(userId, "REQUEST_GLOBAL_INTERVIEW", "Application", application.id);
  return reply.code(201).send(application);
});

// Calendrier ouvert par défaut (v2 §11) : créneaux calculés à la volée, semaine par semaine.
app.get("/interview-slots", { preHandler: auth }, async (request) => {
  const query = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.coerce.number().int().min(1).max(42).default(14) }).parse(request.query);
  return availableInterviewSlots(query.from ?? parisDayKey(new Date()), query.days);
});

const slotInput = z.object({ startsAt: z.string().datetime() });

app.post("/applications/:id/schedule", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { startsAt } = slotInput.parse(request.body);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId, eventId: null } });
  if (application.status !== ApplicationStatus.PENDING_CALL) return reply.code(409).send({ error: "Un entretien est déjà programmé pour cette démarche" });
  const slot = await prisma.$transaction(async (tx) => {
    // Le statut est repris sous verrou : deux onglets qui réservent en même temps n'obtiennent qu'un seul rendez-vous.
    const claimed = await tx.application.updateMany({ where: { id, status: ApplicationStatus.PENDING_CALL }, data: { status: ApplicationStatus.CALL_SCHEDULED } });
    if (claimed.count !== 1) throw httpError(409, "Un entretien est déjà programmé pour cette démarche");
    return bookInterviewSlot(tx, id, new Date(startsAt));
  });
  await notify(userId, "Entretien planifié", `Votre appel est prévu le ${parisDateTime(slot.startsAt)}.`, links.interview());
  return { scheduled: true, slot };
});

// « Modifier mon créneau » (v2 §12) : déplacement atomique, distinct de l'annulation. L'ancien horaire
// n'est libéré que si le nouveau est effectivement obtenu ; la demande d'entretien reste la même.
app.post("/me/global-interview/reschedule", { preHandler: auth }, async (request, reply) => {
  const { startsAt } = slotInput.parse(request.body);
  const userId = currentId(request);
  const application = await prisma.application.findFirst({ where: { userId, eventId: null, status: ApplicationStatus.CALL_SCHEDULED }, include: { call: true }, orderBy: { createdAt: "desc" } });
  if (!application?.call) return reply.code(409).send({ error: "Aucun entretien programmé à déplacer" });
  if (application.call.startsAt <= new Date()) return reply.code(409).send({ error: "Cet entretien a déjà commencé : il ne peut plus être déplacé." });
  if (application.call.startsAt.getTime() === new Date(startsAt).getTime()) return reply.code(409).send({ error: "C’est déjà l’horaire de votre entretien." });
  const slot = await prisma.$transaction(tx => bookInterviewSlot(tx, application.id, new Date(startsAt), application.call!.id));
  await notify(userId, "Entretien déplacé", `Votre appel est désormais prévu le ${parisDateTime(slot.startsAt)}.`, links.interview());
  await audit(userId, "RESCHEDULE_OWN_INTERVIEW", "Application", application.id, { from: application.call.startsAt, to: slot.startsAt });
  return { rescheduled: true, slot };
});

// Montant à annoncer sur la page de paiement autonome (/pay/:applicationId), lu pour cette
// inscription précise de la personne connectée — jamais depuis un paramètre d'URL.
app.get("/me/applications/:id/amount", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const application = await prisma.application.findFirst({ where: { id, userId: currentId(request) }, include: { event: { include: { priceTiers: true } } } });
  if (!application?.event) return reply.code(404).send({ error: "Inscription introuvable" });
  return { amountCents: applicationAmountCents(application.event, application.quotaCategory), eventId: application.event.id };
});

app.get("/me/applications", { preHandler: auth }, async (request) => {
  const applications = await prisma.application.findMany({ where: { userId: currentId(request) }, include: { event: { include: { priceTiers: true } }, call: true, waitlistEntry: true, reservation: { include: { payment: true, ticket: true } } }, orderBy: { createdAt: "desc" } });
  // Même résolution d'image par défaut que les routes publiques (§ligne 307/1316) : un événement
  // sans photo uploadée ne doit jamais renvoyer imageUrl:null au front. amountCents : le montant
  // réellement débité (tarif différencié compris), jamais recalculé côté interface.
  // Notes de l'administration : internes (§4.1), jamais renvoyées. L'événement renvoyé ne garde que ce qu'affiche l'espace personnel : jamais les tarifs bruts par
  // catégorie (ENABLE_GENDER_PRICING), le marquage démo, la note de relecture, ni l'adresse exacte
  // avant la confirmation de la place (elle figure sur le billet).
  return applications.map(({ notes: _notes, ...a }) => {
    if (!a.event) return a;
    const { priceTiers, isDemo: _isDemo, reviewNote: _reviewNote, address, instagramMediaId: _ig, instagramPublishedAt: _igAt, instagramPublishingAt: _igLock, instagramError: _igErr, facebookPostId: _fb, facebookPublishedAt: _fbAt, facebookPublishingAt: _fbLock, facebookError: _fbErr, ...event } = a.event;
    return { ...a, amountCents: applicationAmountCents({ ...a.event, priceTiers }, a.quotaCategory), event: { ...event, address: a.status === ApplicationStatus.CONFIRMED ? address : null, imageUrl: a.event.imageUrl ?? defaultCategoryImage(a.event.category) } };
  });
});

// Politique d'annulation §7 : plus de 24h avant l'événement, remboursement intégral automatique,
// calculé et exécuté ici même (jamais seulement affiché côté interface) ; 24h ou moins, aucun
// remboursement de plein droit — seule une exception admin motivée (POST /admin/payments/:id/refund)
// peut ensuite en accorder un.
app.post("/me/applications/:id/cancel", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId }, include: { reservation: { include: { payment: { include: { ledgerEntry: true } }, ticket: true, event: true } } } });
  if ((application.status === ApplicationStatus.REFUSED) || (application.status === ApplicationStatus.CANCELLED)) return reply.code(409).send({ error: "Cette candidature est déjà close" });
  const activeReservation = application.reservation && !application.reservation.cancelledAt ? application.reservation : null;
  const hadSucceededPayment = activeReservation?.payment?.status === PaymentStatus.SUCCEEDED;
  await prisma.$transaction(async (tx) => {
    if (activeReservation) {
      await releaseReservationSlot(tx, activeReservation);
      if (activeReservation.ticket) await tx.ticket.update({ where: { id: activeReservation.ticket.id }, data: { status: TicketStatus.CANCELLED } });
    }
    await tx.application.update({ where: { id }, data: { status: ApplicationStatus.CANCELLED } });
    await tx.waitlistEntry.deleteMany({ where: { applicationId: id } });
    // « Annuler ma demande d'entretien » (v2 §12) : le créneau réservé redevient disponible, et une
    // nouvelle demande pourra être faite (seul un refus impose un délai).
    if (!application.eventId) await tx.screeningCall.updateMany({ where: { applicationId: id, startsAt: { gt: new Date() } }, data: { applicationId: null } });
  });
  if (activeReservation) await offerNextWaitlistEntry(activeReservation.eventId, activeReservation.quotaCategory);
  await audit(userId, "CANCEL_APPLICATION", "Application", id);
  let refunded = false;
  let refundedAmountCents: number | null = null;
  let eligible: boolean | null = null;
  if (hadSucceededPayment && activeReservation) {
    eligible = refundEligibility(activeReservation.event.startsAt).eligible;
    if (eligible) {
      refunded = await executeRefund(activeReservation.payment!, activeReservation.event, {});
      if (refunded) refundedAmountCents = activeReservation.payment!.amountCents;
    }
  }
  const message = refunded
    ? `Votre annulation a été prise en compte. ${(refundedAmountCents! / 100).toFixed(2)} € ont été remboursés intégralement.`
    : eligible === false
      ? "Votre annulation a été prise en compte. Conformément à notre politique, aucun remboursement n’est possible pour une annulation à 24 heures ou moins de l’événement."
      : hadSucceededPayment
        ? "Votre annulation a été prise en compte. Le remboursement sera examiné manuellement par notre équipe."
        : "Votre candidature a été annulée.";
  // Une demande d'entretien annulée n'a pas de carte d'inscription : la notification mène à l'onglet Entretien.
  if (!application.eventId) await notify(userId, "Demande d’entretien annulée", "Votre demande d’entretien est annulée et le créneau libéré. Vous pourrez en refaire une quand vous le souhaitez.", links.interview());
  else await notify(userId, "Candidature annulée", message, links.reservation(id));
  return reply.send({ cancelled: true, refunded, refundedAmountCents, eligible });
});

app.post("/events/:id/waitlist", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request);
  const existingEntry = await prisma.waitlistEntry.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (existingEntry) return existingEntry;
  const application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (!application) return reply.code(409).send({ error: "Candidatez d’abord à cet événement avant de rejoindre la liste d’attente" });
  const position = await prisma.waitlistEntry.count({ where: { eventId: id } }) + 1;
  const entry = await prisma.waitlistEntry.create({ data: { eventId: id, userId, applicationId: application.id, quotaCategory: application.quotaCategory, position } });
  await audit(userId, "JOIN_WAITLIST", "WaitlistEntry", entry.id);
  return reply.code(201).send(entry);
});

app.get("/events/:id/waitlist/me", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request);
  const entry = await prisma.waitlistEntry.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (!entry) return reply.code(404).send({ error: "Vous n’êtes pas sur la liste d’attente de cet événement" });
  const hasQuotas = (await prisma.eventQuota.count({ where: { eventId: id } })) > 0;
  const rank = await prisma.waitlistEntry.count({ where: { eventId: id, ...(hasQuotas ? { quotaCategory: entry.quotaCategory } : {}), createdAt: { lt: entry.createdAt } } }) + 1;
  return { ...entry, rank };
});

app.delete("/events/:id/waitlist", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request);
  const deleted = await prisma.waitlistEntry.deleteMany({ where: { eventId: id, userId } });
  if (deleted.count === 0) return reply.code(404).send({ error: "Vous n’êtes pas sur la liste d’attente de cet événement" });
  await audit(userId, "LEAVE_WAITLIST", "WaitlistEntry", id);
  return reply.code(204).send();
});
