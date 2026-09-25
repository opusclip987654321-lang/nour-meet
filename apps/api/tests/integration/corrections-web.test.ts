// Corrections web du 2026-09-24 : règles critiques vérifiées contre le vrai serveur et une vraie base
// (et Stripe en mode test pour les abonnements), comme critical-flows.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishDailyArticle } from "../../src/services/blog-autopublish.js";
import type { AIProvider } from "../../src/ai-provider.js";
import { API_URL, NETWORKING_ANSWERS_FIXTURE, addRestaurantPhoto, adminToken, api, applyToEvent, deleteTestUsers, ensureServerRunning, payAndConfirm, prisma, signStripeWebhook, stripe, testPhone } from "./helpers.js";

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];
const createdArticleIds: string[] = [];
beforeAll(ensureServerRunning);
afterAll(async () => {
  for (const id of createdEventIds) await prisma.event.delete({ where: { id } }).catch(() => {});
  await deleteTestUsers(createdUserIds);
  for (const id of createdArticleIds) await prisma.article.delete({ where: { id } }).catch(() => {});
});

async function participant(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName, city: "Paris", interests: [] }) }, body.token);
  const { body: me } = await api<{ id: string }>("/me", {}, body.token);
  createdUserIds.push(me.id);
  return { token: body.token, userId: me.id };
}
async function organizer(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  const { body: me } = await api<{ id: string }>("/me", {}, verify.token);
  createdUserIds.push(me.id);
  const { body: restaurant } = await api<{ id: string }>("/restaurants/apply", { method: "POST", body: JSON.stringify({ name: `${displayName} Resto`, managerName: displayName, siret: "12345678900019" }) }, verify.token);
  await addRestaurantPhoto(verify.token);
  await api(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, await adminToken());
  const { body: reverify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) });
  return { token: reverify.token, userId: me.id, restaurantId: restaurant.id };
}
const day = (n: number, hour = 19) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0); return d; };
async function publishedEvent(overrides: Record<string, unknown> = {}) {
  const event = await prisma.event.create({ data: {
    slug: `test-corr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: "Test corrections", category: "Networking", flow: "DIRECT",
    description: "Événement de test pour les corrections web.", startsAt: day(20), endsAt: day(20, 22), district: "Paris", address: "1 rue de test",
    zone: "Paris intra-muros", capacity: 10, priceCents: 2500, status: "PUBLISHED", ...overrides
  } });
  createdEventIds.push(event.id);
  return event;
}

describe("catalogue /events : futurs uniquement, ordre chronologique réel, statut du visiteur (§5)", () => {
  it("n'affiche pas un événement passé et place septembre avant octobre", async () => {
    const past = await publishedEvent({ startsAt: day(-2), endsAt: day(-2, 22) });
    const later = await publishedEvent({ startsAt: day(40), endsAt: day(40, 22) });
    const sooner = await publishedEvent({ startsAt: day(5), endsAt: day(5, 22) });
    const { body } = await api<{ items: { id: string; startsAt: string }[] }>("/events?pageSize=100");
    const ids = body.items.map(e => e.id);
    expect(ids).not.toContain(past.id);
    expect(ids.indexOf(sooner.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));
    const dates = body.items.map(e => new Date(e.startsAt).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(dates.every(t => t > Date.now())).toBe(true);
  });

  it("« Participe déjà » après paiement confirmé, « Liste d’attente » si inscrit sur liste d'attente, rien sinon", async () => {
    const paidEvent = await publishedEvent();
    const fullEvent = await publishedEvent({ capacity: 5 });
    const otherEvent = await publishedEvent();
    const buyer = await participant("BadgeBuyer");
    const apply = await applyToEvent(paidEvent.id, buyer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(apply.body.application.id, buyer.token);
    const waitApp = await prisma.application.create({ data: { eventId: fullEvent.id, userId: buyer.userId, status: "PAYMENT_PENDING" } });
    await prisma.waitlistEntry.create({ data: { eventId: fullEvent.id, userId: buyer.userId, applicationId: waitApp.id, position: 1 } });

    const { body } = await api<{ items: { id: string; viewerStatus: string | null }[] }>("/events?pageSize=100", {}, buyer.token);
    const status = (id: string) => body.items.find(e => e.id === id)?.viewerStatus;
    expect(status(paidEvent.id)).toBe("CONFIRMED");
    expect(status(fullEvent.id)).toBe("WAITLIST");
    expect(status(otherEvent.id)).toBeNull();
    const anonymous = await api<{ items: { id: string; viewerStatus: string | null }[] }>("/events?pageSize=100");
    expect(anonymous.body.items.find(e => e.id === paidEvent.id)?.viewerStatus).toBeNull();
    expect((await api<{ viewerStatus: string }>(`/events/${paidEvent.slug}`, {}, buyer.token)).body.viewerStatus).toBe("CONFIRMED");
  });
});

describe("notifications participant cliquables vers l'objet concerné (§4.3)", () => {
  it("le paiement mène au billet précis, l'inscription à la réservation précise ; lecture groupée possible", async () => {
    const event = await publishedEvent();
    const buyer = await participant("NotifBuyer");
    const apply = await applyToEvent(event.id, buyer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const { reservationId } = await payAndConfirm(apply.body.application.id, buyer.token);
    const { body: notifications } = await api<{ title: string; linkPath: string | null; readAt: string | null }[]>("/notifications?limit=10", {}, buyer.token);
    expect(notifications.find(n => n.title === "Paiement confirmé")?.linkPath).toBe(`/dashboard?tab=tickets&reservation=${reservationId}`);
    expect(notifications.find(n => n.title === "Inscription enregistrée")?.linkPath).toBe(`/dashboard?tab=reservations&application=${apply.body.application.id}`);
    expect(notifications.every(n => n.linkPath && n.linkPath.startsWith("/"))).toBe(true);
    expect((await api<{ count: number }>("/notifications/unread-count", {}, buyer.token)).body.count).toBeGreaterThan(0);
    await api("/notifications/read-all", { method: "POST" }, buyer.token);
    expect((await api<{ count: number }>("/notifications/unread-count", {}, buyer.token)).body.count).toBe(0);
  });
});

describe("remboursements et finances : jamais par un restaurateur (§6)", () => {
  it("un restaurateur ne peut ni rembourser, ni demander un remboursement, ni lire les finances internes", async () => {
    const org = await organizer("NoRefundOrg");
    const event = await publishedEvent({ controllerRestaurantId: org.restaurantId, venueRestaurantId: org.restaurantId });
    const buyer = await participant("NoRefundBuyer");
    const apply = await applyToEvent(event.id, buyer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const { reservationId } = await payAndConfirm(apply.body.application.id, buyer.token);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reservationId } });

    expect((await api(`/admin/payments/${payment.id}/refund`, { method: "POST", body: JSON.stringify({ reason: "Tentative restaurateur" }) }, org.token)).status).toBe(403);
    expect((await api(`/admin/payments/${payment.id}/refund-request`, { method: "POST", body: JSON.stringify({ reason: "Route supprimée" }) }, org.token)).status).toBe(404);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SUCCEEDED");
    for (const path of ["/admin/finance/ledger", "/admin/finance/summary"]) {
      expect((await api(path, {}, org.token)).status).toBe(403);
      expect((await api(path, {}, buyer.token)).status).toBe(403);
      expect((await api(path, {}, await adminToken())).status).toBe(200);
    }
    // Liste des participants : statut du paiement seulement, jamais les références Stripe.
    const { body: reservations } = await api<{ payment: Record<string, unknown> }[]>(`/admin/events/${event.id}/reservations`, {}, org.token);
    expect(Object.keys(reservations[0].payment).sort()).toEqual(["id", "status"]);
    // Fiche établissement : ni notes internes ni taux de commission.
    const { body: own } = await api<Record<string, unknown>>("/restaurants/me", {}, org.token);
    expect(own).not.toHaveProperty("adminNotes");
    expect(own).not.toHaveProperty("commissionRate");
    const { body: patched } = await api<Record<string, unknown>>("/restaurants/me", { method: "PATCH", body: JSON.stringify({ description: "Nouvelle description" }) }, org.token);
    expect(patched).not.toHaveProperty("adminNotes");
    expect(patched).not.toHaveProperty("commissionRate");
    // Le billet du participant ne porte que le nom du restaurant, jamais sa fiche interne.
    const { body: tickets } = await api<{ reservation: { event: { controllerRestaurant: Record<string, unknown> } } }[]>("/me/tickets", {}, buyer.token);
    expect(Object.keys(tickets[0].reservation.event.controllerRestaurant).sort()).toEqual(["id", "name"]);
    // Le super-admin, lui, rembourse réellement (Stripe test).
    const refund = await api<{ refunded: boolean }>(`/admin/payments/${payment.id}/refund`, { method: "POST", body: JSON.stringify({}) }, await adminToken());
    expect(refund.body.refunded).toBe(true);
  });
});

describe("brouillon d'événement invisible hors administration et restaurateur propriétaire", () => {
  it("renvoie 404 à un visiteur ou un participant, la fiche à l'admin", async () => {
    const draft = await publishedEvent({ status: "DRAFT" });
    const buyer = await participant("DraftViewer");
    expect((await api(`/events/${draft.slug}`)).status).toBe(404);
    expect((await api(`/events/${draft.slug}`, {}, buyer.token)).status).toBe(404);
    expect((await api(`/events/${draft.slug}`, {}, await adminToken())).status).toBe(200);
  });
});

describe("protections des routes super-admin", () => {
  it("refuse participants et restaurateurs (403) et visiteurs anonymes (401)", async () => {
    const buyer = await participant("AdminGuardBuyer");
    const org = await organizer("AdminGuardOrg");
    const routes: [string, string][] = [["GET", "/admin/articles"], ["GET", "/admin/settings"], ["GET", "/admin/stats"], ["GET", "/admin/restaurants"], ["GET", "/admin/finance/summary"], ["DELETE", "/admin/articles/inexistant"], ["POST", "/admin/articles/generate"], ["PATCH", "/admin/settings/ANALYTICS_ENABLED"]];
    for (const [method, path] of routes) {
      const body = method === "GET" || method === "DELETE" ? undefined : JSON.stringify({});
      expect((await api(path, { method, body }, buyer.token)).status, `${method} ${path} participant`).toBe(403);
      expect((await api(path, { method, body }, org.token)).status, `${method} ${path} restaurateur`).toBe(403);
      expect((await api(path, { method, body })).status, `${method} ${path} anonyme`).toBe(401);
    }
  });
});

describe("événement de démonstration : parcours possible, aucun paiement (§8)", () => {
  it("accepte l'inscription mais refuse côté serveur tout PaymentIntent, verrou ou billet", async () => {
    const demo = await publishedEvent({ isDemo: true });
    const freeDemo = await publishedEvent({ isDemo: true, priceCents: 0 });
    const buyer = await participant("DemoBuyer");
    for (const event of [demo, freeDemo]) {
      const apply = await applyToEvent(event.id, buyer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
      expect(apply.status).toBe(201);
      const pay = await api<{ error: string; notBookable: boolean }>(`/applications/${apply.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, buyer.token);
      expect(pay.status).toBe(409);
      expect(pay.body.notBookable).toBe(true);
      expect(pay.body.error).toMatch(/pas réservable/);
      expect(await prisma.reservation.count({ where: { applicationId: apply.body.application.id } })).toBe(0);
    }
    const sitemap = await (await fetch(`${API_URL}/sitemap.xml`)).text();
    expect(sitemap).not.toContain(demo.slug);
    expect((await api<{ bookable: boolean }>(`/events/${demo.slug}`)).body.bookable).toBe(false);
  });
});

