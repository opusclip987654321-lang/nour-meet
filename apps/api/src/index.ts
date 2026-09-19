import Fastify, { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import QRCode from "qrcode";
import Stripe from "stripe";
import { PrismaClient, Prisma, UserRole, ApplicationStatus, PaymentStatus, TicketStatus, ContactRequestStatus, EventStatus, QuotaCategory, AlternativeOfferStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CATEGORIES, EVENT_CATEGORY_NAMES, QUOTA_ELIGIBLE_CATEGORY, EVENT_ZONES, regionOfZone } from "@nour/shared";
import { env } from "./env.js";
import { paymentDeadline, interviewRetryDate } from "./domain.js";
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
// méthodes explicitement listées : par défaut, ce plugin n'autorise que GET/HEAD/POST en CORS, ce qui
// bloquait silencieusement depuis un vrai navigateur tous les appels PATCH/PUT/DELETE (annulation de
// candidature côté navigateur, sortie de liste d'attente, mise à jour de profil, etc.) — invisible en
// curl, qui ne fait pas respecter le CORS.
await app.register(cors, { origin: env.WEB_ORIGIN === "*" ? true : env.WEB_ORIGIN.split(","), credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
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
// Un champ optionnel envoyé comme chaîne vide par un formulaire (nom non renseigné) doit être traité
// comme absent, pas comme une valeur invalide.
const optionalName = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().min(2).max(80).optional());
// Le rôle et l'état du compte sont vérifiés en base à chaque requête (pas seulement via les
// informations figées dans le jeton, valide 30 jours) : une promotion, une rétrogradation ou une
// suspension prend effet immédiatement, sans attendre l'expiration du jeton.
const loadCurrentUser = async (request: FastifyRequest) => {
  await request.jwtVerify();
  const token = request.user as TokenUser;
  const current = await prisma.user.findUniqueOrThrow({ where: { id: token.sub } });
  if (current.suspendedAt) throw httpError(403, "Compte suspendu");
  token.role = current.role;
};
const auth = async (request: FastifyRequest) => { await loadCurrentUser(request); };
const roles = (...allowed: UserRole[]) => async (request: FastifyRequest) => {
  await loadCurrentUser(request);
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
type ClaimableApplication = { id: string; userId: string; quotaCategory: QuotaCategory | null };
type ClaimResult = { ok: true; reservation: Awaited<ReturnType<typeof prisma.reservation.upsert>> } | { ok: false; reason: "NO_CATEGORY" | "FULL" };

// Attribue une place de manière atomique (créneau à quota ou capacité globale) et pose une réservation
// temporaire. Pour les événements à quotas, l'atomicité vient de l'UPDATE conditionné sur heldCount < capacity
// (comme pour les créneaux d'entretien). Pour la capacité globale (sans quota), on utilise une transaction
// PostgreSQL sérialisable pour empêcher toute survente en cas de réservations simultanées.
const claimReservation = async (eventId: string, application: ClaimableApplication): Promise<ClaimResult> => {
  const hasQuotas = (await prisma.eventQuota.count({ where: { eventId } })) > 0;
  const run = async (tx: Prisma.TransactionClient): Promise<ClaimResult> => {
    if (hasQuotas) {
      if (!application.quotaCategory) return { ok: false, reason: "NO_CATEGORY" };
      const quota = await tx.eventQuota.findUnique({ where: { eventId_category: { eventId, category: application.quotaCategory } } });
      if (!quota) return { ok: false, reason: "NO_CATEGORY" };
      const updated = await tx.eventQuota.updateMany({ where: { id: quota.id, heldCount: { lt: quota.capacity } }, data: { heldCount: { increment: 1 } } });
      if (updated.count !== 1) return { ok: false, reason: "FULL" };
    } else {
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
      const occupied = await tx.reservation.count({ where: { eventId, cancelledAt: null, applicationId: { not: application.id } } });
      if (occupied >= event.capacity) return { ok: false, reason: "FULL" };
    }
    const reservation = await tx.reservation.upsert({
      where: { applicationId: application.id },
      update: { expiresAt: paymentDeadline(), cancelledAt: null, quotaCategory: application.quotaCategory },
      create: { eventId, userId: application.userId, applicationId: application.id, expiresAt: paymentDeadline(), quotaCategory: application.quotaCategory }
    });
    await tx.application.update({ where: { id: application.id }, data: { status: ApplicationStatus.PAYMENT_PENDING } });
    return { ok: true, reservation };
  };
  try {
    return await prisma.$transaction(run, hasQuotas ? undefined : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if ((err as { code?: string }).code === "P2034") return { ok: false, reason: "FULL" };
    throw err;
  }
};

// Libère la place tenue par une réservation (quota ou capacité globale), annule la candidature associée
// si elle était en attente de paiement, et retire l'entrée de liste d'attente correspondante le cas échéant.
const releaseReservationSlot = async (tx: Prisma.TransactionClient, reservation: { id: string; eventId: string; applicationId: string; quotaCategory: QuotaCategory | null }) => {
  await tx.reservation.update({ where: { id: reservation.id }, data: { cancelledAt: new Date() } });
  await tx.application.updateMany({ where: { id: reservation.applicationId, status: ApplicationStatus.PAYMENT_PENDING }, data: { status: ApplicationStatus.CANCELLED } });
  await tx.waitlistEntry.deleteMany({ where: { applicationId: reservation.applicationId } });
  if (reservation.quotaCategory) {
    await tx.eventQuota.updateMany({ where: { eventId: reservation.eventId, category: reservation.quotaCategory, heldCount: { gt: 0 } }, data: { heldCount: { decrement: 1 } } });
  }
};

// Dès qu'une place se libère, la propose automatiquement au premier inscrit (ordre chronologique) de la
// liste d'attente correspondante, avec le même délai de paiement que pour une acceptation classique.
// La catégorie ne partitionne la liste d'attente que si l'événement a de vrais quotas : un tarif
// différencié seul (sans quota) ne doit jamais créer de file d'attente séparée par catégorie.
const offerNextWaitlistEntry = async (eventId: string, category: QuotaCategory | null) => {
  const hasQuotas = (await prisma.eventQuota.count({ where: { eventId } })) > 0;
  const entry = await prisma.waitlistEntry.findFirst({ where: { eventId, offeredAt: null, ...(hasQuotas ? { quotaCategory: category } : {}) }, orderBy: { createdAt: "asc" }, include: { application: true } });
  if (!entry) return;
  const result = await claimReservation(eventId, entry.application);
  if (!result.ok) return;
  await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { offeredAt: new Date(), expiresAt: result.reservation.expiresAt } });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  await notify(entry.userId, "Une place s’est libérée !", `Une place pour « ${event.title} » vous est proposée. Vous avez ${formatPaymentDeadline(result.reservation.expiresAt)} pour régler votre billet, sans quoi elle sera proposée au participant suivant.`);
};

// Une place existe réellement pour cette catégorie (ou en capacité globale si l'événement n'a pas
// de quotas) : condition nécessaire avant de proposer un événement alternatif, pour que la personne
// ne se retrouve pas de nouveau sur liste d'attente en l'acceptant.
const hasAvailableSpace = async (event: { id: string; capacity: number }, quotaCategory: QuotaCategory | null) => {
  const quotas = await prisma.eventQuota.findMany({ where: { eventId: event.id } });
  if (quotas.length > 0) {
    if (!quotaCategory) return false;
    const tier = quotas.find(q => q.category === quotaCategory);
    return !!tier && tier.heldCount < tier.capacity;
  }
  const occupied = await prisma.reservation.count({ where: { eventId: event.id, cancelledAt: null } });
  return occupied < event.capacity;
};
// Propose automatiquement un événement alternatif lorsqu'un participant ne peut pas obtenir de
// place, selon trois critères : même thème (catégorie), même région géographique (ex. Île-de-France
// — pas la zone précise, pour élargir les possibilités), et une place réellement disponible pour sa
// catégorie (sinon il se retrouverait aussitôt de nouveau sur liste d'attente). Un restaurateur ne
// propose jamais l'événement d'un concurrent, et Nour ne propose que ses propres événements :
// l'alternative doit avoir le même controllerRestaurantId (y compris null pour les événements
// organisés directement par Nour). Ne crée jamais deux propositions actives pour le même événement
// d'origine. Entièrement automatique : aucune proposition manuelle pour l'instant.
const createAlternativeOfferIfPossible = async (userId: string, originalEvent: { id: string; category: string; zone: string | null; controllerRestaurantId: string | null }) => {
  if (!originalEvent.zone) return null;
  const existingPending = await prisma.alternativeOffer.findFirst({ where: { userId, originalEventId: originalEvent.id, status: AlternativeOfferStatus.PENDING } });
  if (existingPending) return null;
  const region = regionOfZone(originalEvent.zone);
  const zonesInRegion = EVENT_ZONES.filter(z => regionOfZone(z) === region);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  const candidates = await prisma.event.findMany({
    where: { id: { not: originalEvent.id }, category: originalEvent.category, zone: { in: zonesInRegion }, controllerRestaurantId: originalEvent.controllerRestaurantId, status: EventStatus.PUBLISHED, startsAt: { gt: new Date() }, applications: { none: { userId } } },
    orderBy: { startsAt: "asc" },
    take: 10
  });
  let alternative: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (await hasAvailableSpace(candidate, profile?.quotaCategory ?? null)) { alternative = candidate; break; }
  }
  if (!alternative) return null;
  const offer = await prisma.alternativeOffer.create({ data: { userId, originalEventId: originalEvent.id, alternativeEventId: alternative.id, respondsBy: paymentDeadline() } });
  await notify(userId, "Un événement similaire pourrait vous intéresser", `« ${alternative.title} » (${alternative.district}, ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(alternative.startsAt)}) a des places disponibles.`);
  return offer;
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
// Un événement sans tarif différencié pour la catégorie du participant garde le tarif unique
// (event.priceCents). La différenciation homme/femme reste donc toujours facultative.
const resolvePriceCents = (event: { priceCents: number; priceTiers?: { category: QuotaCategory; amountCents: number }[] }, quotaCategory: QuotaCategory | null) => {
  const tier = quotaCategory ? event.priceTiers?.find(t => t.category === quotaCategory) : undefined;
  return tier ? tier.amountCents : event.priceCents;
};
// Le délai de paiement est fixé à 24h pour tous les événements (choix explicite du super-admin :
// un participant est déjà validé au téléphone avant de pouvoir s'inscrire, 24h suffit et évite de
// bloquer une place trop longtemps). La date précise est toujours indiquée en plus, sans calcul à faire.
const formatPaymentDeadline = (expiresAt: Date) => `24 heures (jusqu’au ${expiresAt.toLocaleString("fr-FR")})`;
const publicEvent = (event: any, revealAddress = false) => ({
  id: event.id, slug: event.slug, title: event.title, category: event.category, description: event.description,
  startsAt: event.startsAt, endsAt: event.endsAt, district: event.district, address: revealAddress ? event.address : null,
  zone: event.zone ?? null,
  imageUrl: event.imageUrl ?? defaultCategoryImage(event.category),
  photos: (event.photos ?? []).map((p: any) => p.url),
  perks: { drink: event.includesDrink, starter: event.includesStarter, main: event.includesMain, dessert: event.includesDessert, description: event.perksDescription ?? null },
  capacity: event.capacity, confirmedCount: event._count?.reservations ?? 0, priceCents: event.priceCents, status: event.status,
  priceTiers: (event.priceTiers ?? []).map((t: any) => ({ category: t.category, amountCents: t.amountCents })),
  proposedStartsAt: event.proposedStartsAt ?? null, proposedEndsAt: event.proposedEndsAt ?? null,
  organizer: event.controllerRestaurant ? { id: event.controllerRestaurant.id, name: event.controllerRestaurant.name } : { id: null, name: "Nūr Meet" },
  venue: event.venueRestaurant ? { id: event.venueRestaurant.id, name: event.venueRestaurant.name } : null,
  quotas: (event.quotas ?? []).map((q: any) => ({ category: q.category, capacity: q.capacity, heldCount: q.heldCount }))
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
  const input = z.object({ displayName: z.string().min(2), email: z.string().email().nullable().optional(), birthDate: z.string().optional(), city: z.string().min(2), profession: z.string().optional(), interests: z.array(z.string()).max(12), bio: z.string().max(600).optional(), quotaCategory: z.enum(["HOMME", "FEMME"]).nullable().optional() }).parse(request.body);
  const userId = currentId(request);
  const profileData = { birthDate: input.birthDate ? new Date(input.birthDate) : null, city: input.city, profession: input.profession, interests: input.interests, bio: input.bio, quotaCategory: input.quotaCategory, profileCompleted: true };
  const user = await prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName, email: input.email, profile: { upsert: { create: profileData, update: profileData } } }, include: { profile: true } });
  await audit(userId, "UPDATE_PROFILE", "User", userId);
  return user;
});

