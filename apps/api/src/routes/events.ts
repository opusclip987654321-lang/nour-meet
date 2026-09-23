import rateLimit from "@fastify/rate-limit";
import { EventStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { app, prisma } from "../context.js";
import { env } from "../env.js";
import { paginated, paginationQuery, toSkipTake } from "../pagination.js";
import { auth, currentId, optionalAuth } from "../services/auth.js";
import { publicEvent } from "../services/events.js";

app.get("/events", { preHandler: optionalAuth }, async (request) => {
  const query = z.object({ category: z.string().optional(), q: z.string().optional() }).merge(paginationQuery).parse(request.query);
  const where = { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, category: query.category ? query.category : undefined, OR: query.q ? [{ title: { contains: query.q, mode: "insensitive" as const } }, { description: { contains: query.q, mode: "insensitive" as const } }] : undefined };
  const viewerCategory = request.user ? (await prisma.profile.findUnique({ where: { userId: currentId(request) } }))?.quotaCategory ?? null : null;
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, include: { controllerRestaurant: { include: { subscription: { include: { plan: true } } } }, venueRestaurant: true, quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } }, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } }, orderBy: { startsAt: "asc" }, ...toSkipTake(query) }),
    prisma.event.count({ where })
  ]);
  return paginated(events.map(e => publicEvent(e, false, viewerCategory)), total, query);
});

app.get("/events/:id", { preHandler: optionalAuth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await prisma.event.findFirstOrThrow({ where: { OR: [{ id }, { slug: id }] }, include: { controllerRestaurant: true, venueRestaurant: true, quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } }, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } } });
  const viewerCategory = request.user ? (await prisma.profile.findUnique({ where: { userId: currentId(request) } }))?.quotaCategory ?? null : null;
  return publicEvent(event, false, viewerCategory);
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