describe("abonnement restaurateur : montée immédiate avec prorata, descente à l'échéance (§1.4, Stripe test)", () => {
  it("synchronise la formule avec Stripe à chaque étape", async () => {
    const org = await organizer("PlanChangeOrg");
    const [standard, premium] = await Promise.all(["Standard", "Premium"].map(name => prisma.plan.findFirstOrThrow({ where: { name, active: true } })));
    expect(standard.stripePriceMonthlyId && premium.stripePriceMonthlyId, "lancer npm run stripe:setup-test-plans").toBeTruthy();
    // Souscription réelle chez Stripe (carte de test pm_card_visa), puis webhook Checkout signé.
    const customer = await stripe.customers.create({ name: "Test changement de formule", payment_method: "pm_card_visa", invoice_settings: { default_payment_method: "pm_card_visa" }, metadata: { restaurantId: org.restaurantId } });
    const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: standard.stripePriceMonthlyId! }], metadata: { restaurantId: org.restaurantId } });
    const payload = JSON.stringify({ id: `evt_test_${Date.now()}`, object: "event", type: "checkout.session.completed", data: { object: { id: "cs_test_x", object: "checkout.session", subscription: subscription.id, customer: customer.id, metadata: { restaurantId: org.restaurantId, planId: standard.id, billingPeriod: "MONTHLY" } } } });
    const res = await fetch(`${API_URL}/webhooks/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signStripeWebhook(payload).header }, body: payload });
    expect(res.status).toBe(200);
    let local = await prisma.restaurantSubscription.findUniqueOrThrow({ where: { restaurantId: org.restaurantId } });
    expect(local.planId).toBe(standard.id);
    expect(local.status).toBe("ACTIVE");

    // Standard → Premium : immédiat, prorata facturé.
    const up = await api<{ direction: string; subscription: { planId: string } }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: premium.id }) }, org.token);
    expect(up.status).toBe(200);
    expect(up.body.direction).toBe("UPGRADE");
    expect(up.body.subscription.planId).toBe(premium.id);
    expect((await stripe.subscriptions.retrieve(subscription.id)).items.data[0].price.id).toBe(premium.stripePriceMonthlyId);
    const invoices = await stripe.invoices.list({ subscription: subscription.id, limit: 5 });
    expect(invoices.data.some(i => i.billing_reason === "subscription_update")).toBe(true);

    // Premium → Standard : Premium conservé jusqu'à l'échéance, changement programmé chez Stripe.
    const down = await api<{ direction: string; subscription: { planId: string; pendingPlanId: string; pendingChangeAt: string } }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: standard.id }) }, org.token);
    expect(down.status).toBe(200);
    expect(down.body.direction).toBe("DOWNGRADE");
    expect(down.body.subscription.planId).toBe(premium.id);
    expect(down.body.subscription.pendingPlanId).toBe(standard.id);
    const stripeSub = await stripe.subscriptions.retrieve(subscription.id);
    expect(new Date(down.body.subscription.pendingChangeAt).getTime()).toBe(stripeSub.items.data[0].current_period_end * 1000);
    expect(stripeSub.items.data[0].price.id).toBe(premium.stripePriceMonthlyId);
    const schedule = await stripe.subscriptionSchedules.retrieve(stripeSub.schedule as string);
    expect(schedule.phases.at(-1)?.items[0].price).toBe(standard.stripePriceMonthlyId);

    // « Conserver Premium » : calendrier libéré, plus rien en attente.
    expect((await api("/restaurants/me/subscription/cancel-plan-change", { method: "POST" }, org.token)).status).toBe(200);
    local = await prisma.restaurantSubscription.findUniqueOrThrow({ where: { restaurantId: org.restaurantId } });
    expect(local.pendingPlanId).toBeNull();
    expect((await stripe.subscriptionSchedules.retrieve(schedule.id)).status).toBe("released");
    // Un second Checkout est refusé tant que l'abonnement est actif.
    expect((await api("/restaurants/me/subscription/checkout", { method: "POST", body: JSON.stringify({ planId: standard.id, billingPeriod: "MONTHLY" }) }, org.token)).status).toBe(409);

    // Décision du 2026-09-25 — mensuel → annuel : immédiat (même formule, périodicité annuelle facturée).
    expect(premium.stripePriceAnnualId, "lancer npm run stripe:setup-test-plans").toBeTruthy();
    const yearly = await api<{ direction: string; subscription: { billingPeriod: string } }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: premium.id, billingPeriod: "ANNUAL" }) }, org.token);
    expect(yearly.status).toBe(200);
    expect(yearly.body.direction).toBe("UPGRADE");
    expect(yearly.body.subscription.billingPeriod).toBe("ANNUAL");
    expect((await stripe.subscriptions.retrieve(subscription.id)).items.data[0].price.id).toBe(premium.stripePriceAnnualId);
    // Annuel → mensuel : l'année payée est conservée, le mensuel est programmé à l'échéance.
    const monthly = await api<{ direction: string; subscription: { billingPeriod: string; pendingPlanId: string; pendingBillingPeriod: string } }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: premium.id, billingPeriod: "MONTHLY" }) }, org.token);
    expect(monthly.status).toBe(200);
    expect(monthly.body.direction).toBe("DOWNGRADE");
    expect(monthly.body.subscription.billingPeriod).toBe("ANNUAL");
    expect(monthly.body.subscription.pendingBillingPeriod).toBe("MONTHLY");
    const scheduled = await stripe.subscriptions.retrieve(subscription.id);
    expect((await stripe.subscriptionSchedules.retrieve(scheduled.schedule as string)).phases.at(-1)?.items[0].price).toBe(premium.stripePriceMonthlyId);

    // Même lecture pour le restaurateur et pour l'administration, qui ne peut rien modifier.
    const own = await api<{ subscription: unknown; invoices: { id: string }[] }>("/restaurants/me/subscription", {}, org.token);
    const seenByAdmin = await api<{ subscription: unknown; invoices: { id: string }[] }>(`/admin/restaurants/${org.restaurantId}/subscription`, {}, await adminToken());
    expect(own.status).toBe(200);
    expect(seenByAdmin.status).toBe(200);
    expect(seenByAdmin.body.subscription).toEqual(own.body.subscription);
    expect(own.body.invoices.length).toBeGreaterThan(0);
    expect(JSON.stringify(own.body)).not.toMatch(/stripeSubscriptionId|stripeCustomerId|cus_|sub_|"in_/);
    await stripe.subscriptions.cancel(subscription.id);
  }, 90_000);
});

describe("publication quotidienne du blog sans doublon (§3.1)", () => {
  const silentLog = { info: () => {}, warn: () => {} };
  const notify = async () => {};
  const article = { imagePrompt: "A warm Parisian café terrace at dusk", instagramCaption: "Oser aller vers les autres.\n\nArticle complet : lien en bio\n#rencontres", kind: "editorial" as const, title: "Oser aller vers les autres en soirée", excerpt: "Quelques repères simples.", category: "Solitude et vie sociale", keywords: ["soirée"], metaTitle: "Oser aller vers les autres", metaDescription: "Des repères simples.", coverPhoto: "paris-terrace", sources: [], content: Array.from({ length: 12 }, (_, i) => `## Étape ${i + 1}\n\n${"Un conseil concret et bienveillant pour faire le premier pas lors d'une soirée. ".repeat(8)}`).join("\n\n") };

  it("publie un seul article par jour, même avec des passages simultanés ou répétés", async () => {
    const now = new Date("2031-03-14T10:00:00Z");
    let calls = 0;
    const aiProvider = { mode: "external", generateDraft: async () => ({ title: "", excerpt: "", content: "", keywords: [] }), generateSocialCopy: async () => [], generateArticle: async () => { calls++; await new Promise(r => setTimeout(r, 200)); return { article, searchedUrls: [] }; } } as AIProvider;
    const results = await Promise.all([publishDailyArticle({ prisma, aiProvider, notify, log: silentLog }, now), publishDailyArticle({ prisma, aiProvider, notify, log: silentLog }, now)]);
    expect(results.sort()).toEqual(["BUSY", "PUBLISHED_AI"]);
    expect(await publishDailyArticle({ prisma, aiProvider, notify, log: silentLog }, new Date("2031-03-14T21:00:00Z"))).toBe("ALREADY_PUBLISHED");
    const published = await prisma.article.findMany({ where: { autoPublishDay: "2031-03-14" } });
    createdArticleIds.push(...published.map(a => a.id));
    expect(published).toHaveLength(1);
    expect(published[0].status).toBe("PUBLISHED");
    expect(calls).toBe(1);
    // La contrainte d'unicité protège aussi contre une insertion concurrente directe.
    await expect(prisma.article.create({ data: { title: "Doublon", slug: `doublon-${Date.now()}`, content: "x", category: "Amitié", keywords: [], autoPublishDay: "2031-03-14" } })).rejects.toThrow();
    // Le super-admin peut supprimer l'article publié.
    expect((await api(`/admin/articles/${published[0].id}`, { method: "DELETE" }, await adminToken())).status).toBe(204);
    expect((await api(`/articles/${published[0].slug}`)).status).toBe(404);
  });

  it("illustre l'article avec l'image IA contrôlée et le partage une fois sur Instagram, sans bloquer le blog si Instagram échoue", async () => {
    const now = new Date("2031-03-16T10:00:00Z");
    const aiProvider = { mode: "external", generateDraft: async () => ({ title: "", excerpt: "", content: "", keywords: [] }), generateSocialCopy: async () => [], generateArticle: async () => ({ article, searchedUrls: [] }) } as AIProvider;
    const shared: string[] = [];
    const outcome = await publishDailyArticle({
      prisma, aiProvider, notify, log: silentLog,
      illustrate: async () => ({ imageUrl: "/static/uploads/articles/test-illustration.webp", instagramImageUrl: "/static/uploads/articles/test-illustration-instagram.jpg", altText: "Une terrasse" }),
      shareOnInstagram: async id => { shared.push(id); throw new Error("Instagram indisponible (test)"); }
    }, now);
    expect(outcome).toBe("PUBLISHED_AI");
    const published = await prisma.article.findUniqueOrThrow({ where: { autoPublishDay: "2031-03-16" } });
    createdArticleIds.push(published.id);
    expect(published.status).toBe("PUBLISHED");
    expect(published.imageUrl).toBe("/static/uploads/articles/test-illustration.webp");
    expect(published.imageAiGenerated).toBe(true);
    expect(published.instagramCaption).toContain("lien en bio");
    expect(shared).toEqual([published.id]);
    // La route publique ne révèle jamais le suivi Instagram ni la consigne IA.
    const { body } = await api<Record<string, unknown>>(`/articles/${published.slug}`);
    expect(body.imageAiGenerated).toBe(true);
    for (const key of ["instagramCaption", "instagramError", "instagramMediaId", "aiPrompt"]) expect(body).not.toHaveProperty(key);
  });

  it("si l'IA échoue 3 fois dans la journée, publie un article de la réserve plutôt que rien", async () => {
    const now = new Date("2031-03-15T10:00:00Z");
    const failing = { mode: "external", generateDraft: async () => ({ title: "", excerpt: "", content: "", keywords: [] }), generateSocialCopy: async () => [], generateArticle: async () => { throw new Error("Anthropic indisponible (test)"); } } as AIProvider;
    const queued = await prisma.articleQueueEntry.create({ data: { position: -1, title: "Article de réserve (test)", slug: `reserve-test-${Date.now()}`, excerpt: "Réserve.", content: "Contenu de réserve.", category: "Amitié", keywords: [], metaTitle: "Réserve", metaDescription: "Réserve" } });
    try {
      expect(await publishDailyArticle({ prisma, aiProvider: failing, notify, log: silentLog }, now)).toBe("NOTHING_TO_PUBLISH");
      expect(await publishDailyArticle({ prisma, aiProvider: failing, notify, log: silentLog }, now)).toBe("NOTHING_TO_PUBLISH");
      expect(await publishDailyArticle({ prisma, aiProvider: failing, notify, log: silentLog }, now)).toBe("PUBLISHED_QUEUE");
      const published = await prisma.article.findUniqueOrThrow({ where: { autoPublishDay: "2031-03-15" } });
      createdArticleIds.push(published.id);
      expect(published.title).toBe("Article de réserve (test)");
    } finally {
      await prisma.articleQueueEntry.deleteMany({ where: { id: queued.id } });
      await prisma.auditLog.deleteMany({ where: { action: "DAILY_ARTICLE_AI_FAILED", entityId: "2031-03-15" } });
    }
  });
});