app.get("/events", async (request) => {
  const query = z.object({ category: z.string().optional(), q: z.string().optional() }).parse(request.query);
  const events = await prisma.event.findMany({ where: { status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, category: query.category ? query.category : undefined, OR: query.q ? [{ title: { contains: query.q, mode: "insensitive" } }, { description: { contains: query.q, mode: "insensitive" } }] : undefined }, include: { controllerRestaurant: true, venueRestaurant: true, quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } }, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } }, orderBy: { startsAt: "asc" } });
  return events.map(e => publicEvent(e));
});

app.get("/events/:id", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await prisma.event.findFirstOrThrow({ where: { OR: [{ id }, { slug: id }] }, include: { controllerRestaurant: true, venueRestaurant: true, quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } }, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } } });
  return publicEvent(event);
});

app.get("/events/:id/my-application", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId: currentId(request) } }, include: { call: true, reservation: { include: { payment: true } } } });
  if (!application) return reply.code(404).send({ error: "Aucune inscription pour cet événement" });
  return application;
});

// Inscription directe : un profil déjà validé (entretien global réussi) s'inscrit à un événement
// précis sans nouvel entretien ni décision manuelle — la place est immédiatement tentée (quota ou
// capacité globale) ; si complet, la personne rejoint automatiquement la liste d'attente.
app.post("/events/:id/apply", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.profileCompleted) return reply.code(409).send({ error: "Complétez votre profil avant de vous inscrire" });
  if (!profile.validatedAt) return reply.code(409).send({ error: "Votre profil doit d’abord être validé lors d’un entretien avant de vous inscrire à un événement" });
  const existing = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (existing) return reply.code(409).send({ error: "Vous êtes déjà inscrit(e) à cet événement", application: existing });
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { priceTiers: true } });
  const quotas = await prisma.eventQuota.findMany({ where: { eventId: id } });
  // La catégorie est nécessaire pour les quotas (Speed dating) ET pour résoudre un tarif différencié
  // éventuel (Networking inclus) — sans jamais transformer ce tarif en quota implicite pour autant.
  const needsCategory = quotas.length > 0 || event.priceTiers.length > 0;
  let quotaCategory: QuotaCategory | null = null;
  if (needsCategory) {
    if (!profile.quotaCategory) return reply.code(409).send({ error: "Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement" });
    quotaCategory = profile.quotaCategory;
  }
  const application = await prisma.application.create({ data: { eventId: id, userId, quotaCategory } });
  await audit(userId, "CREATE_APPLICATION", "Application", application.id);
  const result = await claimReservation(id, application);
  if (result.ok) {
    await notify(userId, "Inscription confirmée", `Vous avez ${formatPaymentDeadline(result.reservation.expiresAt)} pour régler votre billet de ${(resolvePriceCents(event, quotaCategory) / 100).toFixed(2)} €.`);
    return reply.code(201).send({ application: { ...application, status: ApplicationStatus.PAYMENT_PENDING }, reservation: result.reservation });
  }
  if (result.reason === "NO_CATEGORY") return reply.code(409).send({ error: "Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement" });
  const waitlistEntry = await prisma.waitlistEntry.create({ data: { eventId: id, userId, applicationId: application.id, quotaCategory, position: (await prisma.waitlistEntry.count({ where: { eventId: id } })) + 1 } });
  await notify(userId, "Liste d’attente", `« ${event.title} » est complet pour votre catégorie ; vous avez été placé(e) sur liste d’attente.`);
  await createAlternativeOfferIfPossible(userId, event);
  await audit(userId, "APPLICATION_WAITLISTED_FULL", "Application", application.id);
  return reply.code(201).send({ application, waitlisted: true, waitlistEntry });
});

