import { UserRole } from "@prisma/client";
import { FastifyRequest } from "fastify";
import { httpError, prisma } from "../context.js";

export type TokenUser = { sub: string; role: UserRole; iat?: number };

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
export const auth = async (request: FastifyRequest) => { await loadCurrentUser(request); };
// C24 : les fiches publiques restent consultables sans compte, mais un visiteur connecté doit voir
// le solde de SA catégorie plutôt qu'un état générique — jamais d'erreur si le jeton est absent ou
// invalide, contrairement à `auth`.
export const optionalAuth = async (request: FastifyRequest) => { try { await loadCurrentUser(request); } catch { /* visiteur anonyme */ } };
export const roles = (...allowed: UserRole[]) => async (request: FastifyRequest) => {
  await loadCurrentUser(request);
  if (!allowed.includes((request.user as TokenUser).role)) throw httpError(403, "Accès non autorisé");
};
export const currentId = (request: FastifyRequest) => (request.user as TokenUser).sub;

export const assertEventAccess = async (request: FastifyRequest, eventId: string) => {
  const token = request.user as TokenUser;
  if (token.role === UserRole.ADMIN) return prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: token.sub } });
  return prisma.event.findFirstOrThrow({ where: { id: eventId, controllerRestaurantId: restaurant.id } });
};
export const ownRestaurant = (token: TokenUser) => token.role === UserRole.ORGANIZER ? prisma.restaurant.findUniqueOrThrow({ where: { ownerId: token.sub } }) : Promise.resolve(null);
