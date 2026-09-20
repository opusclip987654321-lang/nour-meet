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
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CATEGORIES, EVENT_CATEGORY_NAMES, EVENT_ZONES, regionOfZone, eventRequiresScreening, suggestedFlowForCategory } from "@nour/shared";
import { env } from "./env.js";
import { paymentDeadline, paymentLockExpiry, interviewRetryDate, refundEligibility, currentYearMonth, resolvePriceCents, eventsOverlap } from "./domain.js";
import { normalizePhoneNumber } from "./phone.js";
import { createSmsVerificationProvider } from "./sms-verification.js";
import { createEmailProvider } from "./email-provider.js";
import { createAIProvider } from "./ai-provider.js";
import { loadSettings, updateSetting, getSetting, listSettingsForAdmin, SETTINGS_SCHEMA } from "./settings.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const uploadsDir = path.join(publicDir, "uploads", "events");
await mkdir(uploadsDir, { recursive: true });
const restaurantUploadsDir = path.join(publicDir, "uploads", "restaurants");
await mkdir(restaurantUploadsDir, { recursive: true });
const articleUploadsDir = path.join(publicDir, "uploads", "articles");
await mkdir(articleUploadsDir, { recursive: true });
const profileUploadsDir = path.join(publicDir, "uploads", "profiles");
await mkdir(profileUploadsDir, { recursive: true });
// Supprime un ancien fichier uploadé lors d'un remplacement (photo de profil : une seule à la
// fois, contrairement aux galeries événement/restaurant) — jamais pour une URL externe ou déjà
// absente, jamais bloquant si le fichier a déjà disparu du disque.
const deleteUploadedFile = async (url: string | null | undefined, prefix: string) => {
  if (!url?.startsWith(prefix)) return;
  await unlink(path.join(publicDir, url.replace("/static/", ""))).catch(() => {});
};
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
const emailProvider = createEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL });
const aiProvider = createAIProvider();

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
  if (current.deletedAt) throw httpError(403, "Compte supprimé");
  token.role = current.role;
};
const auth = async (request: FastifyRequest) => { await loadCurrentUser(request); };
const roles = (...allowed: UserRole[]) => async (request: FastifyRequest) => {
  await loadCurrentUser(request);
  if (!allowed.includes((request.user as TokenUser).role)) throw httpError(403, "Accès non autorisé");
};
const currentId = (request: FastifyRequest) => (request.user as TokenUser).sub;
const audit = (actorId: string | undefined, action: string, entity: string, entityId?: string, metadata?: unknown) => prisma.auditLog.create({ data: { actorId, action, entity, entityId, metadata: metadata as object | undefined } });

// Suppression RGPD (§20) : jamais une ligne User supprimée physiquement — la cascade Prisma
// détruirait Reservation puis Payment puis LedgerEntry, dont la conservation est une obligation
// légale, pas une option. Anonymise à la place les données directement identifiantes. Documenté ici
// plutôt que dans un fichier séparé, pour rester la seule source de vérité de ce qui est concerné :
// - User/Profile : coordonnées et informations personnelles remplacées ou vidées ; deletedAt bloque
//   toute nouvelle connexion (voir loadCurrentUser et /auth/verify-otp).
// - ScreeningAnswer/NetworkingAnswer (réponses libres aux questionnaires) : texte remplacé.
// - Témoignage(s) soumis par ce compte : pseudonyme remplacé par un libellé générique.
// Volontairement CONSERVÉS tels quels, sans exception : Payment, LedgerEntry, Ticket, AuditLog
// (obligation légale de conservation comptable) ; Message et Report (contenu partagé avec un tiers,
// pas une donnée exclusive de ce compte) ; Article (contenu éditorial de la plateforme, pas une
// donnée personnelle du compte).
const anonymizeUser = async (userId: string) => {
  const existingProfile = await prisma.profile.findUnique({ where: { userId } });
  const profileData = { birthDate: null, city: null, profession: null, interests: [] as string[], bio: null, photoUrl: null };
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { phone: `deleted-${userId}`, email: null, displayName: "Compte supprimé", deletedAt: new Date() } }),
    prisma.profile.updateMany({ where: { userId }, data: profileData }),
    prisma.screeningAnswer.updateMany({ where: { application: { userId } }, data: { motivation: "[supprimé]", relationshipGoal: "[supprimé]", personality: "[supprimé]", desiredQualities: "[supprimé]", ageRangeSought: "[supprimé]", valuesAndLifestyle: "[supprimé]", noteForOrganizer: null } }),
    prisma.networkingAnswer.updateMany({ where: { application: { userId } }, data: { sector: "[supprimé]", currentRole: "[supprimé]", experienceLevel: "[supprimé]", goal: "[supprimé]", soughtProfiles: "[supprimé]", contribution: "[supprimé]", topics: "[supprimé]" } }),
    prisma.testimonial.updateMany({ where: { submittedByUserId: userId }, data: { displayName: "Ancien membre" } })
  ]);
  // La photo de profil est une vraie donnée personnelle (image de la personne) : nullifier la
  // colonne ne suffit pas, le fichier lui-même doit disparaître du disque.
  await deleteUploadedFile(existingProfile?.photoUrl, "/static/uploads/profiles/");
};
// SMS hors connexion (Twilio Verify n'est utilisé que pour le code de connexion) : reste simulé
// pour l'instant, jamais présenté comme envoyé. L'e-mail est réellement envoyé via Resend dès que
// RESEND_API_KEY et RESEND_FROM_EMAIL sont configurés ; sinon il reste lui aussi simulé (mode mock).
// Le statut réel (en file, envoyé, échoué) est toujours tracé dans OutboxMessage.
const notify = async (userId: string, title: string, body: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Un compte anonymisé (§20) n'a plus de coordonnées réelles : rien à notifier, et surtout jamais
  // rien à envoyer vers le numéro/e-mail de substitution posé par la suppression RGPD.
  if (user.deletedAt) return;
  await prisma.notification.create({ data: { userId, title, body } });
  await prisma.outboxMessage.create({ data: { channel: "SMS", recipient: user.phone, body: `${title} — ${body}` } });
  if (user.email) {
    const outboxEmail = await prisma.outboxMessage.create({ data: { channel: "EMAIL", recipient: user.email, subject: title, body } });
    if (emailProvider.mode === "resend") {
      try {
        await emailProvider.send(user.email, title, body);
        await prisma.outboxMessage.update({ where: { id: outboxEmail.id }, data: { status: "SENT", sentAt: new Date() } });
      } catch (err) {
        await prisma.outboxMessage.update({ where: { id: outboxEmail.id }, data: { status: "FAILED", error: (err as Error).message } });
        app.log.warn({ err }, "Échec d’envoi d’e-mail réel via Resend");
      }
    }
  }
};
// Exécute un remboursement réel (Stripe en mode test) de façon idempotente et journalisée, partagé
// entre l'annulation automatique (§7, plus de 24h avant l'événement) et l'exception admin motivée
// (24h ou moins). Ne marque JAMAIS REFUNDED si l'appel Stripe échoue : le paiement reste SUCCEEDED
// et les administrateurs sont notifiés pour un traitement manuel plutôt que de mentir sur l'état.
const executeRefund = async (
  payment: { id: string; status: PaymentStatus; providerRef: string | null; amountCents: number; ledgerEntry: { id: string; grossAmountCents: number; paidOutAt: Date | null } | null },
  event: { title: string },
  opts: { exceptionReason?: string } = {}
): Promise<boolean> => {
  if (payment.status !== PaymentStatus.SUCCEEDED) return false;
  if (stripe && payment.providerRef) {
    try {
      await stripe.refunds.create({ payment_intent: payment.providerRef });
    } catch (err) {
      app.log.error({ err }, "Échec de l’appel de remboursement Stripe");
      const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
      await Promise.all(admins.map(a => notify(a.id, "Échec d’un remboursement Stripe", `Le remboursement pour « ${event.title} » a échoué côté prestataire : à traiter manuellement.`)));
      return false;
    }
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED, refundedAt: new Date(), refundedAmountCents: payment.amountCents, refundExceptionReason: opts.exceptionReason ?? null } });
  if (payment.ledgerEntry) {
    await prisma.ledgerEntry.update({ where: { id: payment.ledgerEntry.id }, data: { refundedAmountCents: payment.ledgerEntry.grossAmountCents } });
    if (payment.ledgerEntry.paidOutAt) {
      const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
      await Promise.all(admins.map(a => notify(a.id, "Remboursement après reversement déjà marqué", `Le paiement remboursé pour « ${event.title} » avait déjà été marqué comme reversé au restaurant : à régulariser manuellement.`)));
    }
  }
  return true;
};

type ClaimableApplication = { id: string; userId: string; quotaCategory: QuotaCategory | null };
type ClaimResult = { ok: true; reservation: Awaited<ReturnType<typeof prisma.reservation.upsert>> } | { ok: false; reason: "NO_CATEGORY" | "FULL" | "OVERLAP" };

