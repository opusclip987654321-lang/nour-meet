import { UserRole } from "@prisma/client";
import { z } from "zod";
import { app, optionalName, prisma } from "../context.js";
import { normalizePhoneNumber } from "../phone.js";
import { audit } from "../services/audit.js";
import { TokenUser, currentId, ownRestaurant, roles } from "../services/auth.js";
import { notify } from "../services/notify.js";
import { links } from "../services/links.js";

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
  await notify(staffUser.id, "Accès accueil activé", "Vous pouvez désormais scanner les billets de votre établissement.", links.receptionScanner());
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
app.post("/admin/reports/:id/decision", { preHandler: roles(UserRole.ADMIN, UserRole.MODERATOR) }, async (request, _reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { status } = z.object({ status: z.enum(["REVIEWING", "RESOLVED", "DISMISSED"]) }).parse(request.body);
  const updated = await prisma.report.update({ where: { id }, data: { status } });
  await audit(currentId(request), "MODERATE_REPORT", "Report", id, { status });
  return updated;
});
