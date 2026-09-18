import Fastify, { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import QRCode from "qrcode";
import Stripe from "stripe";
import { PrismaClient, UserRole, ApplicationStatus, PaymentStatus, TicketStatus, ContactRequestStatus, EventStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CATEGORIES, EVENT_CATEGORY_NAMES } from "@nour/shared";
import { env } from "./env.js";
import { paymentDeadline } from "./domain.js";
import { normalizePhoneNumber } from "./phone.js";
import { createSmsVerificationProvider } from "./sms-verification.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const uploadsDir = path.join(publicDir, "uploads", "events");
await mkdir(uploadsDir, { recursive: true });
const ALLOWED_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const prisma = new PrismaClient();
const app = Fastify({ logger: true });
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
await app.register(cors, { origin: env.WEB_ORIGIN === "*" ? true : env.WEB_ORIGIN.split(","), credentials: true });
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
await app.register(fastifyStatic, { root: publicDir, prefix: "/static/" });
const smsVerification = createSmsVerificationProvider({
  mode: env.SMS_MODE,
  devCode: env.DEV_OTP_CODE,
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN,
  serviceSid: env.TWILIO_VERIFY_SERVICE_SID
});

type TokenUser = { sub: string; role: UserRole; phone: string };
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const auth = async (request: FastifyRequest) => { await request.jwtVerify(); };
const roles = (...allowed: UserRole[]) => async (request: FastifyRequest) => {
  await request.jwtVerify();
  if (!allowed.includes((request.user as TokenUser).role)) throw httpError(403, "Accès non autorisé");
};
const currentId = (request: FastifyRequest) => (request.user as TokenUser).sub;
const audit = (actorId: string | undefined, action: string, entity: string, entityId?: string, metadata?: unknown) => prisma.auditLog.create({ data: { actorId, action, entity, entityId, metadata: metadata as object | undefined } });
const notify = async (userId: string, title: string, body: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.notification.create({ data: { userId, title, body } });
  await prisma.outboxMessage.create({ data: { channel: "SMS", recipient: user.phone, body: `${title} — ${body}` } });
  if (user.email) await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: user.email, subject: title, body } });
};
const assertEventAccess = async (request: FastifyRequest, eventId: string) => {
  const token = request.user as TokenUser;
  if (token.role === UserRole.ADMIN) return prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: token.sub } });
  return prisma.event.findFirstOrThrow({ where: { id: eventId, controllerRestaurantId: restaurant.id } });
};
const ownRestaurant = (token: TokenUser) => token.role === UserRole.ORGANIZER ? prisma.restaurant.findUniqueOrThrow({ where: { ownerId: token.sub } }) : Promise.resolve(null);
const profileAge = (birthDate?: Date | null) => birthDate ? Math.floor((Date.now() - birthDate.getTime()) / 31_557_600_000) : null;
const defaultCategoryImage = (category: string) => EVENT_CATEGORIES.find(c => c.name === category)?.defaultImage ?? EVENT_CATEGORIES[0].defaultImage;
const publicEvent = (event: any, revealAddress = false) => ({
  id: event.id, slug: event.slug, title: event.title, category: event.category, description: event.description,
  startsAt: event.startsAt, endsAt: event.endsAt, district: event.district, address: revealAddress ? event.address : null,
  imageUrl: event.imageUrl ?? defaultCategoryImage(event.category),
  capacity: event.capacity, confirmedCount: event._count?.reservations ?? 0, priceCents: event.priceCents, status: event.status,
  organizer: event.controllerRestaurant ? { id: event.controllerRestaurant.id, name: event.controllerRestaurant.name } : { id: null, name: "Nūr Meet" },
  venue: event.venueRestaurant ? { id: event.venueRestaurant.id, name: event.venueRestaurant.name } : null
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "Données invalides", details: error.flatten() });
  const status = (error as any).statusCode ?? 500;
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error: status >= 500 ? "Erreur interne" : (error as Error).message });
});

app.get("/health", async () => ({ status: "ok", service: "nour-api", smsMode: smsVerification.mode, now: new Date().toISOString() }));