// Entretien global de validation du profil : une seule démarche par personne (pas par événement).
app.get("/me/global-interview", { preHandler: auth }, async (request) => {
  const userId = currentId(request);
  const latest = await prisma.application.findFirst({ where: { userId, eventId: null }, orderBy: { createdAt: "desc" }, include: { call: true } });
  if (!latest) return { status: null };
  const retryAvailableAt = latest.status === ApplicationStatus.REFUSED && latest.decidedAt ? interviewRetryDate(latest.decidedAt) : null;
  return { ...latest, retryAvailableAt };
});
app.post("/me/global-interview", { preHandler: auth }, async (request, reply) => {
  const { motivation } = z.object({ motivation: z.string().min(30).max(1200) }).parse(request.body);
  const userId = currentId(request);
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
  await notify(userId, "Demande d’entretien reçue", "Choisissez maintenant un créneau pour votre entretien.");
  await audit(userId, "REQUEST_GLOBAL_INTERVIEW", "Application", application.id);
  return reply.code(201).send(application);
});

app.get("/interview-slots", { preHandler: auth }, async () =>
  prisma.screeningCall.findMany({ where: { eventId: null, applicationId: null, startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } })
);

app.post("/applications/:id/schedule", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { slotId } = z.object({ slotId: z.string() }).parse(request.body);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId } });
  if (application.status !== ApplicationStatus.PENDING_CALL) return reply.code(409).send({ error: "Un entretien est déjà programmé pour cette démarche" });
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

app.post("/me/applications/:id/cancel", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId }, include: { reservation: { include: { payment: true, ticket: true } } } });
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
  });
  if (activeReservation) await offerNextWaitlistEntry(activeReservation.eventId, activeReservation.quotaCategory);
  await audit(userId, "CANCEL_APPLICATION", "Application", id);
  await notify(userId, "Candidature annulée", hadSucceededPayment ? "Votre annulation a été prise en compte. Le remboursement de votre billet sera examiné manuellement par notre équipe." : "Votre candidature a été annulée.");
  return reply.code(204).send();
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

