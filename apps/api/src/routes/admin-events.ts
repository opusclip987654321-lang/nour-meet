import { EVENT_CATEGORY_NAMES, EVENT_ZONES, eventRequiresScreening, suggestedFlowForCategory } from "@nour/shared";
import { EventStatus, PaymentStatus, QuotaCategory, TicketStatus, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, app, prisma, uploadsDir } from "../context.js";
import { currentYearMonth, paymentDeadline } from "../domain.js";
import { audit } from "../services/audit.js";
import { TokenUser, assertEventAccess, currentId, ownRestaurant, roles } from "../services/auth.js";
import { cancelEventWithRefunds } from "../services/event-cancellation.js";
import { defaultCategoryImage, formatPaymentDeadline } from "../services/events.js";
import { links } from "../services/links.js";
import { notify } from "../services/notify.js";
import { claimReservation } from "../services/reservations.js";
import { getSetting } from "../settings.js";
import { retireDemoEventsIfRealOnesPublished } from "../services/demo-events.js";

app.get("/admin/events", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const events = await prisma.event.findMany({ where: restaurant ? { controllerRestaurantId: restaurant.id } : undefined, include: { quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } } }, orderBy: { startsAt: "asc" } });
  // genderPricingEnabled : un tarif homme/femme n'est proposé à la saisie que s'il sera réellement
  // appliqué (drapeau ENABLE_GENDER_PRICING) — jamais un réglage enregistré puis ignoré en silence.
  const genderPricingEnabled = getSetting("ENABLE_GENDER_PRICING");
  return events.map(e => ({ ...e, genderPricingEnabled, imageUrl: e.imageUrl ?? defaultCategoryImage(e.category) }));
});
app.post("/admin/events/:id/quotas", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  if (!eventRequiresScreening(event)) return reply.code(400).send({ error: "Les quotas ne sont disponibles que pour un événement à sélection (speed dating)" });
  const input = z.object({ homme: z.number().int().min(0), femme: z.number().int().min(0) }).parse(request.body);
  if (input.homme + input.femme > event.capacity) return reply.code(400).send({ error: "La somme des quotas dépasse la capacité totale de l’événement" });
  const existing = await prisma.eventQuota.findMany({ where: { eventId: id } });
  const currentHeld = (cat: QuotaCategory) => existing.find(q => q.category === cat)?.heldCount ?? 0;
  if (input.homme < currentHeld(QuotaCategory.HOMME) || input.femme < currentHeld(QuotaCategory.FEMME)) return reply.code(400).send({ error: "Impossible de réduire un quota en dessous du nombre de places déjà tenues" });
  await prisma.$transaction([
    prisma.eventQuota.upsert({ where: { eventId_category: { eventId: id, category: QuotaCategory.HOMME } }, update: { capacity: input.homme }, create: { eventId: id, category: QuotaCategory.HOMME, capacity: input.homme } }),
    prisma.eventQuota.upsert({ where: { eventId_category: { eventId: id, category: QuotaCategory.FEMME } }, update: { capacity: input.femme }, create: { eventId: id, category: QuotaCategory.FEMME, capacity: input.femme } })
  ]);
  await audit(currentId(request), "SET_EVENT_QUOTAS", "Event", id, input);
  return prisma.eventQuota.findMany({ where: { eventId: id } });
});
// §8.3/§20 : un restaurateur ne voit jamais les coordonnées complètes (téléphone, e-mail) d'un
// participant, seulement le prénom/pseudonyme (displayName) et les informations logistiques
// nécessaires à l'organisation — jamais les réponses de questionnaire, jamais exposées ici de
// toute façon. Le super-admin, lui, garde l'accès complet (contact direct en cas de litige).
app.get("/admin/events/:id/reservations", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  const token = request.user as TokenUser;
  const isAdmin = token.role === UserRole.ADMIN;
  // §6 (corrections web 2026-09-24) : le restaurateur ne voit que le statut du paiement, jamais les
  // références Stripe ni les champs de remboursement internes à Nūr Meet.
  return prisma.reservation.findMany({ where: { eventId: event.id }, include: { user: { select: isAdmin ? { id: true, displayName: true, phone: true, email: true } : { id: true, displayName: true } }, payment: isAdmin ? true : { select: { id: true, status: true } }, ticket: isAdmin ? true : { select: { id: true, status: true, usedAt: true } } }, orderBy: { createdAt: "desc" } });
});

