import { UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, app, httpError, prisma, restaurantUploadsDir, smsVerification, stripe } from "../context.js";
import { currentYearMonth } from "../domain.js";
import { env } from "../env.js";
import { audit } from "../services/audit.js";
import { auth, currentId, roles } from "../services/auth.js";
import { notify } from "../services/notify.js";
import { cancelPendingPlanChange, changeSubscriptionPlan, recordCheckoutSession, syncSubscriptionFromStripe } from "../services/subscriptions.js";
import { getSetting } from "../settings.js";

// Jamais les notes internes de l'administration, le taux de commission, l'auteur de la décision ni le
// marquage démo dans une réponse destinée au restaurateur : informations internes de Nūr Meet
// (§6.2 des corrections web 2026-09-24). Appliqué à toutes les routes qui renvoient sa fiche.
const ownRestaurantView = <T extends { adminNotes?: unknown; commissionRate?: unknown; reviewedBy?: unknown; isDemo?: unknown }>(restaurant: T) => {
  const { adminNotes: _adminNotes, commissionRate: _commissionRate, reviewedBy: _reviewedBy, isDemo: _isDemo, ...visible } = restaurant;
  return visible;
};
app.get("/restaurants/me", { preHandler: auth }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: currentId(request) }, include: { photos: { orderBy: { position: "asc" } }, subscription: { include: { plan: true } }, connectedAccount: true } });
  if (!restaurant) return reply.code(404).send({ error: "Aucune demande restaurateur" });
  const usage = await prisma.restaurantMonthlyUsage.findUnique({ where: { restaurantId_yearMonth: { restaurantId: restaurant.id, yearMonth: currentYearMonth() } } });
  return { ...ownRestaurantView(restaurant), currentMonthEventsPublished: usage?.eventsPublished ?? 0, trialDays: getSetting("RESTAURANT_TRIAL_DAYS") };
});
// §19/§20 : formulaire explicitement cité comme devant être protégé contre un abus automatisé,
// au même titre que l'authentification et la génération IA.
// Plafond relâché uniquement en mode SMS simulé (développement, tests d'intégration), comme pour l'OTP.
app.post("/restaurants/apply", { preHandler: auth, config: { rateLimit: { max: smsVerification.mode === "mock" ? 100 : 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
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
  await Promise.all(admins.map(a => notify(a.id, "Nouvelle demande restaurateur", `${input.name} souhaite ouvrir un compte professionnel.`, "/admin/restaurants")));
  await audit(userId, "APPLY_RESTAURANT", "Restaurant", restaurant.id);
  return reply.code(201).send(ownRestaurantView(restaurant));
});
app.get("/admin/restaurants", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const query = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional() }).parse(request.query);
  // Fiche complète pour la vue admin (§8.1) : galerie, coordonnées, disponibilité, conditions
  // tarifaires, statut de l'abonnement et du compte connecté. Les notes internes (adminNotes) sont
  // un champ de la fiche elle-même, jamais exposées au restaurateur (voir /restaurants/me).
  return prisma.restaurant.findMany({ where: query.status ? { status: query.status } : undefined, include: { owner: true, photos: { orderBy: { position: "asc" } }, subscription: { include: { plan: true } }, connectedAccount: true }, orderBy: { submittedAt: "desc" } });
});
app.patch("/admin/restaurants/:id/notes", { preHandler: roles(UserRole.ADMIN) }, async (request, _reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { adminNotes } = z.object({ adminNotes: z.string().max(2000).nullable() }).parse(request.body);
  const updated = await prisma.restaurant.update({ where: { id }, data: { adminNotes } });
  await audit(currentId(request), "UPDATE_RESTAURANT_NOTES", "Restaurant", id);
  return updated;
});
app.post("/admin/restaurants/:id/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, reason } = z.object({ accept: z.boolean(), reason: z.string().max(1000).optional() }).parse(request.body);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id }, include: { owner: true, _count: { select: { photos: true } } } });
  if (restaurant.status !== "PENDING") return reply.code(409).send({ error: "Cette demande a déjà été traitée" });
  const adminId = currentId(request);
  if (accept && restaurant._count.photos === 0) return reply.code(409).send({ error: "Au moins une photo de l’établissement est requise avant l’approbation" });
  if (accept) {
    // Instructions définitives 2026-09-20 : le choix commercial de la formule (et son paiement via
    // Stripe Checkout) est distinct de l'autorisation de publier — l'approbation ne crée plus
    // automatiquement d'abonnement. Le restaurateur choisit lui-même Standard/Premium sur
    // /restaurant?tab=subscription, avant ou après cette approbation.
    const [updated] = await prisma.$transaction([
      prisma.restaurant.update({ where: { id }, data: { status: "APPROVED", verifiedAt: new Date(), reviewedBy: adminId, rejectionReason: null } }),
      prisma.user.update({ where: { id: restaurant.ownerId }, data: { role: restaurant.owner.role === UserRole.PARTICIPANT ? UserRole.ORGANIZER : restaurant.owner.role } })
    ]);
    await notify(restaurant.ownerId, "Compte restaurateur approuvé", "Votre établissement est validé. Choisissez votre formule d’abonnement pour commencer à publier vos événements.", "/restaurant?tab=subscription");
    await audit(adminId, "APPROVE_RESTAURANT", "Restaurant", id);
    return updated;
  }
  const updated = await prisma.restaurant.update({ where: { id }, data: { status: "REJECTED", reviewedBy: adminId, rejectionReason: reason ?? null } });
  await notify(restaurant.ownerId, "Demande restaurateur refusée", reason ?? "Votre demande n’a pas été retenue.", "/restaurant");
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
  return ownRestaurantView(updated);
});
// Au moins une photo de l'établissement est obligatoire (demande d'approbation, puis chaque soirée
// soumise) : l'envoi est donc ouvert dès la demande, pas seulement après approbation. Un compte
// suspendu ne modifie plus sa galerie.
app.post("/restaurants/me/photos", { preHandler: auth }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: currentId(request) } });
  if (!restaurant || restaurant.status === "SUSPENDED") return reply.code(403).send({ error: "Aucun établissement modifiable pour ce compte" });
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
app.delete("/restaurants/me/photos/:photoId", { preHandler: auth }, async (request, reply) => {
  const { photoId } = z.object({ photoId: z.string() }).parse(request.params);
  const restaurant = await prisma.restaurant.findUnique({ where: { ownerId: currentId(request) } });
  if (!restaurant || restaurant.status === "SUSPENDED") return reply.code(403).send({ error: "Aucun établissement modifiable pour ce compte" });
  const deleted = await prisma.restaurantPhoto.deleteMany({ where: { id: photoId, restaurantId: restaurant.id } });
  if (deleted.count === 0) return reply.code(404).send({ error: "Photo introuvable" });
  return reply.code(204).send();
});