app.post("/auth/request-otp", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 100 : 3, timeWindow: "10 minutes" } } }, async (request) => {
  const input = z.object({ phone: z.string().min(8).max(30) }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  await smsVerification.sendCode(phone);
  if (smsVerification.mode === "mock") {
    await prisma.outboxMessage.create({ data: { channel: "SMS", recipient: phone, body: `Votre code Nūr Meet est ${env.DEV_OTP_CODE}` } });
  }
  return {
    sent: true,
    delivery: smsVerification.mode === "mock" ? "mock" : "sms",
    ...(smsVerification.mode === "mock" ? { devCode: env.DEV_OTP_CODE } : {}),
    expiresInSeconds: 600
  };
});

app.post("/auth/verify-otp", { config: { rateLimit: { max: smsVerification.mode === "mock" ? 100 : 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const input = z.object({ phone: z.string().min(8).max(30), code: z.string().regex(/^\d{6}$/), displayName: z.string().min(2).optional() }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  if (!await smsVerification.checkCode(phone, input.code)) return reply.code(401).send({ error: "Code incorrect ou expiré" });
  let user = await prisma.user.findUnique({ where: { phone }, include: { profile: true } });
  if (!user) user = await prisma.user.create({ data: { phone, displayName: input.displayName ?? "Nouveau membre", profile: { create: { interests: [] } } }, include: { profile: true } });
  if (user.suspendedAt) return reply.code(403).send({ error: "Compte suspendu" });
  const token = app.jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, { expiresIn: "30d" });
  return { token, user: { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, profileCompleted: user.profile?.profileCompleted ?? false } };
});

app.get("/me", { preHandler: auth }, async (request) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentId(request) }, include: { profile: true } });
  return { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, profile: user.profile, age: profileAge(user.profile?.birthDate) };
});

app.patch("/me/profile", { preHandler: auth }, async (request) => {
  const input = z.object({ displayName: z.string().min(2), email: z.string().email().nullable().optional(), birthDate: z.string().optional(), city: z.string().min(2), profession: z.string().optional(), interests: z.array(z.string()).max(12), bio: z.string().max(600).optional() }).parse(request.body);
  const userId = currentId(request);
  const user = await prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName, email: input.email, profile: { upsert: { create: { birthDate: input.birthDate ? new Date(input.birthDate) : null, city: input.city, profession: input.profession, interests: input.interests, bio: input.bio, profileCompleted: true }, update: { birthDate: input.birthDate ? new Date(input.birthDate) : null, city: input.city, profession: input.profession, interests: input.interests, bio: input.bio, profileCompleted: true } } } }, include: { profile: true } });
  await audit(userId, "UPDATE_PROFILE", "User", userId);
  return user;
});

app.get("/events", async (request) => {
  const query = z.object({ category: z.string().optional(), q: z.string().optional() }).parse(request.query);
  const events = await prisma.event.findMany({ where: { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, category: query.category ? query.category : undefined, OR: query.q ? [{ title: { contains: query.q, mode: "insensitive" } }, { description: { contains: query.q, mode: "insensitive" } }] : undefined }, include: { controllerRestaurant: true, venueRestaurant: true, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } }, orderBy: { startsAt: "asc" } });
  return events.map(e => publicEvent(e));
});

app.get("/events/:id", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await prisma.event.findFirstOrThrow({ where: { OR: [{ id }, { slug: id }] }, include: { controllerRestaurant: true, venueRestaurant: true, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } } });
  return publicEvent(event);
});

app.get("/events/:id/call-slots", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return prisma.screeningCall.findMany({ where: { eventId: id, applicationId: null, startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
});

app.get("/events/:id/my-application", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId: currentId(request) } }, include: { call: true, reservation: { include: { payment: true } } } });
  if (!application) return reply.code(404).send({ error: "Aucune candidature pour cet événement" });
  return application;
});

app.post("/events/:id/apply", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { motivation } = z.object({ motivation: z.string().min(30).max(1200) }).parse(request.body);
  const userId = currentId(request);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.profileCompleted) return reply.code(409).send({ error: "Complétez votre profil avant de candidater" });
  const existing = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (existing) return reply.code(409).send({ error: "Une candidature existe déjà pour cet événement", application: existing });
  const application = await prisma.application.create({ data: { eventId: id, userId, motivation } });
  await notify(userId, "Candidature reçue", "Choisissez maintenant un créneau pour votre entretien.");
  await audit(userId, "CREATE_APPLICATION", "Application", application.id);
  return reply.code(201).send(application);
});

