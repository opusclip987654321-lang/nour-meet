import { eventRequiresScreening } from "@nour/shared";
import { AlternativeOfferStatus, ApplicationStatus, ContactRequestStatus } from "@prisma/client";
import { z } from "zod";
import { app, httpError, prisma } from "../context.js";
import { eventsOverlap } from "../domain.js";
import { cachedQrDataUrl } from "../qr-cache.js";
import { profileAge } from "../services/account.js";
import { audit } from "../services/audit.js";
import { auth, currentId } from "../services/auth.js";
import { links } from "../services/links.js";
import { notify } from "../services/notify.js";
import { getSetting } from "../settings.js";

app.get("/me/tickets", { preHandler: auth }, async (request) => {
  const tickets = await prisma.ticket.findMany({ where: { reservation: { userId: currentId(request) } }, include: { reservation: { include: { event: { include: { controllerRestaurant: true } } } } }, orderBy: { createdAt: "desc" } });
  return Promise.all(tickets.map(async t => ({ ...t, qrDataUrl: await cachedQrDataUrl(t.code) })));
});

// Ce qu'un participant peut voir d'un autre (demande de contact, conversation, message) : son
// prénom et sa photo, rien d'autre — jamais le téléphone, l'e-mail ni la date de naissance, que ces
// routes renvoyaient auparavant avec l'objet utilisateur complet.
const publicPerson = { id: true, displayName: true, profile: { select: { photoUrl: true, validatedAt: true } } } as const;

app.get("/me/share-qr", { preHandler: auth }, async (request) => {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: currentId(request) } });
  return { code: profile.shareCode, qrDataUrl: await cachedQrDataUrl(profile.shareCode) };
});

app.get("/profiles/code/:code", { preHandler: auth }, async (request, reply) => {
  const { code } = z.object({ code: z.string() }).parse(request.params);
  const profile = await prisma.profile.findUnique({ where: { shareCode: code }, include: { user: true } });
  if (!profile || !profile.validatedAt) return reply.code(404).send({ error: "Code invalide ou révoqué" });
  if (profile.userId === currentId(request)) return reply.code(409).send({ error: "Il s’agit de votre propre code" });
  return { userId: profile.userId, displayName: profile.user.displayName, photoUrl: profile.photoUrl, age: profileAge(profile.birthDate), city: profile.city, profession: profile.profession, interests: profile.interests, bio: profile.bio, validated: true };
});

// Mise en relation fondée sur le consentement : une demande refusée ne peut jamais être relancée
// (auparavant, le même appel la remettait « en attente » et renotifiait la personne à chaque fois),
// une demande en attente n'est pas renotifiée, et une relation déjà acceptée n'est pas recréée.
app.post("/contacts/request", { preHandler: auth }, async (request, reply) => {
  const { recipientId } = z.object({ recipientId: z.string() }).parse(request.body); const requesterId = currentId(request);
  if (recipientId === requesterId) return reply.code(400).send({ error: "Vous ne pouvez pas vous envoyer une demande à vous-même." });
  const existing = await prisma.contactRequest.findUnique({ where: { requesterId_recipientId: { requesterId, recipientId } } });
  if (existing?.status === ContactRequestStatus.REFUSED) return reply.code(409).send({ error: "Cette personne a décliné votre demande : elle ne peut pas être renouvelée." });
  if (existing?.status === ContactRequestStatus.ACCEPTED) return reply.code(409).send({ error: "Vous êtes déjà en contact avec cette personne." });
  if (existing?.status === ContactRequestStatus.PENDING) return existing;
  // Une personne signalée par le destinataire ne peut plus lui envoyer de demande.
  if (await prisma.report.findFirst({ where: { reporterId: recipientId, reportedId: requesterId }, select: { id: true } })) return reply.code(409).send({ error: "Cette personne n’accepte pas de demande de votre part." });
  const requestRow = existing
    ? await prisma.contactRequest.update({ where: { id: existing.id }, data: { status: ContactRequestStatus.PENDING } })
    : await prisma.contactRequest.create({ data: { requesterId, recipientId } });
  await notify(recipientId, "Nouvelle demande de contact", "Un participant souhaite entrer en contact avec vous.", links.contacts());
  return requestRow;
});

app.get("/me/contact-requests", { preHandler: auth }, async (request) => {
  const userId = currentId(request);
  return prisma.contactRequest.findMany({ where: { OR: [{ requesterId: userId }, { recipientId: userId }] }, include: { requester: { select: publicPerson }, recipient: { select: publicPerson } }, orderBy: { createdAt: "desc" } });
});