app.post("/reservations/:id/payment-intent", { preHandler: auth }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Le paiement par carte n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const reservation = await prisma.reservation.findFirstOrThrow({ where: { id, userId }, include: { event: { include: { priceTiers: true } }, application: true, payment: true } });
  if (reservation.application.status !== ApplicationStatus.PAYMENT_PENDING) return reply.code(409).send({ error: "Cette candidature n’est pas en attente de paiement" });
  if (reservation.cancelledAt) return reply.code(409).send({ error: "Cette réservation est annulée" });
  if (reservation.expiresAt < new Date()) return reply.code(409).send({ error: "Le délai de paiement est expiré" });
  if (reservation.payment?.status === PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Cette réservation est déjà payée" });
  const confirmedCount = await prisma.reservation.count({ where: { eventId: reservation.eventId, confirmedAt: { not: null }, cancelledAt: null, id: { not: reservation.id } } });
  if (confirmedCount >= reservation.event.capacity) return reply.code(409).send({ error: "L’événement est désormais complet" });
  // Le tarif est résolu (unique ou différencié selon la catégorie) puis figé dans le paiement au
  // moment de sa création : une modification ultérieure du tarif de l'événement ne s'applique
  // jamais rétroactivement à cette vente.
  const amountCents = resolvePriceCents(reservation.event, reservation.quotaCategory);

  let clientSecret: string | null = null;
  if (reservation.payment?.providerRef) {
    const existing = await stripe.paymentIntents.retrieve(reservation.payment.providerRef);
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status)) clientSecret = existing.client_secret;
  }
  if (!clientSecret) {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: { reservationId: reservation.id, applicationId: reservation.applicationId, userId }
    });
    clientSecret = intent.client_secret;
    await prisma.payment.upsert({
      where: { reservationId: reservation.id },
      update: { provider: "stripe", providerRef: intent.id, amountCents, status: PaymentStatus.PENDING },
      create: { reservationId: reservation.id, provider: "stripe", providerRef: intent.id, amountCents, status: PaymentStatus.PENDING }
    });
  }
  return { clientSecret, amountCents };
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
          // Course entre le paiement et l'expiration de la réservation : si la place a déjà été
          // libérée (et potentiellement réattribuée à quelqu'un d'autre) avant que ce paiement
          // n'arrive, on n'émet JAMAIS de billet pour éviter toute survente. L'argent reste capturé
          // (paiement marqué réussi) mais le remboursement reste manuel, comme pour toute annulation.
          const outcome = await prisma.$transaction(async (tx) => {
            const paidUpdate = await tx.payment.updateMany({ where: { reservationId, status: { not: PaymentStatus.SUCCEEDED } }, data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() } });
            if (paidUpdate.count !== 1) return "ALREADY_HANDLED" as const;
            const reservationUpdate = await tx.reservation.updateMany({ where: { id: reservationId, cancelledAt: null }, data: { confirmedAt: new Date() } });
            if (reservationUpdate.count !== 1) return "LATE_AFTER_RELEASE" as const;
            const ticketCode = `NOUR-${randomUUID().toUpperCase()}`;
            await tx.ticket.upsert({ where: { reservationId }, update: {}, create: { reservationId, code: ticketCode } });
            await tx.application.update({ where: { id: reservation.applicationId }, data: { status: ApplicationStatus.CONFIRMED } });
            return "CONFIRMED" as const;
          });
          if (outcome === "CONFIRMED") {
            await notify(reservation.userId, "Paiement confirmé", `Votre billet pour ${reservation.event.title} est disponible.`);
            await audit(reservation.userId, "PAYMENT_SUCCEEDED", "Reservation", reservationId, { amountCents: reservation.event.priceCents, paymentIntentId: intent.id });
            // Comptabilité 30/70 : uniquement pour les événements qu'un restaurant organise
            // commercialement (jamais pour un événement Nour où ce restaurant n'est que le lieu).
            // Le taux et les frais Stripe réels sont figés au moment de la vente.
            if (reservation.event.controllerRestaurantId) {
              const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: reservation.event.controllerRestaurantId } });
              const grossAmountCents = reservation.payment!.amountCents;
              const commissionRate = restaurant.commissionRate;
              const commissionAmountCents = Math.round((grossAmountCents * commissionRate) / 100);
              const restaurantDueCents = grossAmountCents - commissionAmountCents;
              let stripeFeeCents: number | null = null;
              try {
                const full = await stripe.paymentIntents.retrieve(intent.id, { expand: ["latest_charge.balance_transaction"] });
                const charge = full.latest_charge as Stripe.Charge | null;
                const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null;
                if (balanceTransaction && typeof balanceTransaction === "object") stripeFeeCents = balanceTransaction.fee;
              } catch (err) { app.log.warn({ err }, "Impossible de récupérer les frais Stripe réels pour cette vente"); }
              await prisma.ledgerEntry.create({ data: { paymentId: reservation.payment!.id, eventId: reservation.eventId, restaurantId: restaurant.id, grossAmountCents, commissionRate, commissionAmountCents, restaurantDueCents, stripeFeeCents } });
            }
          } else if (outcome === "LATE_AFTER_RELEASE") {
            await notify(reservation.userId, "Paiement reçu après expiration", "Votre place n’était plus disponible au moment où votre paiement a été confirmé. Le remboursement sera traité manuellement par notre équipe.");
            const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
            await Promise.all(admins.map(a => notify(a.id, "Paiement tardif après libération de place", `Un paiement a été confirmé pour « ${reservation.event.title} » après l’expiration de la réservation : remboursement à traiter manuellement.`)));
            await audit(reservation.userId, "PAYMENT_SUCCEEDED_AFTER_RELEASE", "Reservation", reservationId, { amountCents: reservation.event.priceCents, paymentIntentId: intent.id });
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

app.get("/me/alternative-offers", { preHandler: auth }, async (request) => prisma.alternativeOffer.findMany({ where: { userId: currentId(request) }, include: { alternativeEvent: true, originalEvent: true }, orderBy: { createdAt: "desc" } }));

app.post("/alternative-offers/:id/respond", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
  const userId = currentId(request);
  const offer = await prisma.alternativeOffer.findFirstOrThrow({ where: { id, userId }, include: { alternativeEvent: true } });
  if (offer.status !== AlternativeOfferStatus.PENDING) return reply.code(409).send({ error: "Cette proposition a déjà été traitée" });
  if (offer.respondsBy < new Date()) { await prisma.alternativeOffer.update({ where: { id }, data: { status: AlternativeOfferStatus.EXPIRED } }); return reply.code(409).send({ error: "Cette proposition a expiré" }); }
  if (!accept) return prisma.alternativeOffer.update({ where: { id }, data: { status: AlternativeOfferStatus.DECLINED, respondedAt: new Date() } });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });
  const quotas = await prisma.eventQuota.findMany({ where: { eventId: offer.alternativeEventId } });
  const priceTiers = await prisma.priceTier.findMany({ where: { eventId: offer.alternativeEventId } });
  const needsCategory = quotas.length > 0 || priceTiers.length > 0;
  const quotaCategory = needsCategory ? profile.quotaCategory : null;
  if (needsCategory && !quotaCategory) return reply.code(409).send({ error: "Complétez votre catégorie dans votre profil avant d’accepter" });
  let application = await prisma.application.findUnique({ where: { eventId_userId: { eventId: offer.alternativeEventId, userId } } });
  if (!application) application = await prisma.application.create({ data: { eventId: offer.alternativeEventId, userId, motivation: "Candidature via une proposition d’événement alternatif.", quotaCategory } });
  const result = await claimReservation(offer.alternativeEventId, application);
  if (!result.ok) return reply.code(409).send({ error: "Cette place n’est plus disponible." });
  const updated = await prisma.alternativeOffer.update({ where: { id }, data: { status: AlternativeOfferStatus.ACCEPTED, respondedAt: new Date(), reservationId: result.reservation.id } });
  await notify(userId, "Place réservée", `Vous avez ${formatPaymentDeadline(result.reservation.expiresAt)} pour régler votre billet pour « ${offer.alternativeEvent.title} ».`);
  await audit(userId, "ACCEPT_ALTERNATIVE_OFFER", "AlternativeOffer", id);
  return updated;
});