app.post("/applications/:id/schedule", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { slotId } = z.object({ slotId: z.string() }).parse(request.body);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId } });
  if (application.status !== ApplicationStatus.PENDING_CALL) return reply.code(409).send({ error: "Un entretien est déjà programmé pour cette candidature" });
  // L'UPDATE conditionné par applicationId: null est atomique côté PostgreSQL : si deux participants
  // réservent le même créneau au même instant, un seul verra count === 1, l'autre reçoit un 409.
  const slot = await prisma.$transaction(async (tx) => {
    const updated = await tx.screeningCall.updateMany({ where: { id: slotId, eventId: application.eventId, applicationId: null }, data: { applicationId: application.id } });
    if (updated.count !== 1) return null;
    await tx.application.update({ where: { id }, data: { status: ApplicationStatus.CALL_SCHEDULED } });
    return tx.screeningCall.findUniqueOrThrow({ where: { id: slotId } });
  });
  if (!slot) return reply.code(409).send({ error: "Ce créneau vient d’être réservé par un autre participant. Choisissez-en un autre." });
  await notify(userId, "Entretien planifié", `Votre appel est prévu le ${slot.startsAt.toLocaleString("fr-FR")}.`);
  return { scheduled: true, slot };
});

app.get("/me/applications", { preHandler: auth }, async (request) => prisma.application.findMany({ where: { userId: currentId(request) }, include: { event: true, call: true, reservation: { include: { payment: true, ticket: true } } }, orderBy: { createdAt: "desc" } }));

app.post("/events/:id/waitlist", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request);
  const position = await prisma.waitlistEntry.count({ where: { eventId: id } }) + 1;
  return prisma.waitlistEntry.upsert({ where: { eventId_userId: { eventId: id, userId } }, update: {}, create: { eventId: id, userId, position } });
});

app.post("/reservations/:id/payment-intent", { preHandler: auth }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Le paiement par carte n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const reservation = await prisma.reservation.findFirstOrThrow({ where: { id, userId }, include: { event: true, application: true, payment: true } });
  if (reservation.application.status !== ApplicationStatus.PAYMENT_PENDING) return reply.code(409).send({ error: "Cette candidature n’est pas en attente de paiement" });
  if (reservation.cancelledAt) return reply.code(409).send({ error: "Cette réservation est annulée" });
  if (reservation.expiresAt < new Date()) return reply.code(409).send({ error: "Le délai de paiement est expiré" });
  if (reservation.payment?.status === PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Cette réservation est déjà payée" });
  const confirmedCount = await prisma.reservation.count({ where: { eventId: reservation.eventId, confirmedAt: { not: null }, cancelledAt: null, id: { not: reservation.id } } });
  if (confirmedCount >= reservation.event.capacity) return reply.code(409).send({ error: "L’événement est désormais complet" });

  let clientSecret: string | null = null;
  if (reservation.payment?.providerRef) {
    const existing = await stripe.paymentIntents.retrieve(reservation.payment.providerRef);
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status)) clientSecret = existing.client_secret;
  }
  if (!clientSecret) {
    const intent = await stripe.paymentIntents.create({
      amount: reservation.event.priceCents,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: { reservationId: reservation.id, applicationId: reservation.applicationId, userId }
    });
    clientSecret = intent.client_secret;
    await prisma.payment.upsert({
      where: { reservationId: reservation.id },
      update: { provider: "stripe", providerRef: intent.id, amountCents: reservation.event.priceCents, status: PaymentStatus.PENDING },
      create: { reservationId: reservation.id, provider: "stripe", providerRef: intent.id, amountCents: reservation.event.priceCents, status: PaymentStatus.PENDING }
    });
  }
  return { clientSecret, amountCents: reservation.event.priceCents };
});