describe("photo d'établissement obligatoire (audit 2026-09-25)", () => {
  it("approbation refusée sans photo, fichier effacé au retrait, galerie fermée après refus", async () => {
    const applicant = await participant("PhotoResto");
    const { body: restaurant } = await api<{ id: string }>("/restaurants/apply", { method: "POST", body: JSON.stringify({ name: "PhotoResto Resto", managerName: "PhotoResto", siret: "12345678900019" }) }, applicant.token);
    const admin = await adminToken();
    const refused = await api<{ error: string }>(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
    expect(refused.status).toBe(409);

    const upload = await addRestaurantPhoto(applicant.token);
    expect(upload.status).toBe(201);
    const url = (upload.body as { id: string; url: string }).url;
    expect((await fetch(`${API_URL}${url}`)).status).toBe(200);
    const removed = await api(`/restaurants/me/photos/${(upload.body as { id: string }).id}`, { method: "DELETE" }, applicant.token);
    expect(removed.status).toBe(204);
    expect((await fetch(`${API_URL}${url}`)).status).toBe(404);

    await addRestaurantPhoto(applicant.token);
    const rejected = await api(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: false, reason: "Test" }) }, admin);
    expect(rejected.status).toBe(200);
    expect((await addRestaurantPhoto(applicant.token)).status).toBe(403);
  });
});