// Attribue une place de manière atomique (créneau à quota ou capacité globale) et pose une réservation
// dont la durée de vie est TOUJOURS fournie par l'appelant : un verrou court (§5) pendant une tentative
// de paiement directe, une fenêtre plus longue (mais toujours sans risque de survente, la place étant
// déjà décomptée de façon atomique) pour une offre exclusive de liste d'attente. Pour les événements à
// quotas, l'atomicité vient de l'UPDATE conditionné sur heldCount < capacity (comme pour les créneaux
// d'entretien). Pour la capacité globale (sans quota), on utilise une transaction PostgreSQL sérialisable
// pour empêcher toute survente en cas de réservations simultanées.
const claimReservation = async (eventId: string, application: ClaimableApplication, expiresAt: Date): Promise<ClaimResult> => {
  const hasQuotas = (await prisma.eventQuota.count({ where: { eventId } })) > 0;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const run = async (tx: Prisma.TransactionClient): Promise<ClaimResult> => {
    // Chevauchement horaire (§11) : centralisé ici, car les trois chemins qui attribuent réellement
    // une place (paiement direct, offre de liste d'attente, événement alternatif accepté) passent
    // tous par cette fonction — jamais deux réservations actives sur des événements qui se chevauchent.
    const overlapping = await tx.reservation.findFirst({ where: { userId: application.userId, cancelledAt: null, applicationId: { not: application.id }, event: { startsAt: { lt: event.endsAt }, endsAt: { gt: event.startsAt } } } });
    if (overlapping) return { ok: false, reason: "OVERLAP" };
    if (hasQuotas) {
      if (!application.quotaCategory) return { ok: false, reason: "NO_CATEGORY" };
      const quota = await tx.eventQuota.findUnique({ where: { eventId_category: { eventId, category: application.quotaCategory } } });
      if (!quota) return { ok: false, reason: "NO_CATEGORY" };
      const updated = await tx.eventQuota.updateMany({ where: { id: quota.id, heldCount: { lt: quota.capacity } }, data: { heldCount: { increment: 1 } } });
      if (updated.count !== 1) return { ok: false, reason: "FULL" };
    } else {
      const occupied = await tx.reservation.count({ where: { eventId, cancelledAt: null, applicationId: { not: application.id } } });
      if (occupied >= event.capacity) return { ok: false, reason: "FULL" };
    }
    const reservation = await tx.reservation.upsert({
      where: { applicationId: application.id },
      update: { expiresAt, cancelledAt: null, quotaCategory: application.quotaCategory },
      create: { eventId, userId: application.userId, applicationId: application.id, expiresAt, quotaCategory: application.quotaCategory }
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
  const candidates = await prisma.waitlistEntry.findMany({ where: { eventId, offeredAt: null, ...(hasQuotas ? { quotaCategory: category } : {}) }, orderBy: { createdAt: "asc" }, include: { application: true } });
  for (const entry of candidates) {
    // Fenêtre d'offre exclusive (pas un verrou de paiement : pas de risque de survente, la place est
    // déjà décomptée de façon atomique pour cette seule personne) — délai généreux car il s'agit de
    // laisser le temps de remarquer la notification, pas de protéger une vente simultanée.
    const result = await claimReservation(eventId, entry.application, paymentDeadline(new Date(), getSetting("WAITLIST_OFFER_WINDOW_HOURS")));
    // Un chevauchement horaire (§11) avec une autre réservation active ne doit jamais bloquer toute la
    // file : on passe au suivant plutôt que de laisser la place sans preneur indéfiniment.
    if (!result.ok) continue;
    await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { offeredAt: new Date(), expiresAt: result.reservation.expiresAt } });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    await notify(entry.userId, "Une place s’est libérée !", `Une place pour « ${event.title} » vous est proposée. Vous avez ${formatPaymentDeadline(result.reservation.expiresAt)} pour régler votre billet, sans quoi elle sera proposée au participant suivant.`);
    return;
  }
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
  const offer = await prisma.alternativeOffer.create({ data: { userId, originalEventId: originalEvent.id, alternativeEventId: alternative.id, respondsBy: paymentDeadline(new Date(), getSetting("ALTERNATIVE_OFFER_RESPONSE_HOURS")) } });
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
// Fenêtre d'offre de liste d'attente (voir AppSetting WAITLIST_OFFER_WINDOW_HOURS) : la durée
// exacte est configurable, jamais supposée fixe dans le message envoyé au participant.
const formatPaymentDeadline = (expiresAt: Date) => `jusqu’au ${expiresAt.toLocaleString("fr-FR")}`;
const publicEvent = (event: any, revealAddress = false) => ({
  id: event.id, slug: event.slug, title: event.title, category: event.category, flow: event.flow, description: event.description,
  startsAt: event.startsAt, endsAt: event.endsAt, district: event.district, address: revealAddress ? event.address : null,
  zone: event.zone ?? null,
  imageUrl: event.imageUrl ?? defaultCategoryImage(event.category),
  photos: (event.photos ?? []).map((p: any) => p.url),
  perks: { drink: event.includesDrink, starter: event.includesStarter, main: event.includesMain, dessert: event.includesDessert, description: event.perksDescription ?? null },
  minAge: event.minAge ?? null, maxAge: event.maxAge ?? null,
  capacity: event.capacity, confirmedCount: event._count?.reservations ?? 0, priceCents: event.priceCents, status: event.status,
  // Jamais exposés publiquement tant que ENABLE_GENDER_PRICING est désactivé (§6) : sinon le web
  // afficherait un tarif différencié que resolvePriceCents n'appliquerait pas réellement au paiement.
  priceTiers: getSetting("ENABLE_GENDER_PRICING") ? (event.priceTiers ?? []).map((t: any) => ({ category: t.category, amountCents: t.amountCents })) : [],
  proposedStartsAt: event.proposedStartsAt ?? null, proposedEndsAt: event.proposedEndsAt ?? null,
  organizer: event.controllerRestaurant ? { id: event.controllerRestaurant.id, name: event.controllerRestaurant.name } : { id: null, name: "Nūr Meet" },
  venue: event.venueRestaurant ? { id: event.venueRestaurant.id, name: event.venueRestaurant.name } : null,
  quotas: (event.quotas ?? []).map((q: any) => ({ category: q.category, capacity: q.capacity, heldCount: q.heldCount }))
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "Données invalides", details: error.flatten() });
  // Un findUniqueOrThrow/findFirstOrThrow qui échoue (ex. assertEventAccess sur l'événement d'un
  // autre restaurateur) lève une erreur Prisma "P2025" sans statusCode : sans ce cas, elle finissait
  // en 500 « Erreur interne », masquant une simple restriction d'accès légitime derrière une fausse
  // panne serveur. 404 (sans confirmer si la ressource existe pour quelqu'un d'autre) est la réponse
  // correcte, jamais journalisée comme une erreur serveur.
  if ((error as { code?: string }).code === "P2025") return reply.code(404).send({ error: "Ressource introuvable" });
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
  // isNewUser sert au front à proposer, une seule fois, le choix « participant ou restaurateur »
  // juste après la création du compte — jamais recalculé ni stocké, seulement vrai sur cet appel-ci.
  let isNewUser = false;
  if (!user) { user = await prisma.user.create({ data: { phone, displayName: input.displayName ?? "Nouveau membre", profile: { create: { interests: [] } } }, include: { profile: true } }); isNewUser = true; }
  if (user.suspendedAt) return reply.code(403).send({ error: "Compte suspendu" });
  if (user.deletedAt) return reply.code(403).send({ error: "Compte supprimé" });
  const token = app.jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, { expiresIn: "30d" });
  return { token, isNewUser, user: { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, profileCompleted: user.profile?.profileCompleted ?? false } };
});

app.get("/me", { preHandler: auth }, async (request) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentId(request) }, include: { profile: true } });
  // hasRestaurant reflète l'existence d'une fiche Restaurant quel que soit son statut (PENDING,
  // APPROVED, REJECTED, SUSPENDED) : c'est ce champ, jamais le rôle, qui bloque la participation aux
  // événements (le rôle ne devient ORGANIZER qu'à l'approbation, bien après la simple candidature).
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: user.id }, select: { id: true } });
  return { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, profile: user.profile, age: profileAge(user.profile?.birthDate), hasRestaurant: !!restaurant };
});

app.patch("/me/profile", { preHandler: auth }, async (request) => {
  const input = z.object({ displayName: z.string().min(2), email: z.string().email().nullable().optional(), birthDate: z.string().optional(), city: z.string().min(2), profession: z.string().optional(), interests: z.array(z.string()).max(12), bio: z.string().max(600).optional(), quotaCategory: z.enum(["HOMME", "FEMME"]).nullable().optional() }).parse(request.body);
  const userId = currentId(request);
  const profileData = { birthDate: input.birthDate ? new Date(input.birthDate) : null, city: input.city, profession: input.profession, interests: input.interests, bio: input.bio, quotaCategory: input.quotaCategory, profileCompleted: true };
  const user = await prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName, email: input.email, profile: { upsert: { create: profileData, update: profileData } } }, include: { profile: true } });
  await audit(userId, "UPDATE_PROFILE", "User", userId);
  return user;
});