app.post("/admin/events/:id/cancel", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  return cancelEventWithRefunds(event, currentId(request), "CANCEL_EVENT");
});
// Décision explicite du restaurateur (ou de l'admin) après notification d'un minimum non atteint
// (§10) : n'est utilisable que pendant la fenêtre de réponse, avant que la décision par défaut ne
// s'applique automatiquement (voir checkMinParticipantsThresholds).
app.post("/admin/events/:id/min-participants-decision", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { action } = z.object({ action: z.enum(["MAINTAIN", "CANCEL"]) }).parse(request.body);
  const event = await assertEventAccess(request, id);
  if (!event.minParticipantsNotifiedAt) return reply.code(409).send({ error: "Aucune notification de minimum non atteint pour cet événement" });
  if (event.minParticipantsOutcome) return reply.code(409).send({ error: "Une décision a déjà été prise pour cet événement" });
  const actorId = currentId(request);
  if (action === "CANCEL") {
    const result = await cancelEventWithRefunds(event, actorId, "MIN_PARTICIPANTS_CANCELLED");
    await prisma.event.update({ where: { id }, data: { minParticipantsOutcome: "CANCELLED", minParticipantsDecidedAt: new Date(), minParticipantsDecidedBy: actorId } });
    return result;
  }
  const updated = await prisma.event.update({ where: { id }, data: { minParticipantsOutcome: "MAINTAINED", minParticipantsDecidedAt: new Date(), minParticipantsDecidedBy: actorId } });
  await audit(actorId, "MIN_PARTICIPANTS_MAINTAINED", "Event", id);
  return updated;
});

app.post("/admin/waitlist/:id/promote", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id }, include: { application: true } });
  const result = await claimReservation(entry.eventId, entry.application, paymentDeadline(new Date(), getSetting("WAITLIST_OFFER_WINDOW_HOURS")));
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = { FULL: "Plus aucune place disponible pour cette catégorie", NO_CATEGORY: "Catégorie de quota manquante pour ce participant", OVERLAP: "Ce participant a déjà une réservation active sur un événement qui chevauche cet horaire" };
    return reply.code(409).send({ error: messages[result.reason] });
  }
  await prisma.waitlistEntry.update({ where: { id }, data: { offeredAt: new Date(), expiresAt: result.reservation.expiresAt } });
  await notify(entry.userId, "Une place vous a été attribuée", `Vous avez ${formatPaymentDeadline(result.reservation.expiresAt)} pour régler votre billet.`, links.reservation(entry.applicationId));
  await audit(currentId(request), "ADMIN_PROMOTE_WAITLIST", "WaitlistEntry", id);
  return result.reservation;
});