describe("soirées de démonstration retirées dès la première vraie soirée publiée (décision du 2026-09-25)", () => {
  it("annule la démonstration et les inscriptions ouvertes, prévient les inscrits, sans toucher la vraie soirée", async () => {
    const demoOwner = await organizer("DemoResto");
    await prisma.restaurant.update({ where: { id: demoOwner.restaurantId }, data: { isDemo: true } });
    const demo = await publishedEvent({ isDemo: true, controllerRestaurantId: demoOwner.restaurantId, venueRestaurantId: demoOwner.restaurantId, title: "Démo à retirer" });
    const applicant = await participant("DemoInscrit");
    const application = await prisma.application.create({ data: { eventId: demo.id, userId: applicant.userId, status: "PAYMENT_PENDING" } });

    const admin = await adminToken();
    const real = await api<{ id: string; status: string }>("/admin/events", { method: "POST", body: JSON.stringify({
      title: "Vraie soirée", slug: `vraie-soiree-${Date.now()}`, category: "Networking", description: "Une vraie soirée commercialisable publiée par l'administration.",
      startsAt: day(25).toISOString(), endsAt: day(25, 22).toISOString(), district: "Paris 11e", address: "1 rue de test", zone: "Paris intra-muros",
      capacity: 20, priceCents: 2500, publish: true
    }) }, admin);
    expect(real.status).toBe(200);
    createdEventIds.push(real.body.id);
    expect(real.body.status).toBe("PUBLISHED");

    expect((await prisma.event.findUniqueOrThrow({ where: { id: demo.id } })).status).toBe("CANCELLED");
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("CANCELLED");
    expect(await prisma.notification.count({ where: { userId: applicant.userId, title: "Soirée retirée" } })).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: real.body.id } })).status).toBe("PUBLISHED");
    const catalogue = await api<{ items: { id: string }[] }>("/events?pageSize=100");
    expect(catalogue.body.items.some(e => e.id === demo.id)).toBe(false);
  });
});