// Photo de profil : une seule à la fois (contrairement aux galeries événement/restaurant, qui en
// acceptent plusieurs) — un nouvel envoi remplace et supprime l'ancien fichier du disque.
app.post("/me/profile-photo", { preHandler: auth }, async (request, reply) => {
  const userId = currentId(request);
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Aucun fichier reçu" });
  const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!extension) return reply.code(415).send({ error: "Format non pris en charge (jpeg, png ou webp uniquement)" });
  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image trop volumineuse (5 Mo maximum)" });
  const previous = await prisma.profile.findUnique({ where: { userId } });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(profileUploadsDir, filename), buffer);
  const photoUrl = `/static/uploads/profiles/${filename}`;
  await prisma.profile.upsert({ where: { userId }, update: { photoUrl }, create: { userId, interests: [], photoUrl } });
  await deleteUploadedFile(previous?.photoUrl, "/static/uploads/profiles/");
  await audit(userId, "UPDATE_PROFILE_PHOTO", "Profile", userId);
  return { photoUrl };
});
app.delete("/me/profile-photo", { preHandler: auth }, async (request, reply) => {
  const userId = currentId(request);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.photoUrl) return reply.code(404).send({ error: "Aucune photo de profil" });
  await prisma.profile.update({ where: { userId }, data: { photoUrl: null } });
  await deleteUploadedFile(profile.photoUrl, "/static/uploads/profiles/");
  await audit(userId, "REMOVE_PROFILE_PHOTO", "Profile", userId);
  return reply.code(204).send();
});

// Droit d'accès/portabilité (§20) : tout ce que la plateforme détient sur ce compte, en un seul
// export. Le nom/téléphone/e-mail de tiers (organisateur d'un événement, autre participant d'une
// conversation) n'est jamais inclus, seul le point de vue de ce compte sur ses propres données.
app.get("/me/export", { preHandler: auth }, async (request) => {
  const userId = currentId(request);
  const [user, applications, reservations, tickets, payments, waitlistEntries, alternativeOffers, notifications, loyaltyEntries, shareLinks, testimonials, contactRequestsSent, contactRequestsReceived] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }),
    prisma.application.findMany({ where: { userId }, include: { screeningAnswer: true, networkingAnswer: true, event: { select: { title: true, slug: true } } } }),
    prisma.reservation.findMany({ where: { userId }, include: { event: { select: { title: true, slug: true } } } }),
    prisma.ticket.findMany({ where: { reservation: { userId } } }),
    prisma.payment.findMany({ where: { reservation: { userId } } }),
    prisma.waitlistEntry.findMany({ where: { userId } }),
    prisma.alternativeOffer.findMany({ where: { userId } }),
    prisma.notification.findMany({ where: { userId } }),
    prisma.loyaltyEntry.findMany({ where: { userId } }),
    prisma.shareLink.findMany({ where: { userId } }),
    prisma.testimonial.findMany({ where: { submittedByUserId: userId } }),
    prisma.contactRequest.findMany({ where: { requesterId: userId } }),
    prisma.contactRequest.findMany({ where: { recipientId: userId } })
  ]);
  await audit(userId, "EXPORT_PERSONAL_DATA", "User", userId);
  return {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, createdAt: user.createdAt },
    profile: user.profile,
    applications, reservations, tickets, payments, waitlistEntries, alternativeOffers, notifications, loyaltyEntries, shareLinks, testimonials,
    contactRequests: { sent: contactRequestsSent, received: contactRequestsReceived }
  };
});

// Droit à l'effacement (§20) : anonymise plutôt que supprimer (voir anonymizeUser). Bloqué tant
// qu'une réservation active porte sur un événement encore à venir, pour ne jamais perdre le lien
// entre le billet/QR code déjà émis et son titulaire avant que l'événement ait eu lieu.
app.post("/me/request-deletion", { preHandler: auth }, async (request, reply) => {
  const userId = currentId(request);
  const upcomingActive = await prisma.reservation.findFirst({ where: { userId, cancelledAt: null, event: { startsAt: { gt: new Date() } } } });
  if (upcomingActive) return reply.code(409).send({ error: "Vous avez une réservation active pour un événement à venir. Annulez-la ou attendez qu’il soit passé avant de supprimer votre compte." });
  await anonymizeUser(userId);
  await audit(userId, "SELF_DELETE_ACCOUNT", "User", userId);
  return { deleted: true };
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
// - DIRECT (networking) : aucune validation de profil requise, questionnaire non bloquant.
// Dans les deux cas, aucune place n'est retenue ici : la candidature autorise seulement à tenter le
// paiement via POST /applications/:id/payment-intent, qui pose le verrou technique court.
app.post("/events/:id/apply", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  // Un compte restaurateur (candidature en cours ou déjà approuvée) n'a jamais le droit de participer
  // aux événements en tant que participant, quel que soit le statut de sa fiche Restaurant.
  if (await prisma.restaurant.findUnique({ where: { ownerId: userId } })) return reply.code(403).send({ error: "Les comptes restaurateurs ne peuvent pas participer aux événements" });
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, include: { priceTiers: true } });
  const requiresScreening = eventRequiresScreening(event);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile?.profileCompleted) return reply.code(409).send({ error: "Complétez votre profil avant de vous inscrire" });
  if (requiresScreening && !profile.validatedAt) return reply.code(409).send({ error: "Votre profil doit d’abord être validé lors d’un entretien avant de vous inscrire à un événement de ce type" });
  const existing = await prisma.application.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
  if (existing) return reply.code(409).send({ error: "Vous êtes déjà inscrit(e) à cet événement", application: existing });
  const input = requiresScreening
    ? z.object({ screeningAnswers: screeningAnswersSchema, shareCode: z.string().optional() }).parse(request.body)
    : z.object({ networkingAnswers: networkingAnswersSchema, shareCode: z.string().optional() }).parse(request.body);
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
        : { networkingAnswer: { create: (input as { networkingAnswers: z.infer<typeof networkingAnswersSchema> }).networkingAnswers } })
    }
  });
  await audit(userId, "CREATE_APPLICATION", "Application", application.id);
  await notify(userId, "Inscription enregistrée", `Vous pouvez maintenant régler votre billet pour « ${event.title} » (${(resolvePriceCents(event, quotaCategory, getSetting("ENABLE_GENDER_PRICING")) / 100).toFixed(2)} €). La place n’est confirmée qu’une fois le paiement réussi.`);
  return reply.code(201).send({ application });
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
  if (await prisma.restaurant.findUnique({ where: { ownerId: userId } })) return reply.code(403).send({ error: "Les comptes restaurateurs ne peuvent pas participer aux événements" });
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

app.get("/me/applications", { preHandler: auth }, async (request) => {
  const applications = await prisma.application.findMany({ where: { userId: currentId(request) }, include: { event: true, call: true, reservation: { include: { payment: true, ticket: true } } }, orderBy: { createdAt: "desc" } });
  // Même résolution d'image par défaut que les routes publiques (§ligne 307/1316) : un événement
  // sans photo uploadée ne doit jamais renvoyer imageUrl:null au front.
  return applications.map(a => a.event ? { ...a, event: { ...a.event, imageUrl: a.event.imageUrl ?? defaultCategoryImage(a.event.category) } } : a);
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
  await notify(userId, "Candidature annulée", message);
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

// Seul point d'entrée qui pose réellement une place : une candidature (PAYMENT_PENDING) ne garantit
// rien avant cet appel (§5). Pose un verrou technique court (AppSetting PAYMENT_LOCK_MINUTES) au
// moment même de la tentative de paiement — jamais avant — pour empêcher deux ventes de la dernière
// place ; s'il en existe déjà un actif (ex. réessai après une carte refusée), il est simplement
// réutilisé plutôt que d'en reposer un nouveau. Si la place n'est plus disponible, rejoint
// automatiquement la liste d'attente, exactement comme le faisait autrefois la candidature elle-même.
app.post("/applications/:id/payment-intent", { preHandler: auth }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Le paiement par carte n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const userId = currentId(request);
  const application = await prisma.application.findFirstOrThrow({ where: { id, userId }, include: { event: { include: { priceTiers: true } }, reservation: true } });
  if (application.status !== ApplicationStatus.PAYMENT_PENDING) return reply.code(409).send({ error: "Cette candidature n’est pas en attente de paiement" });
  if (!application.eventId || !application.event) return reply.code(409).send({ error: "Cette candidature n’est liée à aucun événement" });
  const event = application.event;

  let reservation: Prisma.ReservationGetPayload<object> | null = application.reservation && !application.reservation.cancelledAt && application.reservation.expiresAt > new Date() ? application.reservation : null;
  if (!reservation) {
    const lockExpiresAt = paymentLockExpiry(new Date(), getSetting("PAYMENT_LOCK_MINUTES"));
    const result = await claimReservation(application.eventId, application, lockExpiresAt);
    if (!result.ok) {
      if (result.reason === "NO_CATEGORY") return reply.code(409).send({ error: "Complétez votre catégorie (homme/femme) dans votre profil avant de payer" });
      // Chevauchement horaire (§11) : rejeté franchement, jamais mis en liste d'attente pour un
      // événement qu'il ne pourrait de toute façon pas honorer.
      if (result.reason === "OVERLAP") return reply.code(409).send({ error: "Vous avez déjà une place réservée sur un événement qui chevauche cet horaire" });
      let waitlistEntry = await prisma.waitlistEntry.findUnique({ where: { eventId_userId: { eventId: application.eventId, userId } } });
      if (!waitlistEntry) {
        waitlistEntry = await prisma.waitlistEntry.create({ data: { eventId: application.eventId, userId, applicationId: application.id, quotaCategory: application.quotaCategory, position: (await prisma.waitlistEntry.count({ where: { eventId: application.eventId } })) + 1 } });
        await notify(userId, "Liste d’attente", `« ${event.title} » est complet pour votre catégorie ; vous avez été placé(e) sur liste d’attente.`);
        await createAlternativeOfferIfPossible(userId, event);
        await audit(userId, "APPLICATION_WAITLISTED_FULL", "Application", application.id);
      }
      return reply.code(409).send({ error: "Cet événement est désormais complet pour votre catégorie", waitlisted: true, waitlistEntry });
    }
    reservation = result.reservation;
  }
  const payment = await prisma.payment.findUnique({ where: { reservationId: reservation.id } });
  if (payment?.status === PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Cette réservation est déjà payée" });
  // Le tarif est résolu (unique ou différencié selon la catégorie) puis figé dans le paiement au
  // moment de sa création : une modification ultérieure du tarif de l'événement ne s'applique
  // jamais rétroactivement à cette vente.
  const amountCents = resolvePriceCents(event, reservation.quotaCategory, getSetting("ENABLE_GENDER_PRICING"));

  let clientSecret: string | null = null;
  if (payment?.providerRef) {
    const existing = await stripe.paymentIntents.retrieve(payment.providerRef);
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status)) clientSecret = existing.client_secret;
  }
  if (!clientSecret) {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      payment_method_types: ["card"],
      metadata: { reservationId: reservation.id, applicationId: application.id, userId }
    });
    clientSecret = intent.client_secret;
    await prisma.payment.upsert({
      where: { reservationId: reservation.id },
      update: { provider: "stripe", providerRef: intent.id, amountCents, status: PaymentStatus.PENDING },
      create: { reservationId: reservation.id, provider: "stripe", providerRef: intent.id, amountCents, status: PaymentStatus.PENDING }
    });
  }
  return { clientSecret, amountCents, expiresAt: reservation.expiresAt };
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
            // Comptabilité 30/70 : neutralisée par défaut depuis le passage à l'abonnement mensuel
            // (§8.2 — voir ENABLE_COMMISSION_LEDGER). Les anciennes lignes restent en base, aucune
            // nouvelle n'est créée tant que le drapeau n'est pas explicitement réactivé, et
            // uniquement pour les événements qu'un restaurant organise commercialement (jamais pour
            // un événement Nour où ce restaurant n'est que le lieu). Le taux et les frais Stripe
            // réels sont figés au moment de la vente.
            if (reservation.event.controllerRestaurantId && getSetting("ENABLE_COMMISSION_LEDGER")) {
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
  const tickets = await prisma.ticket.findMany({ where: { reservation: { userId: currentId(request) } }, include: { reservation: { include: { event: { include: { controllerRestaurant: true } } } } }, orderBy: { createdAt: "desc" } });
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
  return { userId: profile.userId, displayName: profile.user.displayName, photoUrl: profile.photoUrl, age: profileAge(profile.birthDate), city: profile.city, profession: profile.profession, interests: profile.interests, bio: profile.bio, validated: true };
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
  await notify(userId, "Événement alternatif accepté", `Vous pouvez maintenant régler votre billet pour « ${offer.alternativeEvent.title} ».`);
  await audit(userId, "ACCEPT_ALTERNATIVE_OFFER", "AlternativeOffer", id);
  return { ...updated, application };
});

