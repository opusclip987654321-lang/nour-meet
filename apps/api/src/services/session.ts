import type { User } from "@prisma/client";
import { app, httpError, prisma } from "../context.js";

// Session de connexion (2026-09-24) : 90 jours, prolongée automatiquement à chaque visite
// (voir GET /me, qui renvoie un jeton neuf une fois par jour au plus). Un utilisateur actif ne
// se reconnecte donc jamais — c'est ce qui évite d'avoir à renvoyer des codes SMS ou e-mail.
export const SESSION_TTL = "90d";
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;

export const signSession = (user: Pick<User, "id" | "role">) => app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: SESSION_TTL });

// Réponse commune à toutes les méthodes de connexion (SMS, e-mail, Google) : même forme, pour que
// le site et l'application traitent la connexion de la même façon quel que soit le moyen choisi.
export const loginResponse = async (userId: string, isNewUser: boolean) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  if (user.suspendedAt) throw httpError(403, "Compte suspendu");
  if (user.deletedAt) throw httpError(403, "Compte supprimé");
  return { token: signSession(user), isNewUser, user: { id: user.id, phone: user.phone, email: user.email, displayName: user.displayName, role: user.role, profileCompleted: user.profile?.profileCompleted ?? false } };
};

// Numéro vérifié une seule fois, avant la première inscription à une soirée (entretien compris) :
// seul moment où un SMS est encore envoyé. Refus explicite, que le site transforme en étape de
// vérification plutôt qu'en erreur.
export const PHONE_VERIFICATION_REQUIRED = "Pour réserver, confirmez d’abord votre numéro de téléphone (une seule fois, par SMS).";
export const assertPhoneVerified = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } });
  if (!user.phone || !user.phoneVerifiedAt) throw Object.assign(httpError(403, PHONE_VERIFICATION_REQUIRED), { clientFlags: { phoneVerificationRequired: true } });
};