describe("espaces restaurateur et administration strictement séparés (décision du 2026-09-25)", () => {
  it("l'administration consulte l'abonnement sans pouvoir le modifier ; le restaurateur n'accède à aucune fonction globale", async () => {
    const org = await organizer("SeparationOrg");
    const other = await organizer("SeparationAutre");
    const admin = await adminToken();
    // Plus aucune route de modification manuelle d'un abonnement par l'administration.
    const standard = await prisma.plan.findFirstOrThrow({ where: { name: "Standard", active: true } });
    expect((await api(`/admin/restaurants/${org.restaurantId}/subscription`, { method: "POST", body: JSON.stringify({ planId: standard.id, status: "ACTIVE" }) }, admin)).status).toBe(404);
    expect(await prisma.restaurantSubscription.count({ where: { restaurantId: org.restaurantId } })).toBe(0);
    // Le restaurateur ne lit ni l'abonnement d'un autre établissement ni les écrans globaux.
    for (const path of [`/admin/restaurants/${other.restaurantId}/subscription`, "/admin/restaurants", "/admin/plans", "/admin/settings", "/admin/global-interviews", "/admin/outbox"]) {
      expect((await api(path, {}, org.token)).status, path).toBe(403);
    }
    expect((await api("/restaurants/me/subscription", {}, org.token)).status).toBe(200);
  });
});