app.get("/restaurants/me", { preHandler: auth }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: currentId(request) } });
  if (!restaurant) return reply.code(404).send({ error: "Aucune demande restaurateur" });
  return restaurant;
});
app.post("/restaurants/apply", { preHandler: auth }, async (request, reply) => {
  // Le SIRET est saisi par le demandeur mais n'est pas vérifié auprès d'un registre officiel : ce
  // n'est qu'une déclaration, à ne jamais présenter comme une vérification légale effectuée par Nour.
  const input = z.object({ name: z.string().min(2).max(120), managerName: z.string().min(2).max(120), siret: z.string().regex(/^\d{14}$/, "Le SIRET doit comporter 14 chiffres"), description: z.string().max(1000).optional(), district: z.string().max(120).optional(), address: z.string().max(200).optional(), phone: z.string().max(30).optional() }).parse(request.body);
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

// Personnel d'accueil (rôle RECEPTION) : un restaurateur ne peut créer ce personnel que pour son
// propre établissement, et ce personnel n'obtient AUCUN droit hors scan des billets de cet
// établissement (voir la vérification par controllerRestaurantId dans /admin/tickets/scan).
app.get("/admin/staff", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const query = z.object({ restaurantId: z.string().optional() }).parse(request.query);
  const restaurantId = restaurant?.id ?? query.restaurantId;
  if (!restaurantId) return [];
  return prisma.user.findMany({ where: { restaurantId, role: UserRole.RECEPTION }, orderBy: { createdAt: "desc" } });
});
app.post("/admin/staff", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const input = z.object({ phone: z.string().min(8).max(30), displayName: optionalName, restaurantId: z.string().optional() }).parse(request.body);
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const restaurantId = restaurant?.id ?? input.restaurantId;
  if (!restaurantId) return reply.code(400).send({ error: "Restaurant introuvable" });
  if (token.role === UserRole.ADMIN) await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
  const phone = normalizePhoneNumber(input.phone);
  let staffUser = await prisma.user.findUnique({ where: { phone } });
  if (staffUser && staffUser.role !== UserRole.PARTICIPANT) return reply.code(409).send({ error: "Ce compte a déjà un rôle incompatible avec le statut de personnel d’accueil" });
  if (!staffUser) staffUser = await prisma.user.create({ data: { phone, displayName: input.displayName ?? "Personnel d’accueil", profile: { create: { interests: [] } } } });
  const updated = await prisma.user.update({ where: { id: staffUser.id }, data: { role: UserRole.RECEPTION, restaurantId } });
  await notify(staffUser.id, "Accès accueil activé", "Vous pouvez désormais scanner les billets de votre établissement.");
  await audit(currentId(request), "GRANT_STAFF_ACCESS", "User", staffUser.id, { restaurantId });
  return reply.code(201).send(updated);
});
app.delete("/admin/staff/:id", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const staffUser = await prisma.user.findFirstOrThrow({ where: { id, role: UserRole.RECEPTION, ...(restaurant ? { restaurantId: restaurant.id } : {}) } });
  await prisma.user.update({ where: { id: staffUser.id }, data: { role: UserRole.PARTICIPANT, restaurantId: null } });
  await audit(currentId(request), "REVOKE_STAFF_ACCESS", "User", staffUser.id);
  return reply.code(204).send();
});

// Modérateurs (rôle MODERATOR) : uniquement nommés par le super-admin, pour traiter les
// signalements entre utilisateurs. Aucun droit sur les événements, candidatures ou finances.
app.get("/admin/moderators", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.user.findMany({ where: { role: UserRole.MODERATOR }, orderBy: { createdAt: "desc" } }));
app.post("/admin/moderators", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object({ phone: z.string().min(8).max(30), displayName: optionalName }).parse(request.body);
  const phone = normalizePhoneNumber(input.phone);
  let moderator = await prisma.user.findUnique({ where: { phone } });
  if (moderator && moderator.role !== UserRole.PARTICIPANT) return reply.code(409).send({ error: "Ce compte a déjà un rôle incompatible avec le statut de modérateur" });
  if (!moderator) moderator = await prisma.user.create({ data: { phone, displayName: input.displayName ?? "Modérateur", profile: { create: { interests: [] } } } });
  const updated = await prisma.user.update({ where: { id: moderator.id }, data: { role: UserRole.MODERATOR } });
  await audit(currentId(request), "GRANT_MODERATOR", "User", moderator.id);
  return reply.code(201).send(updated);
});
app.delete("/admin/moderators/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const moderator = await prisma.user.findFirstOrThrow({ where: { id, role: UserRole.MODERATOR } });
  await prisma.user.update({ where: { id: moderator.id }, data: { role: UserRole.PARTICIPANT } });
  await audit(currentId(request), "REVOKE_MODERATOR", "User", moderator.id);
  return reply.code(204).send();
});

