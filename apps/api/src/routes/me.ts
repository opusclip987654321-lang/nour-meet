import { MINIMUM_AGE, isAdult } from "@nour/shared";
import { LegalDocument } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, app, deleteUploadedFile, prisma, profileUploadsDir } from "../context.js";
import { anonymizeUser, hasAcceptedCurrent, profileAge, recordAcceptance } from "../services/account.js";
import { audit } from "../services/audit.js";
import { TokenUser, auth, currentId } from "../services/auth.js";
import { SESSION_RENEW_AFTER_SECONDS, signSession } from "../services/session.js";

app.get("/me", { preHandler: auth }, async (request) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentId(request) }, include: { profile: true } });
  // hasRestaurant reflète l'existence d'une fiche Restaurant quel que soit son statut (PENDING,
  // APPROVED, REJECTED, SUSPENDED) : c'est ce champ, jamais le rôle, qui bloque la participation aux
  // événements (le rôle ne devient ORGANIZER qu'à l'approbation, bien après la simple candidature).
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: user.id }, select: { id: true } });
  const cguAccepted = await hasAcceptedCurrent(user.id, LegalDocument.CGU);
  // Session glissante (2026-09-24) : au plus une fois par jour, un jeton neuf de 90 jours remplace
  // l'ancien — un utilisateur actif n'a jamais à se reconnecter (ni à redemander un code).
  const token = request.user as TokenUser;
  const refreshedToken = token.iat && Date.now() / 1000 - token.iat > SESSION_RENEW_AFTER_SECONDS ? signSession(user) : undefined;
  const googleLinked = !!(await prisma.authIdentity.findFirst({ where: { userId: user.id, provider: "google" }, select: { id: true } }));
  return { id: user.id, phone: user.phone, phoneVerified: !!user.phoneVerifiedAt, email: user.email, displayName: user.displayName, role: user.role, profile: user.profile, age: profileAge(user.profile?.birthDate), hasRestaurant: !!restaurant, cguAccepted, googleLinked, ...(refreshedToken ? { refreshedToken } : {}) };
});

// CGU §2 : la date de naissance est obligatoire et doit correspondre à une personne majeure ; les
// CGU en vigueur doivent avoir été acceptées (une fois par version, pas à chaque modification).
app.patch("/me/profile", { preHandler: auth }, async (request, reply) => {
  const input = z.object({ displayName: z.string().min(2), email: z.string().email().nullable().optional(), birthDate: z.string().refine(v => !Number.isNaN(new Date(v).getTime()) && new Date(v).getUTCFullYear() >= 1900, "Date de naissance invalide"), city: z.string().min(2), profession: z.string().optional(), interests: z.array(z.string()).max(12), bio: z.string().max(600).optional(), quotaCategory: z.enum(["HOMME", "FEMME"]).nullable().optional(), acceptCgu: z.boolean().optional() }).parse(request.body);
  const userId = currentId(request);
  if (!isAdult(input.birthDate)) return reply.code(422).send({ error: `Nūr Meet est réservé aux personnes de ${MINIMUM_AGE} ans et plus.` });
  if (!input.acceptCgu && !(await hasAcceptedCurrent(userId, LegalDocument.CGU))) return reply.code(422).send({ error: "Vous devez accepter les conditions générales d’utilisation pour continuer." });
  if (input.acceptCgu) await recordAcceptance(request, userId, LegalDocument.CGU, "profile");
  const profileData = { birthDate: new Date(input.birthDate), city: input.city, profession: input.profession, interests: input.interests, bio: input.bio, quotaCategory: input.quotaCategory, profileCompleted: true };
  // Une nouvelle adresse n'est plus « vérifiée » : elle le redeviendra à la prochaine connexion par code.
  const previousEmail = (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email;
  const emailChanged = input.email !== undefined && (input.email?.toLowerCase() ?? null) !== previousEmail;
  const user = await prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName, email: input.email?.toLowerCase() ?? input.email, ...(emailChanged ? { emailVerifiedAt: null } : {}), profile: { upsert: { create: profileData, update: profileData } } }, include: { profile: true } });
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
    prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, authIdentities: { select: { provider: true, email: true, createdAt: true } } } }),
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
    account: { id: user.id, phone: user.phone, phoneVerifiedAt: user.phoneVerifiedAt, email: user.email, displayName: user.displayName, role: user.role, createdAt: user.createdAt, linkedAccounts: user.authIdentities },
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