await app.register(async (webhooks) => {
  webhooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  webhooks.post("/webhooks/stripe", async (request, reply) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "Webhook Stripe non configuré" });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, request.headers["stripe-signature"] as string, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return reply.code(400).send({ error: `Signature Stripe invalide : ${(err as Error).message}` });
    }
    if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const reservationId = intent.metadata.reservationId;
      const reservation = reservationId ? await prisma.reservation.findUnique({ where: { id: reservationId }, include: { payment: true, event: true } }) : null;
      if (reservation && reservation.payment?.providerRef === intent.id && reservation.payment.status !== PaymentStatus.SUCCEEDED) {
        if (event.type === "payment_intent.succeeded") {
          const confirmed = await prisma.$transaction(async (tx) => {
            const updated = await tx.payment.updateMany({ where: { reservationId, status: { not: PaymentStatus.SUCCEEDED } }, data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() } });
            if (updated.count !== 1) return false;
            const ticketCode = `NOUR-${randomUUID().toUpperCase()}`;
            await tx.ticket.upsert({ where: { reservationId }, update: {}, create: { reservationId, code: ticketCode } });
            await tx.reservation.update({ where: { id: reservationId }, data: { confirmedAt: new Date() } });
            await tx.application.update({ where: { id: reservation.applicationId }, data: { status: ApplicationStatus.CONFIRMED } });
            return true;
          });
          if (confirmed) {
            await notify(reservation.userId, "Paiement confirmé", `Votre billet pour ${reservation.event.title} est disponible.`);
            await audit(reservation.userId, "PAYMENT_SUCCEEDED", "Reservation", reservationId, { amountCents: reservation.event.priceCents, paymentIntentId: intent.id });
          }
        } else {
          await prisma.payment.updateMany({ where: { reservationId, status: { not: PaymentStatus.SUCCEEDED } }, data: { status: PaymentStatus.FAILED } });
          await audit(reservation.userId, "PAYMENT_FAILED", "Reservation", reservationId, { paymentIntentId: intent.id });
        }
      }
    }
    return reply.send({ received: true });
  });
});

app.get("/me/tickets", { preHandler: auth }, async (request) => {
  const tickets = await prisma.ticket.findMany({ where: { reservation: { userId: currentId(request) } }, include: { reservation: { include: { event: true } } }, orderBy: { createdAt: "desc" } });
  return Promise.all(tickets.map(async t => ({ ...t, qrDataUrl: await QRCode.toDataURL(t.code) })));
});

app.get("/me/share-qr", { preHandler: auth }, async (request) => {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: currentId(request) } });
  return { code: profile.shareCode, qrDataUrl: await QRCode.toDataURL(profile.shareCode) };
});

app.get("/profiles/code/:code", { preHandler: auth }, async (request, reply) => {
  const { code } = z.object({ code: z.string() }).parse(request.params);
  const profile = await prisma.profile.findUnique({ where: { shareCode: code }, include: { user: true } });
  if (!profile || !profile.validatedAt) return reply.code(404).send({ error: "Code invalide ou révoqué" });
  if (profile.userId === currentId(request)) return reply.code(409).send({ error: "Il s’agit de votre propre code" });
  return { userId: profile.userId, displayName: profile.user.displayName, age: profileAge(profile.birthDate), city: profile.city, profession: profile.profession, interests: profile.interests, bio: profile.bio, validated: true };
});

app.post("/contacts/request", { preHandler: auth }, async (request) => {
  const { recipientId } = z.object({ recipientId: z.string() }).parse(request.body); const requesterId = currentId(request);
  const requestRow = await prisma.contactRequest.upsert({ where: { requesterId_recipientId: { requesterId, recipientId } }, update: { status: ContactRequestStatus.PENDING }, create: { requesterId, recipientId } });
  await notify(recipientId, "Nouvelle demande de contact", "Un participant souhaite entrer en contact avec vous.");
  return requestRow;
});

app.get("/me/contact-requests", { preHandler: auth }, async (request) => {
  const userId = currentId(request);
  return prisma.contactRequest.findMany({ where: { OR: [{ requesterId: userId }, { recipientId: userId }] }, include: { requester: { include: { profile: true } }, recipient: { include: { profile: true } } }, orderBy: { createdAt: "desc" } });
});

app.post("/contacts/:id/respond", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const { accept } = z.object({ accept: z.boolean() }).parse(request.body); const userId = currentId(request);
  const contact = await prisma.contactRequest.findFirstOrThrow({ where: { id, recipientId: userId } });
  const updated = await prisma.contactRequest.update({ where: { id }, data: { status: accept ? ContactRequestStatus.ACCEPTED : ContactRequestStatus.REFUSED } });
  if (accept) {
    const conversation = await prisma.conversation.create({ data: { members: { create: [{ userId: contact.requesterId }, { userId: contact.recipientId }] } } });
    await notify(contact.requesterId, "Demande acceptée", "Vous pouvez maintenant échanger des messages.");
    return { contact: updated, conversation };
  }
  return reply.send({ contact: updated });
});