app.get("/restaurants/me", { preHandler: auth }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: currentId(request) }, include: { photos: { orderBy: { position: "asc" } }, subscription: { include: { plan: true } }, connectedAccount: true } });
  if (!restaurant) return reply.code(404).send({ error: "Aucune demande restaurateur" });
  const usage = await prisma.restaurantMonthlyUsage.findUnique({ where: { restaurantId_yearMonth: { restaurantId: restaurant.id, yearMonth: currentYearMonth() } } });
  return { ...restaurant, currentMonthEventsPublished: usage?.eventsPublished ?? 0 };
});
// §19/§20 : formulaire explicitement cité comme devant être protégé contre un abus automatisé,
// au même titre que l'authentification et la génération IA.
app.post("/restaurants/apply", { preHandler: auth, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
  // Le SIRET est saisi par le demandeur mais n'est pas vérifié auprès d'un registre officiel : ce
  // n'est qu'une déclaration, à ne jamais présenter comme une vérification légale effectuée par Nour.
  const input = z.object({
    name: z.string().min(2).max(120), managerName: z.string().min(2).max(120), siret: z.string().regex(/^\d{14}$/, "Le SIRET doit comporter 14 chiffres"),
    description: z.string().max(1000).optional(), district: z.string().max(120).optional(), address: z.string().max(200).optional(), phone: z.string().max(30).optional(),
    // Champs enrichis §8.1 : tous facultatifs à la candidature, complétables ensuite.
    desiredCapacity: z.number().int().min(1).max(500).optional(), desiredSchedule: z.string().max(300).optional(),
    averagePricePerPersonCents: z.number().int().min(0).optional(), defaultMinParticipants: z.number().int().min(1).optional(),
    priceIncludesDrink: z.boolean().optional(), priceIncludesStarter: z.boolean().optional(), priceIncludesMain: z.boolean().optional(), priceIncludesDessert: z.boolean().optional(),
    priceNotes: z.string().max(500).optional(), proposesCategoryPricing: z.boolean().optional(), allowsPrivatization: z.boolean().optional(), specialConditions: z.string().max(1000).optional()
  }).parse(request.body);
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
  // Fiche complète pour la vue admin (§8.1) : galerie, coordonnées, disponibilité, conditions
  // tarifaires, statut de l'abonnement et du compte connecté. Les notes internes (adminNotes) sont
  // un champ de la fiche elle-même, jamais exposées au restaurateur (voir /restaurants/me).
  return prisma.restaurant.findMany({ where: query.status ? { status: query.status } : undefined, include: { owner: true, photos: { orderBy: { position: "asc" } }, subscription: { include: { plan: true } }, connectedAccount: true }, orderBy: { submittedAt: "desc" } });
});
app.patch("/admin/restaurants/:id/notes", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { adminNotes } = z.object({ adminNotes: z.string().max(2000).nullable() }).parse(request.body);
  const updated = await prisma.restaurant.update({ where: { id }, data: { adminNotes } });
  await audit(currentId(request), "UPDATE_RESTAURANT_NOTES", "Restaurant", id);
  return updated;
});
app.post("/admin/restaurants/:id/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, reason } = z.object({ accept: z.boolean(), reason: z.string().max(1000).optional() }).parse(request.body);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id }, include: { owner: true } });
  if (restaurant.status !== "PENDING") return reply.code(409).send({ error: "Cette demande a déjà été traitée" });
  const adminId = currentId(request);
  if (accept) {
    // Remplace la commission 30/70 (§8.2) : un abonnement d'essai est ouvert automatiquement sur le
    // plan par défaut plutôt que d'exiger une action manuelle supplémentaire. Aucun prélèvement
    // réel n'est déclenché (voir le résumé de fin de lot : Stripe Billing n'est pas câblé).
    const defaultPlan = await prisma.plan.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
    const [updated] = await prisma.$transaction([
      prisma.restaurant.update({ where: { id }, data: { status: "APPROVED", verifiedAt: new Date(), reviewedBy: adminId, rejectionReason: null } }),
      prisma.user.update({ where: { id: restaurant.ownerId }, data: { role: restaurant.owner.role === UserRole.PARTICIPANT ? UserRole.ORGANIZER : restaurant.owner.role } }),
      ...(defaultPlan ? [prisma.restaurantSubscription.upsert({
        where: { restaurantId: id },
        update: {},
        create: { restaurantId: id, planId: defaultPlan.id, status: "TRIALING", currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000) }
      })] : [])
    ]);
    await notify(restaurant.ownerId, "Compte restaurateur approuvé", `Votre établissement est validé, vous pouvez préparer vos événements.${defaultPlan ? ` Un essai gratuit de votre abonnement (${(defaultPlan.monthlyPriceCents / 100).toFixed(0)} €/mois, ${defaultPlan.monthlyEventQuota} événements publiables par mois) a été activé.` : ""}`);
    await audit(adminId, "APPROVE_RESTAURANT", "Restaurant", id);
    return updated;
  }
  const updated = await prisma.restaurant.update({ where: { id }, data: { status: "REJECTED", reviewedBy: adminId, rejectionReason: reason ?? null } });
  await notify(restaurant.ownerId, "Demande restaurateur refusée", reason ?? "Votre demande n’a pas été retenue.");
  await audit(adminId, "REJECT_RESTAURANT", "Restaurant", id, { reason });
  return updated;
});

