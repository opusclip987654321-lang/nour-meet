import { LEGAL_VERSIONS, MINIMUM_AGE } from "@nour/shared";
import { LegalDocument } from "@prisma/client";
import { FastifyRequest } from "fastify";
import { deleteUploadedFile, prisma } from "../context.js";

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
export const anonymizeUser = async (userId: string) => {
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

export const profileAge = (birthDate?: Date | null) => birthDate ? Math.floor((Date.now() - birthDate.getTime()) / 31_557_600_000) : null;

// Acceptation des textes juridiques (CGU à la complétion du profil, CGV avant chaque paiement) :
// enregistrée avec la version en vigueur (LEGAL_VERSIONS), l'horodatage, l'IP et le navigateur,
// pour pouvoir prouver quelle version exacte a été acceptée, par qui et quand.
export const hasAcceptedCurrent = async (userId: string, document: LegalDocument, context?: string) =>
  !!(await prisma.legalAcceptance.findFirst({ where: { userId, document, version: LEGAL_VERSIONS[document], ...(context ? { context } : {}) }, select: { id: true } }));
export const recordAcceptance = async (request: FastifyRequest, userId: string, document: LegalDocument, context: string) => {
  if (await hasAcceptedCurrent(userId, document, context)) return;
  await prisma.legalAcceptance.create({ data: { userId, document, version: LEGAL_VERSIONS[document], context, ip: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 500) } });
};
export const ADULT_ONLY_ERROR = `Nūr Meet est réservé aux personnes de ${MINIMUM_AGE} ans et plus : renseignez votre date de naissance dans votre profil.`;