app.get("/conversations", { preHandler: auth }, async (request) => prisma.conversation.findMany({ where: { members: { some: { userId: currentId(request) } } }, include: { members: { include: { user: { include: { profile: true } } } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } }));
app.get("/conversations/:id/messages", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request);
  await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: id, userId } } });
  return prisma.message.findMany({ where: { conversationId: id }, include: { sender: true }, orderBy: { createdAt: "asc" } });
});
app.post("/conversations/:id/messages", { preHandler: auth }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const userId = currentId(request); const { body, imageUrl } = z.object({ body: z.string().max(2000).optional(), imageUrl: z.string().url().optional() }).refine(v => v.body || v.imageUrl).parse(request.body);
  const member = await prisma.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: id, userId } } });
  if (member.blockedAt) throw httpError(403, "Conversation bloquée");
  return prisma.message.create({ data: { conversationId: id, senderId: userId, body, imageUrl }, include: { sender: true } });
});

app.post("/reports", { preHandler: auth }, async (request) => {
  const input = z.object({ reportedId: z.string(), reason: z.string().min(3), details: z.string().max(1000).optional(), block: z.boolean().default(true) }).parse(request.body); const reporterId = currentId(request);
  const report = await prisma.report.create({ data: { reporterId, reportedId: input.reportedId, reason: input.reason, details: input.details } });
  if (input.block) await prisma.conversationMember.updateMany({ where: { userId: reporterId, conversation: { members: { some: { userId: input.reportedId } } } }, data: { blockedAt: new Date() } });
  await audit(reporterId, "CREATE_REPORT", "Report", report.id);
  return report;
});

app.get("/notifications", { preHandler: auth }, async (request) => prisma.notification.findMany({ where: { userId: currentId(request) }, orderBy: { createdAt: "desc" }, take: 50 }));
app.get("/loyalty", { preHandler: auth }, async (request) => {
  const entries = await prisma.loyaltyEntry.findMany({ where: { userId: currentId(request) }, orderBy: { createdAt: "desc" } });
  return { balance: entries.reduce((n, e) => n + e.points, 0), entries };
});

app.get("/restaurants/me", { preHandler: auth }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: currentId(request) } });
  if (!restaurant) return reply.code(404).send({ error: "Aucune demande restaurateur" });
  return restaurant;
});
app.post("/restaurants/apply", { preHandler: auth }, async (request, reply) => {
  const input = z.object({ name: z.string().min(2).max(120), description: z.string().max(1000).optional(), district: z.string().max(120).optional(), address: z.string().max(200).optional(), phone: z.string().max(30).optional() }).parse(request.body);
  const userId = currentId(request);
  const existing = await prisma.restaurant.findUnique({ where: { ownerId: userId } });
  if (existing?.status === "APPROVED") return reply.code(409).send({ error: "Vous êtes déjà restaurateur" });
  if (existing?.status === "PENDING") return reply.code(409).send({ error: "Votre demande est déjà en cours d’examen" });
  const restaurant = await prisma.restaurant.upsert({
    where: { ownerId: userId },
    update: { ...input, status: "PENDING", submittedAt: new Date(), rejectionReason: null, reviewedBy: null },
    create: { ownerId: userId, ...input, status: "PENDING" }
  });
  const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
  await Promise.all(admins.map(a => notify(a.id, "Nouvelle demande restaurateur", `${input.name} souhaite ouvrir un compte professionnel.`)));
  await audit(userId, "APPLY_RESTAURANT", "Restaurant", restaurant.id);
  return reply.code(201).send(restaurant);
});
app.get("/admin/restaurants", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const query = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional() }).parse(request.query);
  return prisma.restaurant.findMany({ where: query.status ? { status: query.status } : undefined, include: { owner: true }, orderBy: { submittedAt: "desc" } });
});
app.post("/admin/restaurants/:id/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, reason } = z.object({ accept: z.boolean(), reason: z.string().max(1000).optional() }).parse(request.body);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id }, include: { owner: true } });
  if (restaurant.status !== "PENDING") return reply.code(409).send({ error: "Cette demande a déjà été traitée" });
  const adminId = currentId(request);
  if (accept) {
    const [updated] = await prisma.$transaction([
      prisma.restaurant.update({ where: { id }, data: { status: "APPROVED", verifiedAt: new Date(), reviewedBy: adminId, rejectionReason: null } }),
      prisma.user.update({ where: { id: restaurant.ownerId }, data: { role: restaurant.owner.role === UserRole.PARTICIPANT ? UserRole.ORGANIZER : restaurant.owner.role } })
    ]);
    await notify(restaurant.ownerId, "Compte restaurateur approuvé", "Votre établissement est validé, vous pouvez préparer vos événements.");
    await audit(adminId, "APPROVE_RESTAURANT", "Restaurant", id);
    return updated;
  }
  const updated = await prisma.restaurant.update({ where: { id }, data: { status: "REJECTED", reviewedBy: adminId, rejectionReason: reason ?? null } });
  await notify(restaurant.ownerId, "Demande restaurateur refusée", reason ?? "Votre demande n’a pas été retenue.");
  await audit(adminId, "REJECT_RESTAURANT", "Restaurant", id, { reason });
  return updated;
});