// Espace restaurateur : compléter les champs enrichis après approbation, galerie de photos.
app.patch("/restaurants/me", { preHandler: roles(UserRole.ORGANIZER) }, async (request) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const input = z.object({
    description: z.string().max(1000).optional(), district: z.string().max(120).optional(), address: z.string().max(200).optional(), phone: z.string().max(30).optional(),
    desiredCapacity: z.number().int().min(1).max(500).optional(), desiredSchedule: z.string().max(300).optional(),
    averagePricePerPersonCents: z.number().int().min(0).optional(), defaultMinParticipants: z.number().int().min(1).optional(),
    priceIncludesDrink: z.boolean().optional(), priceIncludesStarter: z.boolean().optional(), priceIncludesMain: z.boolean().optional(), priceIncludesDessert: z.boolean().optional(),
    priceNotes: z.string().max(500).optional(), proposesCategoryPricing: z.boolean().optional(), allowsPrivatization: z.boolean().optional(), specialConditions: z.string().max(1000).optional()
  }).parse(request.body);
  const updated = await prisma.restaurant.update({ where: { id: restaurant.id }, data: input });
  await audit(currentId(request), "UPDATE_RESTAURANT_PROFILE", "Restaurant", restaurant.id);
  return updated;
});
app.post("/restaurants/me/photos", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const count = await prisma.restaurantPhoto.count({ where: { restaurantId: restaurant.id } });
  if (count >= 8) return reply.code(409).send({ error: "8 photos maximum : supprimez-en une avant d’en ajouter une nouvelle" });
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Aucun fichier reçu" });
  const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!extension) return reply.code(415).send({ error: "Format non pris en charge (jpeg, png ou webp uniquement)" });
  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image trop volumineuse (5 Mo maximum)" });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(restaurantUploadsDir, filename), buffer);
  const photo = await prisma.restaurantPhoto.create({ data: { restaurantId: restaurant.id, url: `/static/uploads/restaurants/${filename}`, position: count } });
  await audit(currentId(request), "ADD_RESTAURANT_PHOTO", "Restaurant", restaurant.id);
  return reply.code(201).send(photo);
});
app.delete("/restaurants/me/photos/:photoId", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  const { photoId } = z.object({ photoId: z.string() }).parse(request.params);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const deleted = await prisma.restaurantPhoto.deleteMany({ where: { id: photoId, restaurantId: restaurant.id } });
  if (deleted.count === 0) return reply.code(404).send({ error: "Photo introuvable" });
  return reply.code(204).send();
});

// Abonnement (§8.2) : résiliable à tout moment par le restaurateur, jamais réactivé seul (une
// nouvelle souscription passe par l'administration). La résiliation bloque les prochaines
// publications mais ne touche jamais les événements déjà vendus.
app.post("/restaurants/me/subscription/cancel", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const subscription = await prisma.restaurantSubscription.findUnique({ where: { restaurantId: restaurant.id } });
  if (!subscription || subscription.status === "CANCELLED") return reply.code(409).send({ error: "Aucun abonnement actif à résilier" });
  const updated = await prisma.restaurantSubscription.update({ where: { restaurantId: restaurant.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await audit(currentId(request), "CANCEL_SUBSCRIPTION", "RestaurantSubscription", updated.id);
  return updated;
});
app.get("/admin/plans", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.plan.findMany({ orderBy: { createdAt: "asc" } }));
app.post("/admin/plans", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object({ name: z.string().min(2).max(80), monthlyPriceCents: z.number().int().min(0), monthlyEventQuota: z.number().int().min(1), active: z.boolean().default(true) }).parse(request.body);
  const plan = await prisma.plan.create({ data: input });
  await audit(currentId(request), "CREATE_PLAN", "Plan", plan.id, input);
  return reply.code(201).send(plan);
});
app.post("/admin/restaurants/:id/subscription", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ planId: z.string(), status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "INCOMPLETE"]).optional(), currentPeriodEnd: z.string().optional() }).parse(request.body);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
  const updated = await prisma.restaurantSubscription.upsert({
    where: { restaurantId: id },
    update: { planId: plan.id, status: input.status ?? undefined, currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : undefined },
    create: { restaurantId: id, planId: plan.id, status: input.status ?? "ACTIVE", currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : new Date(Date.now() + 30 * 24 * 60 * 60_000) }
  });
  await notify(restaurant.ownerId, "Abonnement mis à jour", `Votre abonnement « ${plan.name} » est maintenant ${updated.status === "ACTIVE" ? "actif" : updated.status.toLowerCase()}.`);
  await audit(currentId(request), "UPDATE_SUBSCRIPTION", "RestaurantSubscription", updated.id, input);
  return updated;
});