// Abonnement (§8.2) : résiliable à tout moment par le restaurateur, jamais réactivé seul (une
// nouvelle souscription passe par l'administration). La résiliation bloque les prochaines
// publications mais ne touche jamais les événements déjà vendus.
// C09 (instructions définitives 2026-09-20) : la résiliation demandée par le restaurateur ne coupe
// jamais immédiatement l'accès — elle programme l'arrêt à la fin de la période déjà payée côté
// Stripe (cancel_at_period_end), les avantages restent acquis jusque là. Le passage réel au statut
// CANCELLED n'arrive que via le webhook customer.subscription.deleted, à l'échéance.
app.post("/restaurants/me/subscription/cancel", { preHandler: auth }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const subscription = await prisma.restaurantSubscription.findUnique({ where: { restaurantId: restaurant.id } });
  if (!subscription || subscription.status === "CANCELLED") return reply.code(409).send({ error: "Aucun abonnement actif à résilier" });
  if (subscription.stripeSubscriptionId && stripe) {
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true });
    const updated = await prisma.restaurantSubscription.update({ where: { restaurantId: restaurant.id }, data: { cancelAtPeriodEnd: true } });
    await audit(currentId(request), "CANCEL_SUBSCRIPTION_AT_PERIOD_END", "RestaurantSubscription", updated.id);
    return updated;
  }
  // Abonnement géré manuellement par l'administration (jamais passé par Stripe) : seul cas où l'on
  // continue à couper le statut directement, faute d'objet Stripe à programmer.
  const updated = await prisma.restaurantSubscription.update({ where: { restaurantId: restaurant.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await audit(currentId(request), "CANCEL_SUBSCRIPTION", "RestaurantSubscription", updated.id);
  return updated;
});
// Portail Stripe (gestion du moyen de paiement, factures) — C09.
app.post("/restaurants/me/subscription/portal", { preHandler: auth }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe non configuré" });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  const subscription = await prisma.restaurantSubscription.findUnique({ where: { restaurantId: restaurant.id } });
  if (!subscription?.stripeCustomerId) return reply.code(409).send({ error: "Aucun abonnement Stripe actif" });
  const session = await stripe.billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${env.WEB_ORIGIN}/restaurant?tab=subscription` });
  return { url: session.url };
});
// C06/C07/C08 (instructions définitives 2026-09-20) : vrai tunnel Stripe Checkout en mode
// abonnement, carte obligatoire dès l'essai (Checkout collecte toujours le moyen de paiement),
// essai (RESTAURANT_TRIAL_DAYS) géré par Stripe lui-même (trial_period_days) — jamais simulé par un simple
// changement de statut local. Accessible dès le dépôt de candidature (PENDING), pas seulement une
// fois approuvé : le choix commercial de la formule est distinct de l'autorisation de publier.
app.post("/restaurants/me/subscription/checkout", { preHandler: auth }, async (request, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe n’est pas configuré sur ce serveur : paiement d’abonnement non opérationnel." });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) }, include: { owner: true, subscription: true } });
  const { planId, billingPeriod } = z.object({ planId: z.string(), billingPeriod: z.enum(["MONTHLY", "ANNUAL"]) }).parse(request.body);
  // Un abonnement en cours se modifie via /subscription/change-plan (prorata ou changement différé),
  // jamais par un second Checkout qui créerait un deuxième abonnement facturé en parallèle.
  if (restaurant.subscription?.stripeSubscriptionId && restaurant.subscription.status !== "CANCELLED") return reply.code(409).send({ error: "Un abonnement existe déjà pour cet établissement : utilisez « Changer de formule »." });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  const priceId = billingPeriod === "ANNUAL" ? plan.stripePriceAnnualId : plan.stripePriceMonthlyId;
  if (!priceId) return reply.code(409).send({ error: `Formule ${plan.name} indisponible en facturation ${billingPeriod === "ANNUAL" ? "annuelle" : "mensuelle"} pour le moment.` });
  // Un seul client Stripe par établissement, et une seule session Checkout ouverte à la fois : deux
  // onglets payés en parallèle créeraient sinon deux abonnements facturés (revue de sécurité 2026-09-24).
  let customerId = restaurant.subscription?.stripeCustomerId ?? (await stripe.customers.search({ query: `metadata['restaurantId']:'${restaurant.id}'`, limit: 1 })).data[0]?.id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: restaurant.owner.email ?? undefined, name: restaurant.name, metadata: { restaurantId: restaurant.id } });
    customerId = customer.id;
  } else {
    const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 10 });
    await Promise.all(open.data.map(s => stripe!.checkout.sessions.expire(s.id).catch(() => null)));
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // L'essai gratuit n'est offert qu'une fois par établissement : un restaurateur qui se réabonne
    // après une résiliation (ou qui quitte un abonnement géré à la main) paie dès la souscription.
    subscription_data: { ...(restaurant.subscription ? {} : { trial_period_days: getSetting("RESTAURANT_TRIAL_DAYS") }), metadata: { restaurantId: restaurant.id, planId, billingPeriod } },
    payment_method_collection: "always",
    metadata: { restaurantId: restaurant.id, planId, billingPeriod },
    success_url: `${env.WEB_ORIGIN}/restaurant?tab=subscription&checkout=success`,
    cancel_url: `${env.WEB_ORIGIN}/restaurant?tab=subscription&checkout=cancel`
  });
  await audit(currentId(request), "SUBSCRIPTION_CHECKOUT_CREATED", "Restaurant", restaurant.id, { planId, billingPeriod });
  return { url: session.url };
});
// Corrections web 2026-09-24 (§1.4) : changement de formule d'un abonnement déjà souscrit — immédiat
// avec prorata vers une formule supérieure, à l'échéance vers une formule inférieure (règle dans
// services/subscriptions.ts). La réponse reflète toujours l'état relu chez Stripe.
const ownSubscription = async (userId: string) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: userId } });
  const subscription = await prisma.restaurantSubscription.findUnique({ where: { restaurantId: restaurant.id }, include: { plan: true } });
  if (!subscription) throw httpError(404, "Aucun abonnement pour cet établissement");
  return { restaurant, subscription };
};
app.post("/restaurants/me/subscription/change-plan", { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request) => {
  const { planId } = z.object({ planId: z.string() }).parse(request.body);
  const { subscription } = await ownSubscription(currentId(request));
  const target = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  const result = await changeSubscriptionPlan(subscription, target);
  await audit(currentId(request), result.direction === "UPGRADE" ? "SUBSCRIPTION_UPGRADED" : "SUBSCRIPTION_DOWNGRADE_SCHEDULED", "RestaurantSubscription", subscription.id, { from: subscription.planId, to: target.id });
  return result;
});
app.post("/restaurants/me/subscription/cancel-plan-change", { preHandler: auth }, async (request) => {
  const { subscription } = await ownSubscription(currentId(request));
  const updated = await cancelPendingPlanChange(subscription);
  await audit(currentId(request), "SUBSCRIPTION_PLAN_CHANGE_CANCELLED", "RestaurantSubscription", subscription.id);
  return updated;
});
// Relecture explicite de l'état Stripe (retour de Checkout avant l'arrivée du webhook, ou webhook non
// reçu en local) : l'interface n'affiche ainsi jamais un statut que Stripe ne confirme pas.
app.post("/restaurants/me/subscription/sync", { preHandler: auth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { ownerId: currentId(request) } });
  if (!stripe) return reply.code(503).send({ error: "Stripe non configuré" });
  const subscription = await prisma.restaurantSubscription.findUnique({ where: { restaurantId: restaurant.id } });
  if (subscription?.stripeSubscriptionId) return syncSubscriptionFromStripe(subscription, await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId));
  // Checkout terminé mais webhook pas encore reçu : on retrouve l'abonnement par le client Stripe
  // créé pour cet établissement (metadata.restaurantId), jamais par une simple supposition.
  const customerId = subscription?.stripeCustomerId ?? (await stripe.customers.search({ query: `metadata['restaurantId']:'${restaurant.id}'`, limit: 1 })).data[0]?.id;
  if (!customerId) return reply.code(404).send({ error: "Aucun abonnement Stripe trouvé" });
  const sessions = await stripe.checkout.sessions.list({ limit: 5, customer: customerId });
  const completed = sessions.data.find(s => s.metadata?.restaurantId === restaurant.id && s.status === "complete" && s.subscription);
  if (!completed) return subscription ? prisma.restaurantSubscription.findUnique({ where: { id: subscription.id }, include: { plan: true } }) : reply.code(404).send({ error: "Aucun abonnement Stripe trouvé" });
  return recordCheckoutSession(completed);
});
// Formules actives lisibles par tout compte authentifié (page d'abonnement restaurateur) — jamais
// les champs internes Stripe, seulement ce qui doit s'afficher.
app.get("/plans", { preHandler: auth }, async () => prisma.plan.findMany({ where: { active: true }, orderBy: { monthlyPriceCents: "asc" }, select: { id: true, name: true, monthlyPriceCents: true, annualPriceCents: true, monthlyEventQuota: true, highlightTier: true } }));
app.get("/admin/plans", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.plan.findMany({ orderBy: { createdAt: "asc" } }));
app.post("/admin/plans", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object({ name: z.string().min(2).max(80), monthlyPriceCents: z.number().int().min(0), annualPriceCents: z.number().int().min(0).nullable().optional(), monthlyEventQuota: z.number().int().min(1).nullable(), highlightTier: z.enum(["simple", "priority"]).nullable().optional(), active: z.boolean().default(true) }).parse(request.body);
  const plan = await prisma.plan.create({ data: input });
  await audit(currentId(request), "CREATE_PLAN", "Plan", plan.id, input);
  return reply.code(201).send(plan);
});
// §7 : "supprimer une formule" au sens du cahier des charges veut dire la désactiver (active:false),
// jamais la retirer de la base — ses abonnements historiques restent lisibles et facturables tels
// quels (contrainte ON DELETE RESTRICT sur RestaurantSubscription.planId). Modifier le prix ou le
// quota d'une formule active n'affecte que les nouveaux abonnements ; un abonnement déjà en cours
// change de conditions au prochain renouvellement, jamais rétroactivement.
app.patch("/admin/plans/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, _reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ name: z.string().min(2).max(80).optional(), monthlyPriceCents: z.number().int().min(0).optional(), annualPriceCents: z.number().int().min(0).nullable().optional(), monthlyEventQuota: z.number().int().min(1).nullable().optional(), highlightTier: z.enum(["simple", "priority"]).nullable().optional(), active: z.boolean().optional() }).parse(request.body);
  const plan = await prisma.plan.update({ where: { id }, data: input });
  await audit(currentId(request), "UPDATE_PLAN", "Plan", id, input);
  return plan;
});
app.post("/admin/restaurants/:id/subscription", { preHandler: roles(UserRole.ADMIN) }, async (request, _reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ planId: z.string(), status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "INCOMPLETE"]).optional(), currentPeriodEnd: z.string().optional() }).parse(request.body);
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
  const updated = await prisma.restaurantSubscription.upsert({
    where: { restaurantId: id },
    update: { planId: plan.id, status: input.status ?? undefined, currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : undefined },
    create: { restaurantId: id, planId: plan.id, status: input.status ?? "ACTIVE", currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : new Date(Date.now() + 30 * 24 * 60 * 60_000) }
  });
  await notify(restaurant.ownerId, "Abonnement mis à jour", `Votre abonnement « ${plan.name} » est maintenant ${updated.status === "ACTIVE" ? "actif" : updated.status.toLowerCase()}.`, "/restaurant?tab=subscription");
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