app.get("/admin/dashboard", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const eventScope = restaurant ? { controllerRestaurantId: restaurant.id } : undefined;
  const [events, applications, payments] = await Promise.all([
    prisma.event.count({ where: eventScope }),
    prisma.application.count({ where: restaurant ? { event: { controllerRestaurantId: restaurant.id } } : undefined }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, ...(restaurant ? { reservation: { event: { controllerRestaurantId: restaurant.id } } } : {}) }, _sum: { amountCents: true } })
  ]);
  // Les signalements de modération concernent des comptes utilisateurs, pas un restaurant précis : réservés au super-admin.
  const openReports = restaurant ? null : await prisma.report.count({ where: { status: "OPEN" } });
  return { events, applications, revenueCents: payments._sum.amountCents ?? 0, openReports };
});
app.get("/admin/applications", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  return prisma.application.findMany({ where: restaurant ? { event: { controllerRestaurantId: restaurant.id } } : undefined, include: { user: { include: { profile: true } }, event: true, call: true, reservation: { include: { payment: true } } }, orderBy: { createdAt: "desc" } });
});
app.post("/admin/applications/:id/decision", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params); const { accept, notes } = z.object({ accept: z.boolean(), notes: z.string().max(1000).optional() }).parse(request.body);
  const application = await prisma.application.findUniqueOrThrow({ where: { id }, include: { event: { include: { controllerRestaurant: true } } } });
  const token = request.user as TokenUser;
  if (token.role === UserRole.ORGANIZER && application.event.controllerRestaurant?.ownerId !== token.sub) throw httpError(403, "Cette candidature appartient à un autre restaurateur");
  if (!accept) { const refused = await prisma.application.update({ where: { id }, data: { status: ApplicationStatus.REFUSED, notes, decidedAt: new Date() } }); await notify(application.userId, "Candidature examinée", "Votre candidature n’a pas été retenue pour cet événement."); return refused; }
  const occupied = await prisma.reservation.count({ where: { eventId: application.eventId, cancelledAt: null } });
  if (occupied >= application.event.capacity) throw httpError(409, "L’événement est complet. Proposez la liste d’attente.");
  const reservation = await prisma.reservation.upsert({ where: { applicationId: id }, update: { expiresAt: paymentDeadline() }, create: { eventId: application.eventId, userId: application.userId, applicationId: id, expiresAt: paymentDeadline() } });
  await prisma.application.update({ where: { id }, data: { status: ApplicationStatus.PAYMENT_PENDING, notes, decidedAt: new Date() } });
  await notify(application.userId, "Candidature acceptée", `Vous avez 24 heures pour payer votre billet de ${(application.event.priceCents / 100).toFixed(2)} €.`);
  await audit(currentId(request), "ACCEPT_APPLICATION", "Application", id);
  return { accepted: true, reservation };
});
app.get("/admin/events", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const events = await prisma.event.findMany({ where: restaurant ? { controllerRestaurantId: restaurant.id } : undefined, orderBy: { startsAt: "asc" } });
  return events.map(e => ({ ...e, imageUrl: e.imageUrl ?? defaultCategoryImage(e.category) }));
});
app.get("/admin/events/:id/call-slots", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  return prisma.screeningCall.findMany({ where: { eventId: id }, include: { application: { include: { user: true } } }, orderBy: { startsAt: "asc" } });
});
app.post("/admin/events/:id/call-slots/generate", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
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
  const existing = await prisma.screeningCall.findMany({ where: { eventId: id, startsAt: { gte: dayStart, lt: dayEnd } }, select: { startsAt: true } });
  const existingTimes = new Set(existing.map(s => s.startsAt.getTime()));
  const toCreate = candidates.filter(c => !existingTimes.has(c.startsAt.getTime()));
  if (toCreate.length > 0) await prisma.screeningCall.createMany({ data: toCreate.map(c => ({ eventId: id, startsAt: c.startsAt, endsAt: c.endsAt })) });
  await audit(currentId(request), "GENERATE_CALL_SLOTS", "Event", id, { date: input.date, created: toCreate.length });
  return reply.code(201).send({ created: toCreate.length, skipped: candidates.length - toCreate.length });
});
app.delete("/admin/events/:id/call-slots/:slotId", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id, slotId } = z.object({ id: z.string(), slotId: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  const deleted = await prisma.screeningCall.deleteMany({ where: { id: slotId, eventId: id, applicationId: null } });
  if (deleted.count === 0) return reply.code(409).send({ error: "Ce créneau est réservé ou introuvable : il ne peut pas être supprimé" });
  return reply.code(204).send();
});
app.post("/admin/events", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const input = z.object({ venueRestaurantId: z.string().optional(), title: z.string().min(3), slug: z.string().regex(/^[a-z0-9-]+$/), category: z.enum(EVENT_CATEGORY_NAMES as [string, ...string[]]), description: z.string().min(20), startsAt: z.string(), endsAt: z.string(), district: z.string(), address: z.string(), capacity: z.number().int().min(5).max(500), priceCents: z.number().int().min(0), publish: z.boolean().default(false) }).parse(request.body);
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
    title: input.title, slug: input.slug, category: input.category, description: input.description,
    startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), district: input.district, address: input.address,
    capacity: input.capacity, priceCents: input.priceCents,
    controllerRestaurantId: restaurant?.id ?? null,
    venueRestaurantId,
    status: token.role === UserRole.ADMIN && input.publish ? EventStatus.PUBLISHED : EventStatus.DRAFT
  } });
  await audit(currentId(request), "CREATE_EVENT", "Event", event.id); return event;
});
app.post("/admin/events/:id/submit-for-review", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  if (event.status !== EventStatus.DRAFT) return reply.code(409).send({ error: "Seul un événement en brouillon peut être soumis" });
  const updated = await prisma.event.update({ where: { id }, data: { status: EventStatus.PENDING_REVIEW, submittedForReviewAt: new Date(), reviewNote: null } });
  const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
  await Promise.all(admins.map(a => notify(a.id, "Événement à valider", `« ${event.title} » attend votre validation avant publication.`)));
  await audit(currentId(request), "SUBMIT_EVENT_FOR_REVIEW", "Event", id);
  return updated;
});
app.post("/admin/events/:id/review-decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, note } = z.object({ accept: z.boolean(), note: z.string().max(1000).optional() }).parse(request.body);
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { controllerRestaurant: true } });
  if (event.status !== EventStatus.PENDING_REVIEW) return reply.code(409).send({ error: "Cet événement n’est pas en attente de validation" });
  const updated = await prisma.event.update({ where: { id }, data: { status: accept ? EventStatus.PUBLISHED : EventStatus.DRAFT, reviewedAt: new Date(), reviewNote: note ?? null } });
  if (event.controllerRestaurant) await notify(event.controllerRestaurant.ownerId, accept ? "Événement publié" : "Événement renvoyé en brouillon", accept ? `« ${event.title} » est maintenant publié.` : `« ${event.title} » nécessite des modifications${note ? ` : ${note}` : "."}`);
  await audit(currentId(request), accept ? "APPROVE_EVENT" : "REJECT_EVENT", "Event", id, { note });
  return updated;
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
app.get("/admin/outbox", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.outboxMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));

const close = async () => { await prisma.$disconnect(); await app.close(); };
process.on("SIGINT", close); process.on("SIGTERM", close);
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