// Scaffolding marketplace (§9), Stripe Connect en mode test uniquement : suit un compte connecté,
// ne déclenche jamais de virement (voir MARKETPLACE_PAYOUTS_ENABLED, toujours désactivé par
// défaut ; aucune route de la plateforme n'exécute de transfert réel, avec ou sans le drapeau).
app.post("/restaurants/me/connected-account", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe n’est pas configuré sur ce serveur" });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  if (restaurant.status !== "APPROVED") return reply.code(409).send({ error: "Votre établissement doit être approuvé avant de créer un compte connecté" });
  const existing = await prisma.connectedAccount.findUnique({ where: { restaurantId: restaurant.id } });
  if (existing) return existing;
  const account = await stripe.accounts.create({ type: "express", country: "FR", capabilities: { transfers: { requested: true } }, business_type: "company" });
  const created = await prisma.connectedAccount.create({ data: { restaurantId: restaurant.id, provider: "stripe", externalAccountId: account.id, status: "PENDING" } });
  await audit(currentId(request), "CREATE_CONNECTED_ACCOUNT", "Restaurant", restaurant.id, { externalAccountId: account.id });
  return reply.code(201).send(created);
});
app.get("/restaurants/me/connected-account", { preHandler: roles(UserRole.ORGANIZER) }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const account = await prisma.connectedAccount.findUnique({ where: { restaurantId: restaurant.id } });
  if (!account) return reply.code(404).send({ error: "Aucun compte connecté" });
  return account;
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

// Tableau de bord (§14) : filtrable par période, cartes séparées par nature — jamais un seul total
// qui mélangerait des choses de nature différente (voir aussi /admin/finance/summary pour le détail
// financier). Les cartes propres à la plateforme entière (entretiens, abonnements, partages...)
// restent réservées au super-admin, un restaurateur ne voyant que son propre périmètre.
app.get("/admin/dashboard", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  // §14 : filtres par événement, type, date, statut, tranche d'âge et ville. La tranche d'âge est
  // un agrégat compté côté serveur (nombre de candidatures dans la tranche), jamais une liste de
  // profils individuels filtrables par âge — le seul usage "métier" que ce champ sert ici.
  const query = z.object({
    since: z.string().optional(), until: z.string().optional(), eventId: z.string().optional(),
    category: z.string().optional(), status: z.nativeEnum(EventStatus).optional(), city: z.string().optional(),
    minAge: z.coerce.number().int().min(0).optional(), maxAge: z.coerce.number().int().min(0).optional()
  }).parse(request.query);
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 30 * 86_400_000);
  const until = query.until ? new Date(query.until) : undefined;
  const createdRange = { gte: since, ...(until ? { lte: until } : {}) };
  const eventScope = {
    ...(restaurant ? { controllerRestaurantId: restaurant.id } : {}),
    ...(query.eventId ? { id: query.eventId } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.city ? { district: { contains: query.city, mode: Prisma.QueryMode.insensitive } } : {})
  };
  // Bornes de date de naissance dérivées de la tranche d'âge demandée : un âge minimum correspond à
  // une date de naissance plus ancienne (borne haute), et inversement pour l'âge maximum.
  const birthDateRange = (query.minAge != null || query.maxAge != null) ? {
    ...(query.minAge != null ? { lte: new Date(Date.now() - query.minAge * 31_557_600_000) } : {}),
    ...(query.maxAge != null ? { gte: new Date(Date.now() - (query.maxAge + 1) * 31_557_600_000) } : {})
  } : undefined;
  const applicationEventScope = restaurant || Object.keys(eventScope).length > 0 ? { event: eventScope } : { eventId: { not: null } };
  const [events, upcomingEvents, applications, payments, ticketsSold, waitlisted] = await Promise.all([
    prisma.event.count({ where: eventScope }),
    prisma.event.count({ where: { ...eventScope, status: EventStatus.PUBLISHED, startsAt: { gt: new Date() } } }),
    prisma.application.count({ where: { ...applicationEventScope, createdAt: createdRange, ...(birthDateRange ? { user: { profile: { birthDate: birthDateRange } } } : {}) } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, reservation: { event: eventScope }, paidAt: createdRange }, _sum: { amountCents: true } }),
    prisma.ticket.count({ where: { status: { not: "CANCELLED" }, reservation: { event: eventScope, createdAt: createdRange } } }),
    prisma.waitlistEntry.count({ where: { event: eventScope } })
  ]);
  const remainingSpots = await prisma.event.aggregate({ where: { ...eventScope, status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] } }, _sum: { capacity: true } });
  const confirmedReservations = await prisma.reservation.count({ where: { confirmedAt: { not: null }, cancelledAt: null, event: eventScope } });
  // Les signalements, entretiens globaux, demandes restaurateurs, abonnements et partages concernent
  // la plateforme entière ou des comptes utilisateurs, pas un restaurant précis : réservés au
  // super-admin, qui est aujourd'hui le seul à les conduire.
  const openReports = restaurant ? null : await prisma.report.count({ where: { status: "OPEN" } });
  const pendingInterviews = restaurant ? null : await prisma.application.count({ where: { eventId: null, status: { notIn: [ApplicationStatus.ACCEPTED, ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } } });
  // Taux d'acceptation : calculé sur les décisions de l'entretien global (eventId null), seule
  // démarche qui aboutit réellement à ACCEPTED/REFUSED dans l'architecture actuelle (Lot 1) — une
  // candidature à un événement précis ne passe jamais par ces statuts, elle irait directement en
  // PAYMENT_PENDING une fois le profil déjà validé.
  let acceptanceRate: number | null = null;
  if (!restaurant) {
    const [acceptedInterviews, decidedInterviews] = await Promise.all([
      prisma.application.count({ where: { eventId: null, status: ApplicationStatus.ACCEPTED, decidedAt: { gte: since } } }),
      prisma.application.count({ where: { eventId: null, status: { in: [ApplicationStatus.ACCEPTED, ApplicationStatus.REFUSED] }, decidedAt: { gte: since } } })
    ]);
    acceptanceRate = decidedInterviews > 0 ? Math.round((acceptedInterviews / decidedInterviews) * 100) : null;
  }
  const upcomingInterviews = restaurant ? null : await prisma.screeningCall.count({ where: { eventId: null, startsAt: { gt: new Date() }, completedAt: null } });
  const pendingRestaurantApplications = restaurant ? null : await prisma.restaurant.count({ where: { status: "PENDING" } });
  const subscriptionsByStatus = restaurant ? null : await prisma.restaurantSubscription.groupBy({ by: ["status"], _count: true });
  const pendingPayments = restaurant ? null : await prisma.payment.count({ where: { status: PaymentStatus.PENDING, createdAt: createdRange } });
  const failedPayments = restaurant ? null : await prisma.payment.count({ where: { status: PaymentStatus.FAILED, createdAt: createdRange } });
  const shareClicks = restaurant ? null : await prisma.shareLink.aggregate({ _sum: { clicks: true } });
  // §14 : le total de clics seul ne dit rien de l'efficacité du partage — inscriptions et ventes
  // réellement attribuées (déjà calculées par événement dans /admin/events/:id/shares), agrégées
  // ici à l'échelle de la plateforme.
  const shareAttributedApplications = restaurant ? null : await prisma.application.count({ where: { attributedShareLinkId: { not: null }, createdAt: createdRange } });
  const shareAttributedPurchases = restaurant ? null : await prisma.application.count({ where: { attributedShareLinkId: { not: null }, createdAt: createdRange, reservation: { payment: { status: PaymentStatus.SUCCEEDED } } } });
  return {
    events, upcomingEvents, applications, acceptanceRate, ticketsSold,
    remainingSpots: (remainingSpots._sum.capacity ?? 0) - confirmedReservations,
    waitlisted, revenueCents: payments._sum.amountCents ?? 0,
    openReports, pendingInterviews, upcomingInterviews, pendingRestaurantApplications,
    subscriptionsByStatus: subscriptionsByStatus?.map(s => ({ status: s.status, count: s._count })) ?? null,
    pendingPayments, failedPayments, shareClicks: shareClicks?._sum.clicks ?? null,
    shareAttributedApplications, shareAttributedPurchases
  };
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
    // §4.1 : un refus reste neutre et sans motif pour le participant, quoi que l'admin ait consigné
    // dans `notes` (visible uniquement en interne, jamais renvoyé dans la notification).
    await notify(application.userId, "Profil non validé", `Votre profil n’a pas été validé pour le moment. Vous pourrez redemander un entretien à partir du ${interviewRetryDate(refused.decidedAt!).toLocaleDateString("fr-FR")}.`);
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
  await notify(application.userId, "Entretien reprogrammé", `Votre appel est désormais prévu le ${slot.startsAt.toLocaleString("fr-FR")}.`);
  await audit(currentId(request), "RESCHEDULE_GLOBAL_INTERVIEW", "Application", id, { slotId });
  return { rescheduled: true, slot };
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
  return prisma.reservation.findMany({ where: { eventId: event.id }, include: { user: { select: isAdmin ? { id: true, displayName: true, phone: true, email: true } : { id: true, displayName: true } }, payment: true, ticket: true }, orderBy: { createdAt: "desc" } });
});
// Annulation d'un événement (§7 organisateur, §10 minimum non atteint) : remboursement intégral
// automatique de tous les billets concernés, jamais "à traiter manuellement" — l'événement
// n'existant plus, les quotas tenus sont aussi réinitialisés pour ne pas laisser de données de
// capacité incohérentes. Partagée entre l'annulation manuelle et la décision minimum non atteint.
const cancelEventWithRefunds = async (event: { id: string; title: string; status: EventStatus }, actorId: string | undefined, action: string) => {
  if (event.status === EventStatus.CANCELLED) throw httpError(409, "Cet événement est déjà annulé");
  const reservations = await prisma.reservation.findMany({ where: { eventId: event.id, cancelledAt: null }, include: { payment: { include: { ledgerEntry: true } }, user: true } });
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { status: EventStatus.CANCELLED } });
    await tx.application.updateMany({ where: { eventId: event.id, status: { notIn: [ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } }, data: { status: ApplicationStatus.CANCELLED } });
    await tx.reservation.updateMany({ where: { eventId: event.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
    await tx.ticket.updateMany({ where: { reservation: { eventId: event.id }, status: { not: TicketStatus.CANCELLED } }, data: { status: TicketStatus.CANCELLED } });
    await tx.waitlistEntry.deleteMany({ where: { eventId: event.id } });
    await tx.eventQuota.updateMany({ where: { eventId: event.id }, data: { heldCount: 0 } });
  });
  const paid = reservations.filter(r => r.payment?.status === PaymentStatus.SUCCEEDED);
  const refundedIds = new Set<string>();
  for (const r of paid) {
    if (await executeRefund(r.payment!, event, {})) refundedIds.add(r.id);
  }
  await Promise.all(reservations.map(r => notify(r.userId, "Événement annulé", `« ${event.title} » a été annulé.${refundedIds.has(r.id) ? ` Vous avez été intégralement remboursé(e) (${(r.payment!.amountCents / 100).toFixed(2)} €).` : ""}`)));
  await audit(actorId, action, "Event", event.id, { affectedReservations: reservations.length, refunded: refundedIds.size, refundFailed: paid.length - refundedIds.size });
  return { cancelled: true, refundedCount: refundedIds.size, refundFailedCount: paid.length - refundedIds.size };
};
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
// Exception admin motivée (§7) : en dehors du délai de 24h, un motif est obligatoire — sinon le
// remboursement relève du calcul automatique déjà exécuté à l'annulation, pas de cette route.
app.post("/admin/payments/:id/refund", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe n’est pas configuré sur ce serveur" });
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { reason } = z.object({ reason: z.string().min(3).max(1000).optional() }).parse(request.body ?? {});
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { reservation: { include: { user: true, event: true } }, ledgerEntry: true } });
  if (payment.status !== PaymentStatus.SUCCEEDED) return reply.code(409).send({ error: "Seul un paiement réussi peut être remboursé" });
  if (!payment.providerRef) return reply.code(409).send({ error: "Aucune référence de paiement Stripe associée" });
  const { eligible } = refundEligibility(payment.reservation.event.startsAt);
  if (!eligible && !reason) return reply.code(400).send({ error: "Motif obligatoire : cette annulation est à 24 heures ou moins de l’événement, il s’agit d’une exception à la politique de remboursement." });
  const ok = await executeRefund(payment, payment.reservation.event, { exceptionReason: eligible ? undefined : reason });
  if (!ok) return reply.code(502).send({ error: "Le remboursement a échoué côté prestataire ; les administrateurs ont été notifiés." });
  const alreadyPaidOutWarning = !!payment.ledgerEntry?.paidOutAt;
  await notify(payment.reservation.userId, "Remboursement effectué", `Votre paiement pour « ${payment.reservation.event.title} » a été remboursé.`);
  await audit(currentId(request), "REFUND_PAYMENT", "Payment", id, { alreadyPaidOutWarning, exception: !eligible, reason });
  return { refunded: true, alreadyPaidOutWarning, exception: !eligible };
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
// Sépare strictement (§9/§14) : volume brut et montant dû au restaurateur (LedgerEntry, restant
// pertinent pour les anciennes ventes sous commission), chiffre d'affaires PROPRE de Nour (ses
// événements en direct, controllerRestaurantId null) et abonnements restaurateur (revenu récurrent
// distinct, jamais mélangé avec le volume de billets vendu pour compte de tiers).
app.get("/admin/finance/summary", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  const where = restaurant ? { restaurantId: restaurant.id } : undefined;
  // grossTicketVolumeCents vient directement de Payment, indépendamment de LedgerEntry : depuis le
  // passage à l'abonnement (§8.2, Lot 2), ENABLE_COMMISSION_LEDGER est désactivé par défaut et plus
  // aucune LedgerEntry n'est créée pour les nouvelles ventes restaurateur. gross/commission/due/
  // paidOut ci-dessous restent donc corrects pour l'historique sous l'ancien modèle 30/70, mais
  // resteraient figés à zéro pour toute vente récente si on s'y fiait seul — d'où ce calcul séparé,
  // toujours à jour, qui ne mélange jamais le CA propre de Nour avec l'argent encaissé pour un tiers.
  const [gross, commission, due, paidOut, refunded, grossTicketVolume] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where, _sum: { grossAmountCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { commissionAmountCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { restaurantDueCents: true } }),
    prisma.ledgerEntry.aggregate({ where: { ...where, paidOutAt: { not: null } }, _sum: { restaurantDueCents: true } }),
    prisma.ledgerEntry.aggregate({ where, _sum: { refundedAmountCents: true } }),
    prisma.payment.aggregate({
      where: { status: PaymentStatus.SUCCEEDED, reservation: { event: { controllerRestaurantId: restaurant ? restaurant.id : { not: null } } } },
      _sum: { amountCents: true }
    })
  ]);
  const summary = {
    grossCents: gross._sum.grossAmountCents ?? 0,
    commissionCents: commission._sum.commissionAmountCents ?? 0,
    restaurantDueCents: due._sum.restaurantDueCents ?? 0,
    paidOutCents: paidOut._sum.restaurantDueCents ?? 0,
    refundedCents: refunded._sum.refundedAmountCents ?? 0,
    grossTicketVolumeCents: grossTicketVolume._sum.amountCents ?? 0,
    commissionLedgerEnabled: getSetting("ENABLE_COMMISSION_LEDGER")
  };
  if (restaurant) return summary;
  // Le reste n'a de sens qu'à l'échelle de la plateforme, jamais restreint à un seul restaurateur.
  const [nourOwnRevenue, activeSubscriptions] = await Promise.all([
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, reservation: { event: { controllerRestaurantId: null } } }, _sum: { amountCents: true } }),
    prisma.restaurantSubscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } })
  ]);
  return {
    ...summary,
    nourOwnRevenueCents: nourOwnRevenue._sum.amountCents ?? 0,
    subscriptionMonthlyRevenueCents: activeSubscriptions.reduce((sum, s) => sum + s.plan.monthlyPriceCents, 0),
    activeSubscriptionsCount: activeSubscriptions.length
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
  const result = await claimReservation(entry.eventId, entry.application, paymentDeadline(new Date(), getSetting("WAITLIST_OFFER_WINDOW_HOURS")));
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = { FULL: "Plus aucune place disponible pour cette catégorie", NO_CATEGORY: "Catégorie de quota manquante pour ce participant", OVERLAP: "Ce participant a déjà une réservation active sur un événement qui chevauche cet horaire" };
    return reply.code(409).send({ error: messages[result.reason] });
  }
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
    if (usage.eventsPublished >= subscription.plan.monthlyEventQuota) {
      return reply.code(409).send({ error: `Quota mensuel atteint (${usage.eventsPublished}/${subscription.plan.monthlyEventQuota} événements publiés ce mois-ci).` });
    }
    await prisma.restaurantMonthlyUsage.update({ where: { restaurantId_yearMonth: { restaurantId: event.controllerRestaurant.id, yearMonth } }, data: { eventsPublished: { increment: 1 } } });
    quotaConsumedNow = true;
  }
  const updated = await prisma.event.update({ where: { id }, data: { status: accept ? EventStatus.PUBLISHED : EventStatus.DRAFT, reviewedAt: new Date(), reviewNote: note ?? null, quotaConsumedAt: quotaConsumedNow ? new Date() : undefined } });
  if (event.controllerRestaurant) await notify(event.controllerRestaurant.ownerId, accept ? "Événement publié" : "Événement renvoyé en brouillon", accept ? `« ${event.title} » est maintenant publié.` : `« ${event.title} » nécessite des modifications${note ? ` : ${note}` : "."}`);
  await audit(currentId(request), accept ? "APPROVE_EVENT" : "REJECT_EVENT", "Event", id, { note, quotaConsumedNow });
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
app.get("/admin/outbox", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.outboxMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));

