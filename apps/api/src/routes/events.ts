import { EventStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { app, prisma } from "../context.js";
import { env } from "../env.js";
import { paginated, paginationQuery, toSkipTake } from "../pagination.js";
import { TokenUser, auth, currentId, optionalAuth } from "../services/auth.js";
import { publicEvent, viewerStatuses } from "../services/events.js";

// Corrections web 2026-09-24 (§5) : uniquement les événements à venir, du plus proche au plus éloigné
// (tri SQL sur la colonne startsAt, un vrai horodatage), avec le statut du visiteur connecté.
app.get("/events", { preHandler: optionalAuth }, async (request) => {
  const query = z.object({ category: z.string().optional(), q: z.string().optional() }).merge(paginationQuery).parse(request.query);
  const where = { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, startsAt: { gt: new Date() }, category: query.category ? query.category : undefined, OR: query.q ? [{ title: { contains: query.q, mode: "insensitive" as const } }, { description: { contains: query.q, mode: "insensitive" as const } }, { district: { contains: query.q, mode: "insensitive" as const } }] : undefined };
  const viewerId = request.user ? currentId(request) : null;
  const viewerCategory = viewerId ? (await prisma.profile.findUnique({ where: { userId: viewerId } }))?.quotaCategory ?? null : null;
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, include: { controllerRestaurant: { include: { subscription: { include: { plan: true } } } }, venueRestaurant: true, quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } }, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], ...toSkipTake(query) }),
    prisma.event.count({ where })
  ]);
  const statuses = await viewerStatuses(viewerId, events.map(e => e.id));
  return paginated(events.map(e => ({ ...publicEvent(e, false, viewerCategory), viewerStatus: statuses.get(e.id) ?? null })), total, query);
});

app.get("/events/:id", { preHandler: optionalAuth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await prisma.event.findFirstOrThrow({ where: { OR: [{ id }, { slug: id }] }, include: { controllerRestaurant: true, venueRestaurant: true, quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } }, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } } });
  const viewerId = request.user ? currentId(request) : null;
  // Un brouillon ou un événement en attente de validation n'est visible que de l'administration et du
  // restaurateur qui l'organise, jamais par simple connaissance de son identifiant (revue de sécurité).
  if (event.status === EventStatus.DRAFT || event.status === EventStatus.PENDING_REVIEW) {
    const token = request.user as TokenUser | undefined;
    const isOwner = !!token && !!event.controllerRestaurant && event.controllerRestaurant.ownerId === token.sub;
    if (token?.role !== "ADMIN" && !isOwner) return reply.code(404).send({ error: "Ressource introuvable" });
  }
  const viewerCategory = viewerId ? (await prisma.profile.findUnique({ where: { userId: viewerId } }))?.quotaCategory ?? null : null;
  const statuses = await viewerStatuses(viewerId, [event.id]);
  return { ...publicEvent(event, false, viewerCategory), viewerStatus: statuses.get(event.id) ?? null };
});

app.get("/events/:id/my-application", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId: currentId(request) } }, include: { call: true, reservation: { include: { payment: true } }, networkingAnswer: true } });
  if (!application) return reply.code(404).send({ error: "Aucune inscription pour cet événement" });
  return application;
});

// Partage « J'y vais, viens avec moi » (§12) : un code non sensible par (personne, événement),
// jamais l'identité de la personne dans le lien lui-même. Le clic est compté par n'importe qui
// (route publique) ; l'inscription et l'achat attribués se lisent depuis les Application liées.
app.post("/events/:id/share-link", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const event = await prisma.event.findUniqueOrThrow({ where: { id } });
  const link = await prisma.shareLink.upsert({
    where: { userId_eventId: { userId, eventId: id } },
    update: {},
    create: { userId, eventId: id, code: randomUUID().replace(/-/g, "").slice(0, 12) }
  });
  return { code: link.code, url: `${env.WEB_ORIGIN}/events/${event.slug}?ref=${link.code}` };
});
// §19/§20 : point public sans authentification, donc directement exposé à un abus par bot pour
// gonfler artificiellement des statistiques de partage — limité par IP comme les autres routes
// publiques sensibles (OTP, génération IA), jamais laissé illimité.
app.post("/share-links/:code/click", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const { code } = z.object({ code: z.string() }).parse(request.params);
  const updated = await prisma.shareLink.updateMany({ where: { code }, data: { clicks: { increment: 1 } } });
  if (updated.count === 0) return reply.code(404).send({ error: "Lien de partage introuvable" });
  return reply.code(204).send();
});