// File de modération des signalements (Report), jusqu'ici sans aucune interface : accessible au
// super-admin et aux modérateurs nommés, jamais aux restaurateurs.
app.get("/admin/reports", { preHandler: roles(UserRole.ADMIN, UserRole.MODERATOR) }, async () => prisma.report.findMany({ include: { reporter: true, reported: true }, orderBy: { createdAt: "desc" } }));
app.post("/admin/reports/:id/decision", { preHandler: roles(UserRole.ADMIN, UserRole.MODERATOR) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { status } = z.object({ status: z.enum(["REVIEWING", "RESOLVED", "DISMISSED"]) }).parse(request.body);
  const updated = await prisma.report.update({ where: { id }, data: { status } });
  await audit(currentId(request), "MODERATE_REPORT", "Report", id, { status });
  return updated;
});

app.get("/admin/dashboard", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const eventScope = restaurant ? { controllerRestaurantId: restaurant.id } : undefined;
  const [events, applications, payments] = await Promise.all([
    prisma.event.count({ where: eventScope }),
    prisma.application.count({ where: restaurant ? { event: { controllerRestaurantId: restaurant.id } } : { eventId: { not: null } } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, ...(restaurant ? { reservation: { event: { controllerRestaurantId: restaurant.id } } } : {}) }, _sum: { amountCents: true } })
  ]);
  // Les signalements et les entretiens globaux concernent des comptes utilisateurs, pas un
  // restaurant précis : réservés au super-admin, qui est aujourd'hui le seul à les conduire.
  const openReports = restaurant ? null : await prisma.report.count({ where: { status: "OPEN" } });
  const pendingInterviews = restaurant ? null : await prisma.application.count({ where: { eventId: null, status: { notIn: [ApplicationStatus.ACCEPTED, ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } } });
  return { events, applications, revenueCents: payments._sum.amountCents ?? 0, openReports, pendingInterviews };
});
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
    await notify(application.userId, "Profil non validé", `Votre profil n’a pas été validé pour le moment.${notes ? ` ${notes}` : ""} Vous pourrez redemander un entretien à partir du ${interviewRetryDate(refused.decidedAt!).toLocaleDateString("fr-FR")}.`);
    await audit(adminId, "REFUSE_GLOBAL_INTERVIEW", "Application", id, { notes });
    return refused;
  }
  const [, updatedApplication] = await prisma.$transaction([
    prisma.profile.update({ where: { userId: application.userId }, data: { validatedAt: new Date() } }),
    prisma.application.update({ where: { id }, data: { status: ApplicationStatus.ACCEPTED, notes, decidedAt: new Date() } })
  ]);
  await notify(application.userId, "Profil validé", "Votre profil est validé : vous pouvez désormais vous inscrire directement aux événements, sans nouvel entretien.");
  await audit(adminId, "VALIDATE_PROFILE", "Application", id);
  return updatedApplication;
});
app.get("/admin/events", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const events = await prisma.event.findMany({ where: restaurant ? { controllerRestaurantId: restaurant.id } : undefined, include: { quotas: true, priceTiers: true, photos: { orderBy: { position: "asc" } } }, orderBy: { startsAt: "asc" } });
  return events.map(e => ({ ...e, imageUrl: e.imageUrl ?? defaultCategoryImage(e.category) }));
});
app.post("/admin/events/:id/quotas", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  if (event.category !== QUOTA_ELIGIBLE_CATEGORY) return reply.code(400).send({ error: `Les quotas ne sont disponibles que pour la catégorie « ${QUOTA_ELIGIBLE_CATEGORY} »` });
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
app.get("/admin/events/:id/reservations", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await assertEventAccess(request, id);
  return prisma.reservation.findMany({ where: { eventId: id }, include: { user: true, payment: true, ticket: true }, orderBy: { createdAt: "desc" } });
});
app.post("/admin/events/:id/cancel", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const event = await assertEventAccess(request, id);
  if (event.status === EventStatus.CANCELLED) throw httpError(409, "Cet événement est déjà annulé");
  const reservations = await prisma.reservation.findMany({ where: { eventId: id, cancelledAt: null }, include: { payment: true, user: true } });
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id }, data: { status: EventStatus.CANCELLED } });
    await tx.application.updateMany({ where: { eventId: id, status: { notIn: [ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } }, data: { status: ApplicationStatus.CANCELLED } });
    await tx.reservation.updateMany({ where: { eventId: id, cancelledAt: null }, data: { cancelledAt: new Date() } });
    await tx.ticket.updateMany({ where: { reservation: { eventId: id }, status: { not: TicketStatus.CANCELLED } }, data: { status: TicketStatus.CANCELLED } });
    await tx.waitlistEntry.deleteMany({ where: { eventId: id } });
  });
  const paidCount = reservations.filter(r => r.payment?.status === PaymentStatus.SUCCEEDED).length;
  await Promise.all(reservations.map(r => notify(r.userId, "Événement annulé", `« ${event.title} » a été annulé.${r.payment?.status === PaymentStatus.SUCCEEDED ? " Le remboursement de votre billet sera traité manuellement par notre équipe." : ""}`)));
  await audit(currentId(request), "CANCEL_EVENT", "Event", id, { affectedReservations: reservations.length, paidToRefundManually: paidCount });
  return { cancelled: true, paidReservationsToRefund: paidCount };
});
app.post("/admin/payments/:id/refund", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { reservation: { include: { user: true, event: true } }, ledgerEntry: true } });
  if (payment.status !== PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Seul un paiement réussi peut être remboursé" });
  if (!payment.providerRef) return reply.code(409).send({ error: "Aucune référence de paiement Stripe associée" });
  await stripe.refunds.create({ payment_intent: payment.providerRef });
  await prisma.payment.update({ where: { id }, data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() } });
  // La somme due au restaurant n'est jamais récupérée automatiquement si elle a déjà été marquée
  // reversée : ce cas reste à traiter manuellement (voir cahier des charges §10), simplement signalé
  // clairement ici plutôt que d'inventer une procédure de recouvrement automatique.
  let alreadyPaidOutWarning = false;
  if (payment.ledgerEntry) {
    await prisma.ledgerEntry.update({ where: { id: payment.ledgerEntry.id }, data: { refundedAmountCents: payment.ledgerEntry.grossAmountCents } });
    alreadyPaidOutWarning = !!payment.ledgerEntry.paidOutAt;
    if (alreadyPaidOutWarning) {
      const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
      await Promise.all(admins.map(a => notify(a.id, "Remboursement après reversement déjà marqué", `Le paiement remboursé pour « ${payment.reservation.event.title} » avait déjà été marqué comme reversé au restaurant : à régulariser manuellement.`)));
    }
  }
  await notify(payment.reservation.userId, "Remboursement effectué", `Votre paiement pour « ${payment.reservation.event.title} » a été remboursé.`);
  await audit(currentId(request), "REFUND_PAYMENT", "Payment", id, { alreadyPaidOutWarning });
  return { refunded: true, alreadyPaidOutWarning };
});
// Le restaurateur peut demander un remboursement AVEC MOTIF, jamais l'exécuter lui-même : cette
// route ne fait qu'enregistrer la demande et notifier le super-admin, qui décide via l'endpoint
// ci-dessus.
app.post("/admin/payments/:id/refund-request", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { reason } = z.object({ reason: z.string().min(3).max(1000) }).parse(request.body);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { reservation: { include: { event: true } } } });
  const token = request.user as TokenUser;
  if (token.role === UserRole.ORGANIZER) {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: token.sub } });
    if (payment.reservation.event.controllerRestaurantId !== restaurant.id) throw httpError(403, "Ce paiement appartient à un autre restaurateur");
  }
  if (payment.status !== PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Seul un paiement réussi peut faire l’objet d’une demande de remboursement" });
  const updated = await prisma.payment.update({ where: { id }, data: { refundRequestedAt: new Date(), refundRequestedBy: currentId(request), refundRequestReason: reason } });
  const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
  await Promise.all(admins.map(a => notify(a.id, "Demande de remboursement", `Une demande de remboursement a été faite pour « ${payment.reservation.event.title} » : ${reason}`)));
  await audit(currentId(request), "REQUEST_REFUND", "Payment", id, { reason });
  return updated;
});
// Grand livre 30/70 : le restaurateur ne voit que ses propres ventes, le super-admin voit tout.
// "Prêt à reverser" n'est qu'une indication (7 jours après la fin de l'événement, pour laisser le
// temps à une éventuelle contestation) — jamais un blocage : "Marquer comme reversé" reste possible
// à tout moment, à la seule discrétion du super-admin.
const PAYOUT_COOLDOWN_MS = 7 * 24 * 60 * 60_000;
app.get("/admin/finance/ledger", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const entries = await prisma.ledgerEntry.findMany({
    where: restaurant ? { restaurantId: restaurant.id } : undefined,
    include: { event: true, restaurant: true, payment: { include: { reservation: { include: { user: true } } } } },
    orderBy: { createdAt: "desc" }
  });
  const now = new Date();
  return entries.map(e => ({ ...e, readyToPayOut: !e.paidOutAt && now.getTime() - e.event.endsAt.getTime() >= PAYOUT_COOLDOWN_MS }));
});
app.get("/admin/finance/summary", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const where = restaurant ? { restaurantId: restaurant.id } : undefined;
  const [gross, commission, due, paidOut, refunded] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where, _sum: { grossAmountCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { commissionAmountCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { restaurantDueCents: true } }),
    prisma.ledgerEntry.aggregate({ where: { ...where, paidOutAt: { not: null } }, _sum: { restaurantDueCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { refundedAmountCents: true } })
  ]);
  return {
    grossCents: gross._sum.grossAmountCents ?? 0,
    commissionCents: commission._sum.commissionAmountCents ?? 0,
    restaurantDueCents: due._sum.restaurantDueCents ?? 0,
    paidOutCents: paidOut._sum.restaurantDueCents ?? 0,
    refundedCents: refunded._sum.refundedAmountCents ?? 0
  };
});
app.post("/admin/finance/ledger/:id/mark-paid", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { note } = z.object({ note: z.string().max(500).optional() }).parse(request.body);
  const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
  if (entry.paidOutAt) return reply.code(409).send({ error: "Déjà marqué comme reversé" });
  const updated = await prisma.ledgerEntry.update({ where: { id }, data: { paidOutAt: new Date(), paidOutBy: currentId(request), payoutNote: note } });
  await audit(currentId(request), "MARK_LEDGER_PAID_OUT", "LedgerEntry", id, { note });
  return updated;
});
app.post("/admin/restaurants/:id/commission-rate", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { commissionRate } = z.object({ commissionRate: z.number().int().min(0).max(100) }).parse(request.body);
  const updated = await prisma.restaurant.update({ where: { id }, data: { commissionRate } });
  await audit(currentId(request), "SET_COMMISSION_RATE", "Restaurant", id, { commissionRate });
  return updated;
});
app.post("/admin/waitlist/:id/promote", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id }, include: { application: true } });
  const result = await claimReservation(entry.eventId, entry.application);
  if (!result.ok) return reply.code(409).send({ error: result.reason === "FULL" ? "Plus aucune place disponible pour cette catégorie" : "Catégorie de quota manquante pour ce participant" });
  await prisma.waitlistEntry.update({ where: { id }, data: { offeredAt: new Date(), expiresAt: result.reservation.expiresAt } });
  await notify(entry.userId, "Une place vous a été attribuée", `Vous avez ${formatPaymentDeadline(result.reservation.expiresAt)} pour régler votre billet.`);
  await audit(currentId(request), "ADMIN_PROMOTE_WAITLIST", "WaitlistEntry", id);
  return result.reservation;
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
const perksInput = { includesDrink: z.boolean().default(false), includesStarter: z.boolean().default(false), includesMain: z.boolean().default(false), includesDessert: z.boolean().default(false), perksDescription: z.string().max(500).optional() };
app.post("/admin/events", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
  const input = z.object({ venueRestaurantId: z.string().optional(), title: z.string().min(3), slug: z.string().regex(/^[a-z0-9-]+$/), category: z.enum(EVENT_CATEGORY_NAMES as [string, ...string[]]), description: z.string().min(20), startsAt: z.string(), endsAt: z.string(), district: z.string(), address: z.string(), zone: z.enum(EVENT_ZONES as [string, ...string[]]), capacity: z.number().int().min(5).max(500), priceCents: z.number().int().min(0), publish: z.boolean().default(false), ...perksInput }).parse(request.body);
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
    startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), district: input.district, address: input.address, zone: input.zone,
    capacity: input.capacity, priceCents: input.priceCents,
    includesDrink: input.includesDrink, includesStarter: input.includesStarter, includesMain: input.includesMain, includesDessert: input.includesDessert, perksDescription: input.perksDescription,
    controllerRestaurantId: restaurant?.id ?? null,
    venueRestaurantId,
    status: token.role === UserRole.ADMIN && input.publish ? EventStatus.PUBLISHED : EventStatus.DRAFT
  } });
  await audit(currentId(request), "CREATE_EVENT", "Event", event.id); return event;
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
    startsAt: z.string().optional(), endsAt: z.string().optional(),
    ...Object.fromEntries(Object.entries(perksInput).map(([k, v]) => [k, v.optional()]))
  }).parse(request.body);
  const activeReservations = await prisma.reservation.count({ where: { eventId: id, cancelledAt: null } });
  if (input.capacity !== undefined && input.capacity < activeReservations) return reply.code(400).send({ error: `Impossible de descendre sous ${activeReservations} places déjà payées ou bloquées` });
  const data: Record<string, unknown> = { ...input };
  delete data.startsAt; delete data.endsAt;
  const dateChanged = (input.startsAt && new Date(input.startsAt).getTime() !== event.startsAt.getTime()) || (input.endsAt && new Date(input.endsAt).getTime() !== event.endsAt.getTime());
  if (dateChanged && activeReservations > 0) {
    data.proposedStartsAt = input.startsAt ? new Date(input.startsAt) : event.startsAt;
    data.proposedEndsAt = input.endsAt ? new Date(input.endsAt) : event.endsAt;
    data.dateChangeRequestedAt = new Date();
    const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
    await Promise.all(admins.map(a => notify(a.id, "Changement de date proposé", `« ${event.title} » : nouvelle date proposée, en attente de votre approbation.`)));
  } else if (dateChanged) {
    if (input.startsAt) data.startsAt = new Date(input.startsAt);
    if (input.endsAt) data.endsAt = new Date(input.endsAt);
  }
  const updated = await prisma.event.update({ where: { id }, data });
  await audit(currentId(request), "UPDATE_EVENT", "Event", id, input);
  return updated;
});
app.post("/admin/events/:id/date-change/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
  const event = await prisma.event.findUniqueOrThrow({ where: { id } });
  if (!event.dateChangeRequestedAt || !event.proposedStartsAt || !event.proposedEndsAt) return reply.code(409).send({ error: "Aucun changement de date en attente" });
  const affected = await prisma.reservation.findMany({ where: { eventId: id, cancelledAt: null }, select: { userId: true } });
  const updated = await prisma.event.update({ where: { id }, data: accept
    ? { startsAt: event.proposedStartsAt, endsAt: event.proposedEndsAt, proposedStartsAt: null, proposedEndsAt: null, dateChangeRequestedAt: null }
    : { proposedStartsAt: null, proposedEndsAt: null, dateChangeRequestedAt: null } });
  if (accept) await Promise.all(affected.map(r => notify(r.userId, "Date de l’événement modifiée", `« ${event.title} » a désormais lieu le ${event.proposedStartsAt!.toLocaleString("fr-FR")}.`)));
  await audit(currentId(request), accept ? "APPROVE_DATE_CHANGE" : "REJECT_DATE_CHANGE", "Event", id);
  return updated;
});
// Tarifs : un événement garde un tarif unique par défaut ; la différenciation homme/femme reste
// facultative et sa conformité légale doit être vérifiée avant toute activation en production.
app.post("/admin/events/:id/pricing", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request, reply) => {
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

// Libère toutes les 60 secondes les réservations temporaires expirées (place + quota), enchaîne sur la
// liste d'attente correspondante, et marque comme expirées les propositions d'événements alternatifs
// restées sans réponse au-delà de leur délai.
const releaseExpiredReservations = async () => {
  const expired = await prisma.reservation.findMany({ where: { expiresAt: { lt: new Date() }, confirmedAt: null, cancelledAt: null } });
  for (const reservation of expired) {
    await prisma.$transaction(tx => releaseReservationSlot(tx, reservation));
    await notify(reservation.userId, "Délai de paiement expiré", "Le délai pour régler votre billet est dépassé ; la place a été libérée.");
    await audit(undefined, "RESERVATION_EXPIRED", "Reservation", reservation.id);
    await offerNextWaitlistEntry(reservation.eventId, reservation.quotaCategory);
  }
  await prisma.alternativeOffer.updateMany({ where: { status: AlternativeOfferStatus.PENDING, respondsBy: { lt: new Date() } }, data: { status: AlternativeOfferStatus.EXPIRED } });
};
setInterval(() => { releaseExpiredReservations().catch(err => app.log.error(err)); }, 60_000);

// Le frais Stripe réel n'est pas toujours disponible au moment exact du webhook de paiement réussi
// (la transaction de solde peut être calculée quelques secondes après) : on le complète ici en
// deuxième passage, sans jamais bloquer la création de la ligne comptable elle-même.
const backfillStripeFees = async () => {
  if (!stripe) return;
  const pending = await prisma.ledgerEntry.findMany({ where: { stripeFeeCents: null }, include: { payment: true }, take: 20 });
  for (const entry of pending) {
    if (!entry.payment.providerRef) continue;
    try {
      const full = await stripe.paymentIntents.retrieve(entry.payment.providerRef, { expand: ["latest_charge.balance_transaction"] });
      const charge = full.latest_charge as Stripe.Charge | null;
      const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null;
      if (balanceTransaction && typeof balanceTransaction === "object") {
        await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { stripeFeeCents: balanceTransaction.fee } });
      }
    } catch (err) { app.log.warn({ err }, "Nouvelle tentative de récupération des frais Stripe échouée"); }
  }
};
setInterval(() => { backfillStripeFees().catch(err => app.log.error(err)); }, 60_000);

const close = async () => { await prisma.$disconnect(); await app.close(); };
process.on("SIGINT", close); process.on("SIGTERM", close);
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