// Paramètres applicatifs centralisés (voir settings.ts) : valeurs provisoires du cahier des charges,
// modifiables sans redéploiement, jamais en dur ailleurs dans le code.
// Contenu éditorial public (§16) : distinct de /admin/settings (réservé à l'administration), ne
// renvoie que les trois clés nécessaires à la page « Le concept ».
app.get("/concept-video", async () => ({ url: getSetting("CONCEPT_VIDEO_URL"), thumbnail: getSetting("CONCEPT_VIDEO_THUMBNAIL_URL"), subtitles: getSetting("CONCEPT_VIDEO_SUBTITLES_URL") }));
app.get("/admin/settings", { preHandler: roles(UserRole.ADMIN) }, async () => listSettingsForAdmin());
app.patch("/admin/settings/:key", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { key } = z.object({ key: z.enum(Object.keys(SETTINGS_SCHEMA) as [string, ...string[]]) }).parse(request.params);
  const { value } = z.object({ value: z.unknown() }).parse(request.body);
  const updated = await updateSetting(prisma, key as keyof typeof SETTINGS_SCHEMA, value, currentId(request));
  await audit(currentId(request), "UPDATE_APP_SETTING", "AppSetting", key, { value: updated });
  return { key, value: updated };
});

// Témoignages (§17) : jamais publiés automatiquement, même soumis par un participant — un
// administrateur doit explicitement passer le statut à PUBLISHED.
app.get("/testimonials", async (request) => {
  const query = z.object({ eventType: z.string().optional() }).parse(request.query);
  return prisma.testimonial.findMany({ where: { status: "PUBLISHED", eventType: query.eventType }, orderBy: [{ position: "asc" }, { createdAt: "desc" }] });
});
app.post("/me/testimonials", { preHandler: auth }, async (request, reply) => {
  const input = z.object({ eventType: z.string().min(2).max(60), text: z.string().min(10).max(1000), rating: z.number().int().min(1).max(5).optional(), consentGiven: z.literal(true) }).parse(request.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentId(request) } });
  const testimonial = await prisma.testimonial.create({ data: { displayName: user.displayName, eventType: input.eventType, text: input.text, rating: input.rating, consentGiven: input.consentGiven, submittedByUserId: user.id, status: "DRAFT" } });
  await audit(user.id, "SUBMIT_TESTIMONIAL", "Testimonial", testimonial.id);
  return reply.code(201).send(testimonial);
});
app.get("/admin/testimonials", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.testimonial.findMany({ orderBy: [{ position: "asc" }, { createdAt: "desc" }] }));
app.post("/admin/testimonials", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object({ displayName: z.string().min(2).max(80), eventType: z.string().min(2).max(60), text: z.string().min(10).max(1000), rating: z.number().int().min(1).max(5).optional(), status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"), position: z.number().int().default(0), consentGiven: z.boolean().default(true) }).parse(request.body);
  const testimonial = await prisma.testimonial.create({ data: input });
  await audit(currentId(request), "CREATE_TESTIMONIAL", "Testimonial", testimonial.id);
  return reply.code(201).send(testimonial);
});
app.patch("/admin/testimonials/:id", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ displayName: z.string().min(2).max(80).optional(), eventType: z.string().min(2).max(60).optional(), text: z.string().min(10).max(1000).optional(), rating: z.number().int().min(1).max(5).nullable().optional(), status: z.enum(["DRAFT", "PUBLISHED"]).optional(), position: z.number().int().optional() }).parse(request.body);
  const updated = await prisma.testimonial.update({ where: { id }, data: input });
  await audit(currentId(request), "UPDATE_TESTIMONIAL", "Testimonial", id, input);
  return updated;
});
app.delete("/admin/testimonials/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await prisma.testimonial.delete({ where: { id } });
  await audit(currentId(request), "DELETE_TESTIMONIAL", "Testimonial", id);
  return reply.code(204).send();
});

// Blog éditorial (§18) : socle éditorial d'abord, jamais de génération autonome en production —
// un brouillon (écrit à la main ou généré par IA) suit toujours DRAFT → IN_REVIEW → APPROVED →
// PUBLISHED, chaque transition journalisée dans ArticleReviewLog, jamais sautée automatiquement.
const FORBIDDEN_WORD = /musulman/i;
const assertNoForbiddenWord = (...fields: (string | null | undefined)[]) => {
  if (fields.some(f => f && FORBIDDEN_WORD.test(f))) throw httpError(400, "Ce mot n’est pas autorisé sur les pages publiques ou le blog (voir la charte éditoriale).");
};
const logArticleTransition = (articleId: string, actorId: string | undefined, fromStatus: string, toStatus: string, note?: string) =>
  prisma.articleReviewLog.create({ data: { articleId, actorId, fromStatus: fromStatus as any, toStatus: toStatus as any, note } });

app.get("/articles", async (request) => {
  const query = z.object({ category: z.string().optional(), keyword: z.string().optional(), q: z.string().optional() }).parse(request.query);
  return prisma.article.findMany({
    where: {
      status: "PUBLISHED", category: query.category, keywords: query.keyword ? { has: query.keyword } : undefined,
      OR: query.q ? [{ title: { contains: query.q, mode: "insensitive" } }, { excerpt: { contains: query.q, mode: "insensitive" } }] : undefined
    },
    orderBy: { publishedAt: "desc" }
  });
});
app.get("/articles/:slug", async (request, reply) => {
  const { slug } = z.object({ slug: z.string() }).parse(request.params);
  const article = await prisma.article.findFirst({ where: { slug, status: "PUBLISHED" }, include: { author: true } });
  if (!article) return reply.code(404).send({ error: "Article introuvable" });
  return article;
});