const perksInput = { includesDrink: z.boolean().default(false), includesStarter: z.boolean().default(false), includesMain: z.boolean().default(false), includesDessert: z.boolean().default(false), perksDescription: z.string().max(500).optional() };
app.post("/admin/events", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const input = z.object({ venueRestaurantId: z.string().optional(), title: z.string().min(3), slug: z.string().regex(/^[a-z0-9-]+$/), category: z.enum(EVENT_CATEGORY_NAMES as [string, ...string[]]), flow: z.enum(["SCREENING", "DIRECT"]).optional(), description: z.string().min(20), startsAt: z.string(), endsAt: z.string(), district: z.string(), address: z.string(), zone: z.enum(EVENT_ZONES as [string, ...string[]]), minAge: z.number().int().min(18).max(99).optional(), maxAge: z.number().int().min(18).max(99).optional(), capacity: z.number().int().min(5).max(500), priceCents: z.number().int().min(0), publish: z.boolean().default(false), minParticipants: z.number().int().min(1).optional(), minParticipantsDeadline: z.string().optional(), ...perksInput })
    // Minimum facultatif, mais la date limite devient obligatoire dès qu'un minimum est défini (§10).
    .refine(v => !v.minParticipants || v.minParticipantsDeadline, { message: "Une date limite de décision est obligatoire dès qu'un minimum de participants est défini", path: ["minParticipantsDeadline"] })
    .parse(request.body);
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  // Un restaurateur ne prépare jamais qu'un brouillon : seul le super-admin peut publier (POST /admin/events/:id/review-decision).
  // Le super-admin peut publier immédiatement son propre événement, éventuellement accueilli par un restaurant partenaire.
  let venueRestaurantId: string | null = restaurant?.id ?? null;
  if (token.role === UserRole.ADMIN && input.venueRestaurantId) {
    const venue = await prisma.restaurant.findUnique({ where: { id: input.venueRestaurantId } });
    if (!venue || venue.status !== "APPROVED") return reply.code(400).send({ error: "Restaurant partenaire introuvable ou non approuvé" });
    venueRestaurantId = venue.id;
  }
  const event = await prisma.event.create({ data: {
    title: input.title, slug: input.slug, category: input.category, flow: (token.role === UserRole.ADMIN ? input.flow : undefined) ?? suggestedFlowForCategory(input.category), description: input.description,
    startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), district: input.district, address: input.address, zone: input.zone,
    capacity: input.capacity, priceCents: input.priceCents,
    includesDrink: input.includesDrink, includesStarter: input.includesStarter, includesMain: input.includesMain, includesDessert: input.includesDessert, perksDescription: input.perksDescription,
    controllerRestaurantId: restaurant?.id ?? null,
    venueRestaurantId,
    minParticipants: input.minParticipants, minParticipantsDeadline: input.minParticipantsDeadline ? new Date(input.minParticipantsDeadline) : undefined,
    minAge: input.minAge, maxAge: input.maxAge,
    status: token.role === UserRole.ADMIN && input.publish ? EventStatus.PUBLISHED : EventStatus.DRAFT
  } });
  await audit(currentId(request), "CREATE_EVENT", "Event", event.id);
  if (event.status === EventStatus.PUBLISHED) await retireDemoEventsIfRealOnesPublished(prisma).catch(err => request.log.error(err, "Retrait des soirées de démonstration échoué"));
  return event;
});
// Modification d'un événement déjà créé. La capacité ne peut jamais descendre sous les places déjà
// payées ou temporairement bloquées ; un changement de date alors qu'au moins une réservation est
// payée ou bloquée reste une proposition (voir /date-change/decision), jamais appliquée directement.
app.patch("/admin/events/:id", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  const input = z.object({
    title: z.string().min(3).optional(), description: z.string().min(20).optional(), district: z.string().optional(), address: z.string().optional(),
    capacity: z.number().int().min(5).max(500).optional(), priceCents: z.number().int().min(0).optional(),
    startsAt: z.string().optional(), endsAt: z.string().optional(), flow: z.enum(["SCREENING", "DIRECT"]).optional(),
    minParticipants: z.number().int().min(1).nullable().optional(), minParticipantsDeadline: z.string().nullable().optional(),
    minAge: z.number().int().min(18).max(99).nullable().optional(), maxAge: z.number().int().min(18).max(99).nullable().optional(),
    ...Object.fromEntries(Object.entries(perksInput).map(([k, v]) => [k, v.optional()]))
  }).parse(request.body);
  if ((input.minParticipants ?? event.minParticipants) && !(input.minParticipantsDeadline !== undefined ? input.minParticipantsDeadline : event.minParticipantsDeadline)) {
    return reply.code(400).send({ error: "Une date limite de décision est obligatoire dès qu'un minimum de participants est défini" });
  }
  const activeReservations = await prisma.reservation.count({ where: { eventId: id, cancelledAt: null } });
  if (input.capacity !== undefined && input.capacity < activeReservations) return reply.code(400).send({ error: `Impossible de descendre sous ${activeReservations} places déjà payées ou bloquées` });
  // Seul le super-admin décide du parcours (sélection ou accès direct) : jamais le restaurateur,
  // qui ne définit que la logistique de sa soirée (voir §8.3 du cahier des charges).
  const token = request.user as TokenUser;
  if (input.flow !== undefined && token.role !== UserRole.ADMIN) return reply.code(403).send({ error: "Seul un administrateur peut changer le parcours d’un événement" });
  const data: Record<string, unknown> = { ...input };
  delete data.startsAt; delete data.endsAt;
  if (token.role !== UserRole.ADMIN) delete data.flow;
  if (input.minParticipantsDeadline !== undefined) data.minParticipantsDeadline = input.minParticipantsDeadline ? new Date(input.minParticipantsDeadline) : null;
  const dateChanged = (input.startsAt && new Date(input.startsAt).getTime() !== event.startsAt.getTime()) || (input.endsAt && new Date(input.endsAt).getTime() !== event.endsAt.getTime());
  // Cahier des charges consolidé final (2026-09-20, section 3) : une soirée PUBLIÉE ne peut plus être
  // déplacée, ni pour un restaurateur ni pour un événement Nour — l'ancien mécanisme de proposition/
  // approbation de changement de date est retiré. Seule issue désormais : annuler cette soirée
  // (remboursement immédiat automatique) puis en créer une nouvelle. Un brouillon reste librement
  // modifiable, y compris sa date, puisque rien n'a encore été vendu ni publiquement annoncé.
  if (dateChanged && (event.status === EventStatus.PUBLISHED || event.status === EventStatus.FULL)) {
    return reply.code(409).send({ error: "Une soirée publiée ne peut pas être déplacée. Annulez-la (remboursement automatique) puis créez une nouvelle soirée à la date souhaitée." });
  }
  if (dateChanged) {
    if (input.startsAt) data.startsAt = new Date(input.startsAt);
    if (input.endsAt) data.endsAt = new Date(input.endsAt);
  }
  const updated = await prisma.event.update({ where: { id }, data });
  await audit(currentId(request), "UPDATE_EVENT", "Event", id, input);
  return updated;
});
// Tarifs : un événement garde un tarif unique par défaut ; la différenciation homme/femme reste
// facultative et sa conformité légale doit être vérifiée avant toute activation en production.
app.post("/admin/events/:id/pricing", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, _reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  const input = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("flat"), amountCents: z.number().int().min(0) }),
    z.object({ mode: z.literal("differentiated"), homme: z.number().int().min(0), femme: z.number().int().min(0) })
  ]).parse(request.body);
  if (input.mode === "flat") {
    await prisma.$transaction([
      prisma.priceTier.deleteMany({ where: { eventId: id } }),
      prisma.event.update({ where: { id }, data: { priceCents: input.amountCents } })
    ]);
  } else {
    await prisma.$transaction([
      prisma.priceTier.upsert({ where: { eventId_category: { eventId: id, category: QuotaCategory.HOMME } }, update: { amountCents: input.homme }, create: { eventId: id, category: QuotaCategory.HOMME, amountCents: input.homme } }),
      prisma.priceTier.upsert({ where: { eventId_category: { eventId: id, category: QuotaCategory.FEMME } }, update: { amountCents: input.femme }, create: { eventId: id, category: QuotaCategory.FEMME, amountCents: input.femme } })
    ]);
  }
  await audit(currentId(request), "SET_EVENT_PRICING", "Event", id, input);
  return { priceTiers: await prisma.priceTier.findMany({ where: { eventId: id } }) };
});
// Galerie : jusqu'à 5 photos en plus de la photo principale (POST /admin/events/:id/image).
app.post("/admin/events/:id/photos", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  const count = await prisma.eventPhoto.count({ where: { eventId: id } });
  if (count >= 5) return reply.code(409).send({ error: "5 photos supplémentaires maximum : supprimez-en une avant d’en ajouter une nouvelle" });
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Aucun fichier reçu" });
  const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!extension) return reply.code(415).send({ error: "Format non pris en charge (jpeg, png ou webp uniquement)" });
  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image trop volumineuse (5 Mo maximum)" });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(uploadsDir, filename), buffer);
  const photo = await prisma.eventPhoto.create({ data: { eventId: id, url: `/static/uploads/events/${filename}`, position: count } });
  await audit(currentId(request), "ADD_EVENT_PHOTO", "Event", id);
  return reply.code(201).send(photo);
});
app.delete("/admin/events/:id/photos/:photoId", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id, photoId } = z.object({ id: z.string(), photoId: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  const deleted = await prisma.eventPhoto.deleteMany({ where: { id: photoId, eventId: id } });
  if (deleted.count === 0) return reply.code(404).send({ error: "Photo introuvable" });
  return reply.code(204).send();
});
// Historique des soumissions et décisions de cet événement, à partir du journal d'audit existant.
app.get("/admin/events/:id/history", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  return prisma.auditLog.findMany({ where: { entity: "Event", entityId: id }, orderBy: { createdAt: "desc" } });
});
// Statistiques de conversion des partages (§12/§14) : l'identité de qui a partagé n'apparaît
// jamais publiquement, uniquement ici pour l'administration.
app.get("/admin/events/:id/shares", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  const links = await prisma.shareLink.findMany({ where: { eventId: id }, include: { user: true, applications: { include: { reservation: { include: { payment: true } } } } }, orderBy: { clicks: "desc" } });
  const bySharer = links.map(l => ({
    displayName: l.user.displayName, clicks: l.clicks, applications: l.applications.length,
    purchases: l.applications.filter(a => a.reservation?.payment?.status === PaymentStatus.SUCCEEDED).length
  }));
  return {
    totalClicks: links.reduce((n, l) => n + l.clicks, 0),
    totalAttributedApplications: bySharer.reduce((n, s) => n + s.applications, 0),
    totalAttributedPurchases: bySharer.reduce((n, s) => n + s.purchases, 0),
    bySharer
  };
});
const RESTAURANT_PHOTO_REQUIRED = "Ajoutez au moins une photo de votre établissement (Mon établissement → Galerie) avant de soumettre une soirée.";
app.post("/admin/events/:id/submit-for-review", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  if (event.status !== EventStatus.DRAFT) return reply.code(409).send({ error: "Seul un événement en brouillon peut être soumis" });
  // Une soirée n'est jamais soumise sans au moins une photo réelle de l'établissement qui l'accueille.
  const restaurantId = event.venueRestaurantId ?? event.controllerRestaurantId;
  if (!restaurantId || (await prisma.restaurantPhoto.count({ where: { restaurantId } })) === 0) return reply.code(409).send({ error: RESTAURANT_PHOTO_REQUIRED });
  const updated = await prisma.event.update({ where: { id }, data: { status: EventStatus.PENDING_REVIEW, submittedForReviewAt: new Date(), reviewNote: null } });
  const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
  await Promise.all(admins.map(a => notify(a.id, "Événement à valider", `« ${event.title} » attend votre validation avant publication.`, `/admin/events?highlight=${event.id}`)));
  await audit(currentId(request), "SUBMIT_EVENT_FOR_REVIEW", "Event", id);
  return updated;
});
app.post("/admin/events/:id/review-decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, note } = z.object({ accept: z.boolean(), note: z.string().max(1000).optional() }).parse(request.body);
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { controllerRestaurant: { include: { subscription: { include: { plan: true } } } } } });
  if (event.status !== EventStatus.PENDING_REVIEW) return reply.code(409).send({ error: "Cet événement n’est pas en attente de validation" });
  // Publication d'un événement organisé commercialement par un restaurant (jamais pour un événement
  // Nour où le restaurant n'est que le lieu) : bloquée si l'abonnement n'est pas actif, et ne
  // consomme le quota mensuel qu'à cette toute première publication (§8.2), jamais avant.
  let quotaConsumedNow = false;
  if (accept && event.controllerRestaurant && !event.quotaConsumedAt) {
    const subscription = event.controllerRestaurant.subscription;
    if (!subscription || (subscription.status !== "ACTIVE" && subscription.status !== "TRIALING")) {
      return reply.code(409).send({ error: "L’abonnement de ce restaurateur n’est pas actif : impossible de publier tant qu’il n’est pas régularisé." });
    }
    const yearMonth = currentYearMonth();
    const usage = await prisma.restaurantMonthlyUsage.upsert({ where: { restaurantId_yearMonth: { restaurantId: event.controllerRestaurant.id, yearMonth } }, update: {}, create: { restaurantId: event.controllerRestaurant.id, yearMonth } });
    // §7 : monthlyEventQuota null = formule Premium illimitée, aucun plafond à vérifier.
    if (subscription.plan.monthlyEventQuota != null && usage.eventsPublished >= subscription.plan.monthlyEventQuota) {
      return reply.code(409).send({ error: `Quota mensuel atteint (${usage.eventsPublished}/${subscription.plan.monthlyEventQuota} événements publiés ce mois-ci).` });
    }
    await prisma.restaurantMonthlyUsage.update({ where: { restaurantId_yearMonth: { restaurantId: event.controllerRestaurant.id, yearMonth } }, data: { eventsPublished: { increment: 1 } } });
    quotaConsumedNow = true;
  }
  const updated = await prisma.event.update({ where: { id }, data: { status: accept ? EventStatus.PUBLISHED : EventStatus.DRAFT, reviewedAt: new Date(), reviewNote: note ?? null, quotaConsumedAt: quotaConsumedNow ? new Date() : undefined } });
  if (event.controllerRestaurant) await notify(event.controllerRestaurant.ownerId, accept ? "Événement publié" : "Événement renvoyé en brouillon", accept ? `« ${event.title} » est maintenant publié.` : `« ${event.title} » nécessite des modifications${note ? ` : ${note}` : "."}`, links.restaurantEvent(event.id));
  await audit(currentId(request), accept ? "APPROVE_EVENT" : "REJECT_EVENT", "Event", id, { note, quotaConsumedNow });
  // Le retrait des démonstrations ne doit jamais faire échouer une publication déjà enregistrée.
  if (accept && !event.isDemo) await retireDemoEventsIfRealOnesPublished(prisma).catch(err => request.log.error(err, "Retrait des soirées de démonstration échoué"));
  return updated;
});
// Action explicite d'un administrateur (§8.2) : la seule façon de rendre un quota déjà consommé,
// jamais automatique (une annulation ou une suppression ne le rend pas seule).
app.post("/admin/events/:id/refund-quota", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await prisma.event.findUniqueOrThrow({ where: { id } });
  if (!event.quotaConsumedAt || !event.controllerRestaurantId) return reply.code(409).send({ error: "Cet événement n’a consommé aucun quota" });
  const yearMonth = currentYearMonth(event.quotaConsumedAt);
  await prisma.$transaction([
    prisma.event.update({ where: { id }, data: { quotaConsumedAt: null } }),
    prisma.restaurantMonthlyUsage.updateMany({ where: { restaurantId: event.controllerRestaurantId, yearMonth, eventsPublished: { gt: 0 } }, data: { eventsPublished: { decrement: 1 } } })
  ]);
  await audit(currentId(request), "REFUND_EVENT_QUOTA", "Event", id);
  return { refunded: true };
});
app.post("/admin/events/:id/image", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Aucun fichier reçu" });
  const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!extension) return reply.code(415).send({ error: "Format non pris en charge (jpeg, png ou webp uniquement)" });
  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image trop volumineuse (5 Mo maximum)" });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(uploadsDir, filename), buffer);
  const imageUrl = `/static/uploads/events/${filename}`;
  const event = await prisma.event.update({ where: { id }, data: { imageUrl } });
  await audit(currentId(request), "UPDATE_EVENT_IMAGE", "Event", id);
  return { imageUrl, event };
});
app.post("/admin/tickets/scan", { preHandler: roles(UserRole.ADMIN, UserRole.RECEPTION, UserRole.ORGANIZER) }, async (request, reply) => {
  const { code } = z.object({ code: z.string() }).parse(request.body); const token = request.user as TokenUser;
  const ticket = await prisma.ticket.findUnique({ where: { code }, include: { reservation: { include: { user: true, event: true } } } });
  if (!ticket || ticket.status === TicketStatus.CANCELLED) return reply.code(404).send({ valid: false, reason: "Billet invalide" });
  if (token.role !== UserRole.ADMIN) {
    const staffRestaurantId = token.role === UserRole.ORGANIZER
      ? (await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: token.sub } })).id
      : (await prisma.user.findUniqueOrThrow({ where: { id: token.sub } })).restaurantId;
    if (!staffRestaurantId || ticket.reservation.event.controllerRestaurantId !== staffRestaurantId) return reply.code(403).send({ valid: false, reason: "Ce billet n’appartient pas à l’un de vos événements" });
  }
  if (ticket.status === TicketStatus.USED) return reply.code(409).send({ valid: false, reason: "Billet déjà utilisé", usedAt: ticket.usedAt });
  const usedAt = new Date();
  const updated = await prisma.ticket.updateMany({ where: { id: ticket.id, status: TicketStatus.VALID, usedAt: null }, data: { status: TicketStatus.USED, usedAt } });
  if (updated.count !== 1) return reply.code(409).send({ valid: false, reason: "Billet déjà utilisé" });
  await audit(currentId(request), "SCAN_TICKET", "Ticket", ticket.id); return { valid: true, participant: ticket.reservation.user.displayName, event: ticket.reservation.event.title };
});
