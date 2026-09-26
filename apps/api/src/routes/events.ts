import { parisDateTime } from "@nour/shared";
import { EventStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { app, emailProvider, prisma, publicDir } from "../context.js";
import { SITE_ORIGIN, env } from "../env.js";
import { audit } from "../services/audit.js";
import { renderEmail } from "../services/email-layout.js";
import { loadImage } from "../services/instagram.js";
import { paginated, paginationQuery, toSkipTake } from "../pagination.js";
import { TokenUser, auth, currentId, optionalAuth } from "../services/auth.js";
import { applicationAmountCents, defaultCategoryImage, publicEvent, viewerStatuses } from "../services/events.js";

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
  const application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId: currentId(request) } }, include: { call: true, reservation: { include: { payment: true } }, networkingAnswer: true, event: { include: { priceTiers: true } } } });
  if (!application) return reply.code(404).send({ error: "Aucune inscription pour cet événement" });
  const { event, notes: _notes, ...rest } = application;
  return { ...rest, amountCents: event ? applicationAmountCents(event, application.quotaCategory) : null };
});

// Partage « J'y vais, viens avec moi » (§12) : un code non sensible par (personne, événement),
// jamais l'identité de la personne dans le lien lui-même. Le clic est compté par n'importe qui
// (route publique) ; l'inscription et l'achat attribués se lisent depuis les Application liées.
// Lien de partage attribué (§12), toujours absolu vers le site de production (SITE_ORIGIN).
async function shareLinkFor(userId: string, event: { id: string; slug: string }) {
  const link = await prisma.shareLink.upsert({
    where: { userId_eventId: { userId, eventId: event.id } },
    update: {},
    create: { userId, eventId: event.id, code: randomUUID().replace(/-/g, "").slice(0, 12) }
  });
  return { code: link.code, url: `${SITE_ORIGIN}/events/${event.slug}?ref=${link.code}` };
}

app.post("/events/:id/share-link", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await prisma.event.findUniqueOrThrow({ where: { id } });
  return shareLinkFor(currentId(request), event);
});

const shareableWhere = { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, startsAt: { gt: new Date() } };

// Image d'un événement pour un e-mail (v3 §4.3) : JPEG 1200 × 630, lisible par tous les clients (Outlook
// n'affiche pas le WebP). Seulement pour un événement publié, et seulement l'image de l'événement.
app.get("/events/:slug/email-image.jpg", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
  const { slug } = z.object({ slug: z.string().max(200) }).parse(request.params);
  const event = await prisma.event.findFirst({ where: { slug, status: { in: [EventStatus.PUBLISHED, EventStatus.FULL, EventStatus.COMPLETED] } } });
  if (!event) return reply.code(404).send({ error: "Événement introuvable" });
  const source = await loadImage(event.imageUrl ?? defaultCategoryImage(event.category), { publicDir, webOrigin: SITE_ORIGIN });
  const jpeg = await sharp(source).resize(1200, 630, { fit: "cover", position: "attention" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return reply.header("Content-Type", "image/jpeg").header("Cache-Control", "public, max-age=86400").send(jpeg);
});

const priceLabel = (cents: number) => cents === 0 ? "Gratuit" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
// E-mail d'invitation (v3 §4.3) : un vrai e-mail Nūr Meet (logo, image, nom, date, lieu, prix, court
// texte et bouton « Voir l'événement » vers la fiche publique de production), sans ton publicitaire.
export function inviteEmail(event: { title: string; slug: string; startsAt: Date; district: string; priceCents: number; category: string; venueRestaurant?: { name: string } | null }, senderName: string, url: string, personalNote?: string) {
  const subject = `${senderName} vous invite : « ${event.title} »`;
  const content = renderEmail({
    preheader: `${parisDateTime(event.startsAt)} · ${event.district} — une soirée Nūr Meet en petit comité.`,
    heading: event.title,
    image: { url: `${env.API_PUBLIC_URL ?? SITE_ORIGIN}/events/${event.slug}/email-image.jpg`, alt: event.title },
    paragraphs: [
      `${senderName} a pensé à vous et vous invite à cette soirée Nūr Meet : un moment en petit comité, dans un restaurant partenaire, pour faire de vraies rencontres${event.category === "Networking" ? " professionnelles" : ""}.`,
      ...(personalNote ? [`« ${personalNote} » — ${senderName}`] : [])
    ],
    details: [
      { label: "Date", value: parisDateTime(event.startsAt) },
      { label: "Lieu", value: event.venueRestaurant ? `${event.venueRestaurant.name} · ${event.district}` : event.district },
      { label: "Prix", value: priceLabel(event.priceCents) }
    ],
    cta: { label: "Voir l’événement", url }
  });
  return { subject, ...content };
}

// Invitation par e-mail (v3 §4.3) : réservée aux personnes connectées, bornée (10 par heure et 20 par
// jour, jamais deux fois la même adresse pour le même événement, jamais à soi-même) pour que le site ne
// devienne pas un relais d'envoi. Le mot personnel est limité et débarrassé de tout lien.
app.post("/events/:id/invite-by-email", { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ email: z.string().trim().toLowerCase().email().max(200), note: z.string().trim().max(300).optional() }).parse(request.body);
  const userId = currentId(request);
  const [sender, event] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true, email: true } }),
    prisma.event.findFirst({ where: { id, ...shareableWhere }, include: { venueRestaurant: { select: { name: true } } } })
  ]);
  if (!event) return reply.code(404).send({ error: "Cet événement ne peut plus être partagé." });
  if (sender.email && sender.email.toLowerCase() === input.email) return reply.code(400).send({ error: "Saisissez l’adresse de la personne à inviter, pas la vôtre." });
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  if (await prisma.auditLog.count({ where: { actorId: userId, action: "INVITE_BY_EMAIL", createdAt: { gt: since } } }) >= 20) return reply.code(429).send({ error: "Vous avez atteint la limite d’invitations pour aujourd’hui." });
  const { url } = await shareLinkFor(userId, event);
  const email = inviteEmail(event, sender.displayName.split(/\s+/)[0], url, input.note?.replace(/https?:\/\/\S+|www\.\S+/gi, "").trim() || undefined);
  if (await prisma.outboxMessage.findFirst({ where: { channel: "EMAIL", recipient: input.email, subject: email.subject } })) return reply.code(409).send({ error: "Cette personne a déjà reçu votre invitation pour cet événement." });
  const outbox = await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: input.email, subject: email.subject, body: email.text } });
  try {
    await emailProvider.send(input.email, email.subject, email.text, email.html);
    if (emailProvider.mode === "resend") await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: "SENT", sentAt: new Date() } });
  } catch (err) {
    await prisma.outboxMessage.update({ where: { id: outbox.id }, data: { status: "FAILED", error: (err as Error).message } });
    request.log.warn({ err }, "Échec d'envoi d'une invitation par e-mail");
    return reply.code(502).send({ error: "L’invitation n’a pas pu être envoyée. Réessayez dans quelques minutes." });
  }
  await audit(userId, "INVITE_BY_EMAIL", "Event", event.id);
  return reply.code(201).send({ sent: true });
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