const articleWritableFields = {
  title: z.string().min(3).max(200), slug: z.string().regex(/^[a-z0-9-]+$/), excerpt: z.string().max(400).optional(),
  content: z.string().min(20), imageUrl: z.string().optional(), category: z.string().min(2).max(60),
  keywords: z.array(z.string()).max(10).default([]), metaTitle: z.string().max(70).optional(), metaDescription: z.string().max(160).optional()
};
app.get("/admin/articles", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const query = z.object({ status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]).optional() }).parse(request.query);
  return prisma.article.findMany({ where: { status: query.status }, include: { author: true }, orderBy: { updatedAt: "desc" } });
});
app.get("/admin/articles/:id", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return prisma.article.findUniqueOrThrow({ where: { id }, include: { author: true, reviewLogs: { orderBy: { createdAt: "desc" } } } });
});
app.post("/admin/articles", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object(articleWritableFields).parse(request.body);
  assertNoForbiddenWord(input.title, input.excerpt, input.content, input.metaTitle, input.metaDescription);
  const article = await prisma.article.create({ data: { ...input, authorId: currentId(request) } });
  await audit(currentId(request), "CREATE_ARTICLE", "Article", article.id);
  return reply.code(201).send(article);
});
app.patch("/admin/articles/:id", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ ...Object.fromEntries(Object.entries(articleWritableFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) }).parse(request.body);
  assertNoForbiddenWord(input.title, input.excerpt, input.content, input.metaTitle, input.metaDescription);
  const updated = await prisma.article.update({ where: { id }, data: input });
  await audit(currentId(request), "UPDATE_ARTICLE", "Article", id);
  return updated;
});
app.delete("/admin/articles/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await prisma.article.delete({ where: { id } });
  await audit(currentId(request), "DELETE_ARTICLE", "Article", id);
  return reply.code(204).send();
});
app.post("/admin/articles/:id/image", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Aucun fichier reçu" });
  const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!extension) return reply.code(415).send({ error: "Format non pris en charge (jpeg, png ou webp uniquement)" });
  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image trop volumineuse (5 Mo maximum)" });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(articleUploadsDir, filename), buffer);
  const updated = await prisma.article.update({ where: { id }, data: { imageUrl: `/static/uploads/articles/${filename}` } });
  await audit(currentId(request), "UPDATE_ARTICLE_IMAGE", "Article", id);
  return updated;
});

// Validation humaine obligatoire (§18) : chaque transition passe par une route dédiée et distincte,
// jamais un simple PATCH de statut, pour que le journal de validation reste toujours cohérent.
app.post("/admin/articles/:id/submit-for-review", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "DRAFT") return reply.code(409).send({ error: "Seul un brouillon peut être soumis à validation" });
  const updated = await prisma.article.update({ where: { id }, data: { status: "IN_REVIEW" } });
  await logArticleTransition(id, currentId(request), article.status, "IN_REVIEW");
  return updated;
});
app.post("/admin/articles/:id/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, note } = z.object({ accept: z.boolean(), note: z.string().max(1000).optional() }).parse(request.body);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "IN_REVIEW") return reply.code(409).send({ error: "Cet article n’est pas en attente de validation" });
  const nextStatus = accept ? "APPROVED" : "DRAFT";
  const updated = await prisma.article.update({ where: { id }, data: { status: nextStatus } });
  await logArticleTransition(id, currentId(request), article.status, nextStatus, note);
  return updated;
});
app.post("/admin/articles/:id/schedule", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { publishAt } = z.object({ publishAt: z.string() }).parse(request.body);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "APPROVED") return reply.code(409).send({ error: "Seul un article déjà validé peut être programmé" });
  const updated = await prisma.article.update({ where: { id }, data: { scheduledAt: new Date(publishAt) } });
  await audit(currentId(request), "SCHEDULE_ARTICLE", "Article", id, { publishAt });
  return updated;
});
app.post("/admin/articles/:id/publish", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "APPROVED") return reply.code(409).send({ error: "Seul un article déjà validé peut être publié" });
  const updated = await prisma.article.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null } });
  await logArticleTransition(id, currentId(request), article.status, "PUBLISHED");
  return updated;
});
app.post("/admin/articles/:id/archive", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "PUBLISHED") return reply.code(409).send({ error: "Seul un article publié peut être archivé" });
  const updated = await prisma.article.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  await logArticleTransition(id, currentId(request), article.status, "ARCHIVED");
  return updated;
});

// Génération IA de brouillons et de propositions sociales (§18) : toujours DRAFT, jamais publiée
// sans repasser par le circuit de validation ci-dessus.
app.post("/admin/articles/generate", { preHandler: roles(UserRole.ADMIN), config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const { topic, category } = z.object({ topic: z.string().min(3).max(200), category: z.string().min(2).max(60) }).parse(request.body);
  const draft = await aiProvider.generateDraft(topic, category);
  const slug = `${draft.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${randomUUID().slice(0, 6)}`;
  const article = await prisma.article.create({ data: { ...draft, slug, category, status: "DRAFT", aiGenerated: true, aiPrompt: topic, authorId: currentId(request) } });
  await audit(currentId(request), "GENERATE_ARTICLE_DRAFT", "Article", article.id, { topic, category });
  return reply.code(201).send(article);
});
app.post("/admin/articles/:id/social-copy", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  return aiProvider.generateSocialCopy(article);
});

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

// Minimum de participants (§10) : à la date limite, si le seuil n'est pas atteint, notifie le
// restaurateur et ouvre une fenêtre de réponse courte (AppSetting MIN_PARTICIPANTS_DECISION_WINDOW_HOURS) ;
// sans décision explicite dans ce délai, applique l'action par défaut (AppSetting
// MIN_PARTICIPANTS_NO_RESPONSE_ACTION, "maintien" par défaut pour éviter une annulation surprise).
const checkMinParticipantsThresholds = async () => {
  const dueForNotification = await prisma.event.findMany({
    where: { status: EventStatus.PUBLISHED, minParticipants: { not: null }, minParticipantsDeadline: { lt: new Date() }, minParticipantsNotifiedAt: null },
    include: { controllerRestaurant: true, _count: { select: { reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } }
  });
  for (const event of dueForNotification) {
    if (event._count.reservations >= (event.minParticipants ?? 0)) { await prisma.event.update({ where: { id: event.id }, data: { minParticipantsNotifiedAt: new Date() } }); continue; }
    await prisma.event.update({ where: { id: event.id }, data: { minParticipantsNotifiedAt: new Date() } });
    const windowHours = getSetting("MIN_PARTICIPANTS_DECISION_WINDOW_HOURS");
    if (event.controllerRestaurant) await notify(event.controllerRestaurant.ownerId, "Minimum de participants non atteint", `« ${event.title} » n’a pas atteint son minimum de ${event.minParticipants} participants. Vous avez ${windowHours}h pour maintenir ou annuler, sans quoi l’événement sera maintenu par défaut.`);
    const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN } });
    await Promise.all(admins.map(a => notify(a.id, "Minimum de participants non atteint", `« ${event.title} » n’a pas atteint son minimum de participants.`)));
    await audit(undefined, "MIN_PARTICIPANTS_NOT_REACHED", "Event", event.id, { minParticipants: event.minParticipants, confirmedCount: event._count.reservations });
  }
  const windowHours = getSetting("MIN_PARTICIPANTS_DECISION_WINDOW_HOURS");
  const dueForDefaultDecision = await prisma.event.findMany({ where: { status: EventStatus.PUBLISHED, minParticipantsNotifiedAt: { not: null, lt: new Date(Date.now() - windowHours * 60 * 60_000) }, minParticipantsOutcome: null } });
  for (const event of dueForDefaultDecision) {
    const action = getSetting("MIN_PARTICIPANTS_NO_RESPONSE_ACTION");
    if (action === "CANCEL") {
      await cancelEventWithRefunds(event, undefined, "MIN_PARTICIPANTS_AUTO_CANCELLED");
      await prisma.event.update({ where: { id: event.id }, data: { minParticipantsOutcome: "CANCELLED", minParticipantsDecidedAt: new Date() } });
    } else {
      await prisma.event.update({ where: { id: event.id }, data: { minParticipantsOutcome: "MAINTAINED", minParticipantsDecidedAt: new Date() } });
      await audit(undefined, "MIN_PARTICIPANTS_AUTO_MAINTAINED", "Event", event.id);
    }
  }
};
setInterval(() => { checkMinParticipantsThresholds().catch(err => app.log.error(err)); }, 60_000);

// Rappel d'événement (§13) : envoyé une seule fois par réservation confirmée, dans la fenêtre qui
// précède le début de l'événement (AppSetting EVENT_REMINDER_HOURS_BEFORE, §23 — délai provisoire
// non fixé par le cahier des charges). reminderSentAt rend le balayage idempotent même si le
// serveur redémarre entre deux passages.
const sendEventReminders = async () => {
  const hoursBefore = getSetting("EVENT_REMINDER_HOURS_BEFORE");
  const due = await prisma.reservation.findMany({
    where: { confirmedAt: { not: null }, cancelledAt: null, reminderSentAt: null, event: { startsAt: { gt: new Date(), lte: new Date(Date.now() + hoursBefore * 60 * 60_000) } } },
    include: { event: true }
  });
  for (const reservation of due) {
    await prisma.reservation.update({ where: { id: reservation.id }, data: { reminderSentAt: new Date() } });
    await notify(reservation.userId, "Votre événement approche", `« ${reservation.event.title} » a lieu le ${reservation.event.startsAt.toLocaleString("fr-FR")}. À très vite !`);
  }
};
setInterval(() => { sendEventReminders().catch(err => app.log.error(err)); }, 60_000);

// Programmation d'articles (§18) : ne publie jamais depuis DRAFT ou IN_REVIEW, uniquement un
// article déjà explicitement validé (APPROVED) dont la date programmée est atteinte.
const publishScheduledArticles = async () => {
  const due = await prisma.article.findMany({ where: { status: "APPROVED", scheduledAt: { lte: new Date() } } });
  for (const article of due) {
    await prisma.article.update({ where: { id: article.id }, data: { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null } });
    await logArticleTransition(article.id, undefined, article.status, "PUBLISHED", "Publication automatique programmée");
  }
};
setInterval(() => { publishScheduledArticles().catch(err => app.log.error(err)); }, 60_000);

const close = async () => { await prisma.$disconnect(); await app.close(); };
process.on("SIGINT", close); process.on("SIGTERM", close);
await loadSettings(prisma);
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