describe("réglages de l'administration appliqués sans redémarrage (décision du 2026-09-25)", () => {
  it("une durée d'essai modifiée est lue aussitôt par l'espace restaurateur, puis restaurée", async () => {
    const org = await organizer("ReglageOrg");
    const admin = await adminToken();
    const before = (await api<{ trialDays: number }>("/restaurants/me", {}, org.token)).body.trialDays;
    try {
      expect((await api("/admin/settings/RESTAURANT_TRIAL_DAYS", { method: "PATCH", body: JSON.stringify({ value: 12 }) }, admin)).status).toBe(200);
      expect((await api<{ trialDays: number }>("/restaurants/me", {}, org.token)).body.trialDays).toBe(12);
      // Valeur hors de ce que Stripe accepte : refusée, l'ancienne reste en vigueur.
      expect((await api("/admin/settings/RESTAURANT_TRIAL_DAYS", { method: "PATCH", body: JSON.stringify({ value: 999 }) }, admin)).status).toBe(400);
      expect((await api<{ trialDays: number }>("/restaurants/me", {}, org.token)).body.trialDays).toBe(12);
    } finally {
      await api("/admin/settings/RESTAURANT_TRIAL_DAYS", { method: "PATCH", body: JSON.stringify({ value: before }) }, admin);
    }
  });
});
