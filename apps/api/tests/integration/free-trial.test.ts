// Essai gratuit sans carte bancaire (décision du 2026-11-10) : vérifié contre le vrai serveur et une
// vraie base, comme les autres tests d'intégration. Aucun appel Stripe : l'essai n'en crée pas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addRestaurantPhoto, adminToken, api, deleteTestUsers, ensureServerRunning, prisma, testPhone } from "./helpers.js";

const createdUserIds: string[] = [];
beforeAll(ensureServerRunning);
afterAll(async () => { await deleteTestUsers(createdUserIds); });

// Restaurateur qui vient de déposer sa demande : établissement encore en attente d'examen.
async function pendingRestaurateur(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  const { body: me } = await api<{ id: string }>("/me", {}, verify.token);
  createdUserIds.push(me.id);
  const { body: restaurant } = await api<{ id: string }>("/restaurants/apply", { method: "POST", body: JSON.stringify({ name: `${displayName} Resto`, managerName: displayName, siret: "12345678900019" }) }, verify.token);
  return { token: verify.token, restaurantId: restaurant.id };
}

describe("Essai gratuit restaurateur sans carte bancaire", () => {
  it("démarre une seule fois, sans Stripe, repart à la validation et ne valide pas l'établissement", async () => {
    const resto = await pendingRestaurateur("EssaiGratuit");
    const plan = await prisma.plan.findFirstOrThrow({ where: { active: true }, orderBy: { monthlyPriceCents: "asc" } });

    const offer = await api<{ months: number }>("/plans/free-trial");
    expect(offer.status).toBe(200);
    expect(offer.body.months).toBe(1);
    const before = await api<{ subscription: unknown; freeTrialMonthsOffered: number }>("/restaurants/me/subscription", {}, resto.token);
    expect(before.body.subscription).toBeNull();
    expect(before.body.freeTrialMonthsOffered).toBe(1);

    // CGV partie B exigées, comme pour une souscription.
    const noCgv = await api<{ cgvRequired: boolean }>("/restaurants/me/subscription/free-trial", { method: "POST", body: JSON.stringify({ planId: plan.id }) }, resto.token);
    expect(noCgv.status).toBe(422);
    expect(noCgv.body.cgvRequired).toBe(true);
    expect(await prisma.restaurantSubscription.count({ where: { restaurantId: resto.restaurantId } })).toBe(0);

    const started = await api<{ status: string; freeTrial: boolean; currentPeriodEnd: string }>("/restaurants/me/subscription/free-trial", { method: "POST", body: JSON.stringify({ planId: plan.id, acceptCgv: true }) }, resto.token);
    expect(started.status).toBe(201);
    expect(started.body.status).toBe("TRIALING");
    expect(started.body.freeTrial).toBe(true);
    const days = (new Date(started.body.currentPeriodEnd).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const row = await prisma.restaurantSubscription.findUniqueOrThrow({ where: { restaurantId: resto.restaurantId } });
    expect(row.stripeSubscriptionId).toBeNull();
    expect(row.stripeCustomerId).toBeNull();

    // L'essai ne remplace jamais l'examen de la demande par l'équipe.
    expect((await prisma.restaurant.findUniqueOrThrow({ where: { id: resto.restaurantId } })).status).toBe("PENDING");

    const again = await api("/restaurants/me/subscription/free-trial", { method: "POST", body: JSON.stringify({ planId: plan.id, acceptCgv: true }) }, resto.token);
    expect(again.status).toBe(409);
    const during = await api<{ subscription: { freeTrial: boolean; managedByStripe: boolean }; freeTrialMonthsOffered: number }>("/restaurants/me/subscription", {}, resto.token);
    expect(during.body.subscription.freeTrial).toBe(true);
    expect(during.body.subscription.managedByStripe).toBe(false);
    expect(during.body.freeTrialMonthsOffered).toBe(0);

    // Validation par l'équipe quelques jours plus tard : la durée de l'essai repart de ce moment.
    await prisma.restaurantSubscription.update({ where: { restaurantId: resto.restaurantId }, data: { currentPeriodStart: new Date(Date.now() - 5 * 86_400_000), currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } });
    await addRestaurantPhoto(resto.token);
    const decision = await api(`/admin/restaurants/${resto.restaurantId}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, await adminToken());
    expect(decision.status).toBe(200);
    const restarted = await prisma.restaurantSubscription.findUniqueOrThrow({ where: { restaurantId: resto.restaurantId } });
    expect((restarted.currentPeriodEnd.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(27);
    expect(restarted.status).toBe("TRIALING");

    // Essai arrêté par le restaurateur : l'offre ne revient pas.
    expect((await api("/restaurants/me/subscription/cancel", { method: "POST" }, resto.token)).status).toBe(200);
    const afterCancel = await api("/restaurants/me/subscription/free-trial", { method: "POST", body: JSON.stringify({ planId: plan.id, acceptCgv: true }) }, resto.token);
    expect(afterCancel.status).toBe(409);
  });

  it("est refusé à un établissement refusé par l'équipe", async () => {
    const resto = await pendingRestaurateur("EssaiRefuse");
    const plan = await prisma.plan.findFirstOrThrow({ where: { active: true } });
    await api(`/admin/restaurants/${resto.restaurantId}/decision`, { method: "POST", body: JSON.stringify({ accept: false, reason: "Test" }) }, await adminToken());
    const refused = await api("/restaurants/me/subscription/free-trial", { method: "POST", body: JSON.stringify({ planId: plan.id, acceptCgv: true }) }, resto.token);
    expect(refused.status).toBe(409);
    expect(await prisma.restaurantSubscription.count({ where: { restaurantId: resto.restaurantId } })).toBe(0);
  });
});