app.post("/contacts/:id/respond", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const { accept } = z.object({ accept: z.boolean() }).parse(request.body); const userId = currentId(request);
  const contact = await prisma.contactRequest.findFirstOrThrow({ where: { id, recipientId: userId } });
  // Une réponse est définitive : répondre deux fois créait une seconde conversation.
  if (contact.status !== ContactRequestStatus.PENDING) return reply.code(409).send({ error: "Vous avez déjà répondu à cette demande." });
  const updated = await prisma.contactRequest.update({ where: { id }, data: { status: accept ? ContactRequestStatus.ACCEPTED : ContactRequestStatus.REFUSED } });
  if (accept) {
    const conversation = await prisma.conversation.create({ data: { members: { create: [{ userId: contact.requesterId }, { userId: contact.recipientId }] } } });
    await notify(contact.requesterId, "Demande acceptée", "Vous pouvez maintenant échanger des messages.", links.contacts());
    return { contact: updated, conversation };
  }
  return reply.send({ contact: updated });
});

app.get("/conversations", { preHandler: auth }, async (request) => prisma.conversation.findMany({ where: { members: { some: { userId: currentId(request) } } }, include: { members: { select: { userId: true, blockedAt: true, user: { select: publicPerson } } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } }));
app.get("/conversations/:id/messages", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request);
  await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: id, userId } } });
  return prisma.message.findMany({ where: { conversationId: id }, include: { sender: { select: publicPerson } }, orderBy: { createdAt: "asc" } });
});
app.post("/conversations/:id/messages", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request); const { body, imageUrl } = z.object({ body: z.string().max(2000).optional(), imageUrl: z.string().url().optional() }).refine(v => v.body || v.imageUrl).parse(request.body);
  const member = await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: id, userId } } });
  if (member.blockedAt) throw httpError(403, "Conversation bloquée");
  return prisma.message.create({ data: { conversationId: id, senderId: userId, body, imageUrl }, include: { sender: { select: publicPerson } } });
});

// Signalement : la personne signalée doit exister et ne pas être soi-même. Le blocage s'applique
// aux DEUX côtés des conversations partagées — auparavant seule la personne qui signalait était
// bloquée, et la personne signalée pouvait continuer à lui écrire.
app.post("/reports", { preHandler: auth }, async (request, reply) => {
  const input = z.object({ reportedId: z.string(), reason: z.string().min(3).max(120), details: z.string().max(1000).optional(), block: z.boolean().default(true) }).parse(request.body); const reporterId = currentId(request);
  if (input.reportedId === reporterId) return reply.code(400).send({ error: "Vous ne pouvez pas vous signaler vous-même." });
  const reported = await prisma.user.findUnique({ where: { id: input.reportedId }, select: { id: true } });
  if (!reported) return reply.code(404).send({ error: "Cette personne est introuvable." });
  const report = await prisma.report.create({ data: { reporterId, reportedId: input.reportedId, reason: input.reason, details: input.details } });
  if (input.block) {
    const shared = await prisma.conversation.findMany({ where: { AND: [{ members: { some: { userId: reporterId } } }, { members: { some: { userId: input.reportedId } } }] }, select: { id: true } });
    await prisma.conversationMember.updateMany({ where: { conversationId: { in: shared.map(c => c.id) }, userId: { in: [reporterId, input.reportedId] } }, data: { blockedAt: new Date() } });
  }
  await audit(reporterId, "CREATE_REPORT", "Report", report.id);
  return report;
});

app.get("/notifications", { preHandler: auth }, async (request) => {
  // La cloche de l'en-tête ne demande que les dernières (limit), la page complète jusqu'à 100.
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
  return prisma.notification.findMany({ where: { userId: currentId(request) }, orderBy: { createdAt: "desc" }, take: limit });
});
app.get("/notifications/unread-count", { preHandler: auth }, async (request) => ({ count: await prisma.notification.count({ where: { userId: currentId(request), readAt: null } }) }));
// C13 (ordre correctif 2026-09-20) : marquer une notification lue au clic, jamais recyclé depuis
// l'outbox admin — cette route agit uniquement sur les notifications du compte courant.
// Corrections web 2026-09-24 (§4) : « Tout marquer comme lu » depuis la cloche ou la page complète —
// uniquement les notifications du compte courant.
app.post("/notifications/read-all", { preHandler: auth }, async (request) => {
  const { count } = await prisma.notification.updateMany({ where: { userId: currentId(request), readAt: null }, data: { readAt: new Date() } });
  return { count };
});
app.post("/notifications/:id/read", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const updated = await prisma.notification.updateMany({ where: { id, userId: currentId(request), readAt: null }, data: { readAt: new Date() } });
  if (updated.count === 0) return reply.code(404).send({ error: "Notification introuvable" });
  return reply.code(204).send();
});
app.get("/loyalty", { preHandler: auth }, async (request) => {
  const entries = await prisma.loyaltyEntry.findMany({ where: { userId: currentId(request) }, orderBy: { createdAt: "desc" } });
  return { balance: entries.reduce((n, e) => n + e.points, 0), entries };
});

app.get("/me/alternative-offers", { preHandler: auth }, async (request) => prisma.alternativeOffer.findMany({ where: { userId: currentId(request) }, include: { alternativeEvent: true, originalEvent: true }, orderBy: { createdAt: "desc" } }));

app.post("/alternative-offers/:id/respond", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
  const userId = currentId(request);
  const offer = await prisma.alternativeOffer.findFirstOrThrow({ where: { id, userId }, include: { alternativeEvent: true, originalEvent: true } });
  if (offer.status !== AlternativeOfferStatus.PENDING) return reply.code(409).send({ error: "Cette proposition a déjà été traitée" });
  if (offer.respondsBy < new Date()) { await prisma.alternativeOffer.update({ where: { id }, data: { status: AlternativeOfferStatus.EXPIRED } }); return reply.code(409).send({ error: "Cette proposition a expiré" }); }
  if (!accept) return prisma.alternativeOffer.update({ where: { id }, data: { status: AlternativeOfferStatus.DECLINED, respondedAt: new Date() } });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });
  const quotas = await prisma.eventQuota.findMany({ where: { eventId: offer.alternativeEventId } });
  const priceTiers = await prisma.priceTier.findMany({ where: { eventId: offer.alternativeEventId } });
  const needsCategory = quotas.length > 0 || (getSetting("ENABLE_GENDER_PRICING") && priceTiers.length > 0);
  const quotaCategory = needsCategory ? profile.quotaCategory : null;
  if (needsCategory && !quotaCategory) return reply.code(409).send({ error: "Complétez votre catégorie dans votre profil avant d’accepter" });
  // N'attribue jamais de place ici (§5) : accepter ne fait qu'autoriser à payer, exactement comme
  // une candidature normale. Les réponses au questionnaire de la candidature d'origine (même type
  // d'événement) sont reprises pour ne pas les redemander.
  let application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: offer.alternativeEventId, userId } } });
  if (!application) {
    const original = await prisma.application.findUnique({ where: { eventId_userId: { eventId: offer.originalEventId, userId } }, include: { screeningAnswer: true, networkingAnswer: true } });
    const requiresScreening = eventRequiresScreening(offer.alternativeEvent);
    application = await prisma.application.create({ data: {
      eventId: offer.alternativeEventId, userId, quotaCategory, status: ApplicationStatus.PAYMENT_PENDING,
      ...(requiresScreening && original?.screeningAnswer ? { screeningAnswer: { create: {
        motivation: original.screeningAnswer.motivation, relationshipGoal: original.screeningAnswer.relationshipGoal, personality: original.screeningAnswer.personality,
        desiredQualities: original.screeningAnswer.desiredQualities, ageRangeSought: original.screeningAnswer.ageRangeSought, valuesAndLifestyle: original.screeningAnswer.valuesAndLifestyle,
        noteForOrganizer: original.screeningAnswer.noteForOrganizer
      } } } : {}),
      ...(!requiresScreening && original?.networkingAnswer ? { networkingAnswer: { create: {
        sector: original.networkingAnswer.sector, currentRole: original.networkingAnswer.currentRole, experienceLevel: original.networkingAnswer.experienceLevel,
        goal: original.networkingAnswer.goal, soughtProfiles: original.networkingAnswer.soughtProfiles, contribution: original.networkingAnswer.contribution, topics: original.networkingAnswer.topics
      } } } : {})
    } });
  } else if (application.status !== ApplicationStatus.PAYMENT_PENDING) {
    application = await prisma.application.update({ where: { id: application.id }, data: { status: ApplicationStatus.PAYMENT_PENDING } });
  }
  const updated = await prisma.alternativeOffer.update({ where: { id }, data: { status: AlternativeOfferStatus.ACCEPTED, respondedAt: new Date() } });
  // §11 : un horaire incompatible avec l'événement d'origine rend le maintien sur sa liste d'attente
  // sans objet (impossible d'honorer les deux) — retrait automatique, jamais laissé à la charge du
  // participant. Un horaire compatible (créneau différent) laisse volontairement l'inscription
  // d'origine active : les deux événements restent honorables.
  if (eventsOverlap(offer.originalEvent, offer.alternativeEvent)) {
    await prisma.waitlistEntry.deleteMany({ where: { eventId: offer.originalEventId, userId } });
  }
  await notify(userId, "Événement alternatif accepté", `Vous pouvez maintenant régler votre billet pour « ${offer.alternativeEvent.title} ».`, links.reservation(application.id));
  await audit(userId, "ACCEPT_ALTERNATIVE_OFFER", "AlternativeOffer", id);
  return { ...updated, application };
});
