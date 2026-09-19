// Tests d'intégration contre le vrai serveur de développement (docker compose up requis). Ils
// couvrent les scénarios à plus fort risque déjà vérifiés manuellement pendant le développement
// (concurrence, sécurité, paiement) pour les protéger d'une régression future. Ce n'est pas une
// couverture exhaustive de tout le cahier des charges : voir le rapport de la Phase 8 pour ce qui
// reste testé manuellement uniquement.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, adminToken, ensureServerRunning, makeValidatedParticipant, deleteTestUsers, testPhone, prisma, signStripeWebhook, applyToEvent, payAndConfirm, SCREENING_ANSWERS_FIXTURE, NETWORKING_ANSWERS_FIXTURE } from "./helpers.js";

const createdUserIds: string[] = [];
async function tracked(displayName?: string, quotaCategory?: "HOMME" | "FEMME") {
  const participant = await makeValidatedParticipant(displayName, quotaCategory);
  createdUserIds.push(participant.userId);
  return participant;
}
// Suivis séparément des utilisateurs (nettoyage en afterAll même si un test échoue en cours de
// route, plutôt qu'un delete en fin de bloc qui ne s'exécuterait jamais dans ce cas).
const createdEventIds: string[] = [];

beforeAll(ensureServerRunning);
afterAll(async () => {
  await deleteTestUsers(createdUserIds);
  for (const id of createdEventIds) await prisma.event.delete({ where: { id } }).catch(() => {});
});

describe("rôle et suspension vérifiés en direct (pas seulement dans le jeton)", () => {
  it("reflète une promotion et une suspension sans reconnexion", async () => {
    const { token, userId } = await tracked("RoleFraisTest");
    expect((await api("/me", {}, token)).body.role).toBe("PARTICIPANT");

    await prisma.user.update({ where: { id: userId }, data: { role: "ORGANIZER" } });
    expect((await api("/me", {}, token)).body.role).toBe("ORGANIZER");

    await prisma.user.update({ where: { id: userId }, data: { suspendedAt: new Date() } });
    const suspended = await api("/me", {}, token);
    expect(suspended.status).toBe(403);
  });
});

describe("isolation restaurateur", () => {
  it("un restaurateur ne peut ni voir ni modifier les événements d’un concurrent", async () => {
    const admin = await adminToken();
    // Maison Amana (seed) contrôle l'unique événement Speed dating : un second restaurateur, créé et
    // approuvé ici, ne doit jamais pouvoir y toucher.
    const { body: events } = await api<any[]>("/admin/events", {}, admin);
    const foreignEvent = events.find(e => e.category === "Speed dating");
    expect(foreignEvent).toBeTruthy();

    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "ConcurrentResto" }) });
    let orgToken = verify.token;
    const { body: me } = await api<{ id: string }>("/me", {}, orgToken);
    createdUserIds.push(me.id);
    const { body: restaurant } = await api<{ id: string }>("/restaurants/apply", { method: "POST", body: JSON.stringify({ name: "Concurrent Test", managerName: "Test Manager", siret: "12345678900019" }) }, orgToken);
    await api(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
    // Le rôle vient de changer côté serveur : un jeton fraîchement émis le reflète (voir le test de
    // fraîcheur du rôle ci-dessus).
    const { body: reverify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) });
    orgToken = reverify.token;

    // 404 (et non 403) : on ne confirme jamais à un restaurateur qu'un événement existe chez un
    // concurrent, seulement qu'il n'est pas accessible depuis son propre compte.
    const quotas = await api(`/admin/events/${foreignEvent.id}/quotas`, { method: "POST", body: JSON.stringify({ homme: 1, femme: 1 }) }, orgToken);
    expect(quotas.status).toBe(404);

    const ledger = await api<any[]>("/admin/finance/ledger", {}, orgToken);
    expect(ledger.status).toBe(200);
    expect(ledger.body).toHaveLength(0);
  });
});

describe("entretien global : porte d’entrée obligatoire avant toute inscription à un événement à sélection, jamais pour un accès direct", () => {
  it("refuse l’inscription à un speed dating (SCREENING) tant que le profil n’est pas validé, puis l’autorise après validation", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "GateTest" }) });
    const token = verify.token;
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ displayName: "GateTest", city: "Paris", interests: [], quotaCategory: "HOMME" }) }, token);
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);

    const { body: events } = await api<any[]>("/events");
    const screeningEvent = events.find(e => e.flow === "SCREENING");
    expect(screeningEvent).toBeTruthy();
    const blocked = await applyToEvent(screeningEvent.id, token, { screeningAnswers: SCREENING_ANSWERS_FIXTURE });
    expect(blocked.status).toBe(409);

    const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, token);
    const admin = await adminToken();
    await api(`/admin/global-interviews/${interview.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);

    const allowed = await applyToEvent(screeningEvent.id, token, { screeningAnswers: SCREENING_ANSWERS_FIXTURE });
    expect(allowed.status).toBe(201);
    expect(allowed.body.application.status).toBe("PAYMENT_PENDING");
  });

  it("autorise l’inscription directe à un networking (DIRECT) sans aucune validation de profil", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "DirectTest" }) });
    const token = verify.token;
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ displayName: "DirectTest", city: "Paris", interests: [] }) }, token);
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);

    const { body: events } = await api<any[]>("/events");
    const directEvent = events.find(e => e.flow === "DIRECT");
    expect(directEvent).toBeTruthy();
    // Sans questionnaire : refusé (400), jamais pour défaut de validation de profil (409).
    const withoutQuestionnaire = await api(`/events/${directEvent.id}/apply`, { method: "POST", body: JSON.stringify({}) }, token);
    expect(withoutQuestionnaire.status).toBe(400);

    const allowed = await applyToEvent(directEvent.id, token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    expect(allowed.status).toBe(201);
    expect(allowed.body.application.status).toBe("PAYMENT_PENDING");
  });

  it("impose un délai de trois mois avant de redemander un entretien après un refus", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "RefusTest" }) });
    const token = verify.token;
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ displayName: "RefusTest", city: "Paris", interests: [] }) }, token);
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);

    const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, token);
    const admin = await adminToken();
    await api(`/admin/global-interviews/${interview.id}/decision`, { method: "POST", body: JSON.stringify({ accept: false, notes: "Test" }) }, admin);

    const retry = await api("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Nouvelle tentative avec une motivation suffisamment longue cette fois." }) }, token);
    expect(retry.status).toBe(409);
    expect(retry.body.retryAvailableAt).toBeTruthy();
    const retryDate = new Date(retry.body.retryAvailableAt);
    const expectedMinimum = new Date(Date.now() + 89 * 24 * 60 * 60_000);
    expect(retryDate.getTime()).toBeGreaterThan(expectedMinimum.getTime());
  });
});

describe("atomicité des quotas sous concurrence réelle", () => {
  it("n’accepte jamais deux paiements simultanés pour la dernière place d’une catégorie", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: "diner-connexions-septembre" } });
    // Restauré dans un finally : reste fiable même si une assertion échoue en cours de test.
    try {
      await prisma.eventQuota.update({ where: { eventId_category: { eventId: event.id, category: "HOMME" } }, data: { capacity: 1, heldCount: 0 } });

      const a = await tracked("ConcurrentA", "HOMME");
      const b = await tracked("ConcurrentB", "HOMME");
      // La candidature elle-même ne garantit jamais de place (§5) : les deux réussissent toujours,
      // la course ne se joue qu'au moment où chacun tente réellement de payer.
      const [appA, appB] = await Promise.all([
        applyToEvent(event.id, a.token, { screeningAnswers: SCREENING_ANSWERS_FIXTURE }),
        applyToEvent(event.id, b.token, { screeningAnswers: SCREENING_ANSWERS_FIXTURE })
      ]);
      expect([appA.status, appB.status]).toEqual([201, 201]);

      const [payA, payB] = await Promise.all([
        api(`/applications/${appA.body.application.id}/payment-intent`, { method: "POST" }, a.token),
        api(`/applications/${appB.body.application.id}/payment-intent`, { method: "POST" }, b.token)
      ]);
      const statuses = [payA.status, payB.status].sort();
      expect(statuses).toEqual([200, 409]);
      const waitlisted = [payA.body, payB.body].filter((r: any) => r.waitlisted);
      expect(waitlisted).toHaveLength(1);

      const quota = await prisma.eventQuota.findUniqueOrThrow({ where: { eventId_category: { eventId: event.id, category: "HOMME" } } });
      expect(quota.heldCount).toBe(1);
    } finally {
      // Restaure l'état de démonstration d'origine.
      await prisma.eventQuota.update({ where: { eventId_category: { eventId: event.id, category: "HOMME" } }, data: { capacity: 14, heldCount: 0 } });
    }
  });
});

describe("tarification différenciée résolue correctement au paiement", () => {
  it("facture le tarif de la catégorie du participant, pas le tarif de base", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-tarifs-${Date.now()}`, title: "Test tarifs", category: "Networking",
      description: "Événement de test pour vérifier la résolution des tarifs différenciés.",
      startsAt: new Date(Date.now() + 30 * 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000 + 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2500,
      status: "PUBLISHED",
      priceTiers: { create: [{ category: "HOMME", amountCents: 3000 }, { category: "FEMME", amountCents: 2000 }] }
    } });
    createdEventIds.push(event.id);

    const femme = await tracked("PrixFemme", "FEMME");
    const applyRes = await applyToEvent(event.id, femme.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const intent = await api<{ amountCents: number }>(`/applications/${applyRes.body.application.id}/payment-intent`, { method: "POST" }, femme.token);
    expect(intent.body.amountCents).toBe(2000);
  });
});

describe("aucune survente si un paiement Stripe arrive après libération de la place", () => {
  it("n’émet pas de billet et journalise le cas plutôt que de confirmer", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: "soiree-nour-x-amana" } });
    const participant = await tracked("RaceCondition");

    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const application = applyRes.body.application;

    const intent = await api<{ clientSecret: string }>(`/applications/${application.id}/payment-intent`, { method: "POST" }, participant.token);
    const paymentIntentId = intent.body.clientSecret.split("_secret_")[0];
    const reservationId = (await prisma.reservation.findUniqueOrThrow({ where: { applicationId: application.id } })).id;

    // La place est libérée (auto-annulation) avant que le paiement ne soit confirmé : reproduit la
    // course entre expiration et webhook sans attendre le balayage de 60 secondes.
    await api(`/me/applications/${application.id}/cancel`, { method: "POST" }, participant.token);

    const payload = JSON.stringify({ id: `evt_test_${Date.now()}`, object: "event", type: "payment_intent.succeeded", data: { object: { id: paymentIntentId, object: "payment_intent", metadata: { reservationId } } } });
    const { header } = signStripeWebhook(payload);
    const webhookRes = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": header },
      body: payload
    });
    expect(webhookRes.status).toBe(200);

    const ticket = await prisma.ticket.findFirst({ where: { reservation: { id: reservationId } } });
    expect(ticket).toBeNull();
    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(reservation.confirmedAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entity: "Reservation", entityId: reservationId, action: "PAYMENT_SUCCEEDED_AFTER_RELEASE" } });
    expect(audit).toBeTruthy();
  }, 20_000);
});

async function newOrganizer(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  let token = verify.token;
  const { body: me } = await api<{ id: string }>("/me", {}, token);
  const { body: restaurant } = await api<{ id: string }>("/restaurants/apply", { method: "POST", body: JSON.stringify({ name: `${displayName} Resto`, managerName: displayName, siret: "12345678900019" }) }, token);
  const admin = await adminToken();
  await api(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
  // Le rôle vient de changer côté serveur : un jeton fraîchement émis le reflète.
  const { body: reverify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) });
  token = reverify.token;
  return { token, userId: me.id, restaurantId: restaurant.id };
}

describe("restaurateur limité à son quota mensuel d'événements publiables", () => {
  it("bloque la publication au-delà du quota du plan, sans bloquer la création de brouillons", async () => {
    const organizer = await newOrganizer("QuotaTest");
    createdUserIds.push(organizer.userId);
    const admin = await adminToken();

    const publishOne = async (n: number) => {
      const { body: event } = await api<{ id: string }>("/admin/events", { method: "POST", body: JSON.stringify({
        title: `Quota Test ${n}`, slug: `quota-test-${n}-${Date.now()}`, category: "Networking", description: "Événement de test pour le quota mensuel restaurateur.",
        startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000).toISOString(),
        district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000
      }) }, organizer.token);
      createdEventIds.push(event.id);
      await api(`/admin/events/${event.id}/submit-for-review`, { method: "POST" }, organizer.token);
      return api(`/admin/events/${event.id}/review-decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
    };

    const first = await publishOne(1);
    const second = await publishOne(2);
    const third = await publishOne(3);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(409);
    expect((third.body as any).error).toMatch(/quota/i);

    const usage = await prisma.restaurantMonthlyUsage.findFirstOrThrow({ where: { restaurantId: organizer.restaurantId } });
    expect(usage.eventsPublished).toBe(2);
  });
});

describe("minimum de participants non atteint : maintien ou annulation", () => {
  it("rembourse intégralement les billets déjà vendus si le restaurateur choisit d'annuler", async () => {
    const organizer = await newOrganizer("MinPartTest");
    createdUserIds.push(organizer.userId);
    const admin = await adminToken();
    const { body: event } = await api<{ id: string }>("/admin/events", { method: "POST", body: JSON.stringify({
      title: "Test minimum de participants", slug: `min-part-test-${Date.now()}`, category: "Networking", description: "Événement de test pour le minimum de participants.",
      startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000).toISOString(),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2500,
      minParticipants: 5, minParticipantsDeadline: new Date(Date.now() + 86_400_000).toISOString()
    }) }, organizer.token);
    createdEventIds.push(event.id);
    await api(`/admin/events/${event.id}/submit-for-review`, { method: "POST" }, organizer.token);
    await api(`/admin/events/${event.id}/review-decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);

    const participant = await directParticipant("MinPartBuyer");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);

    // Simule le passage de la fenêtre de notification (normalement posée par le balayage
    // périodique une fois la date limite dépassée) sans attendre une vraie minute réelle.
    await prisma.event.update({ where: { id: event.id }, data: { minParticipantsNotifiedAt: new Date() } });

    const decision = await api<{ cancelled: boolean; refundedCount: number }>(`/admin/events/${event.id}/min-participants-decision`, { method: "POST", body: JSON.stringify({ action: "CANCEL" }) }, organizer.token);
    expect(decision.status).toBe(200);
    expect(decision.body.cancelled).toBe(true);
    expect(decision.body.refundedCount).toBe(1);

    const updatedEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updatedEvent.minParticipantsOutcome).toBe("CANCELLED");
    expect(updatedEvent.status).toBe("CANCELLED");

    const payment = await prisma.payment.findFirstOrThrow({ where: { reservation: { applicationId: applyRes.body.application.id } } });
    expect(payment.status).toBe("REFUNDED");
  }, 20_000);
});

describe("partage attribué : clic, inscription et achat rattachés au bon lien, jamais à soi-même", () => {
  it("compte le clic et attribue la candidature au partageur, mais jamais un partage vers soi-même", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: "soiree-nour-x-amana" } });
    const sharer = await tracked("SharerTest");
    const buyer = await directParticipant("SharedBuyer");
    createdUserIds.push(buyer.userId);

    const { body: link } = await api<{ code: string; url: string }>(`/events/${event.id}/share-link`, { method: "POST" }, sharer.token);
    expect(link.url).toContain(link.code);

    // Le clic est public (n'importe qui suivant le lien), sans authentification.
    const click = await api(`/share-links/${link.code}/click`, { method: "POST" });
    expect(click.status).toBe(204);

    // Le partageur qui applique via son propre lien ne s'attribue jamais lui-même.
    const selfApply = await applyToEvent(event.id, sharer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE, shareCode: link.code });
    expect(selfApply.status).toBe(201);

    const buyerApply = await applyToEvent(event.id, buyer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE, shareCode: link.code });
    expect(buyerApply.status).toBe(201);
    await payAndConfirm(buyerApply.body.application.id, buyer.token);

    const admin = await adminToken();
    const stats = await api<{ totalClicks: number; totalAttributedApplications: number; totalAttributedPurchases: number }>(`/admin/events/${event.id}/shares`, {}, admin);
    expect(stats.body.totalClicks).toBe(1);
    expect(stats.body.totalAttributedApplications).toBe(1);
    expect(stats.body.totalAttributedPurchases).toBe(1);

    const selfApplication = await prisma.application.findUniqueOrThrow({ where: { eventId_userId: { eventId: event.id, userId: sharer.userId } } });
    expect(selfApplication.attributedShareLinkId).toBeNull();
  }, 20_000);
});

// Un participant DIRECT (networking) n'a besoin d'aucune validation de profil, seulement d'un
// profil complété : inscription minimale dédiée à ces tests de politique de remboursement.
async function directParticipant(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  await api("/me/profile", { method: "PATCH", body: JSON.stringify({ displayName, city: "Paris", interests: [] }) }, body.token);
  const { body: me } = await api<{ id: string }>("/me", {}, body.token);
  return { token: body.token, userId: me.id };
}

describe("politique d’annulation/remboursement autour de la limite exacte de 24 heures", () => {
  it("remboursement intégral automatique pour une annulation à plus de 24h de l’événement", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-remb-plus-24h-${Date.now()}`, title: "Test remboursement > 24h", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour la politique de remboursement.",
      startsAt: new Date(Date.now() + 48 * 60 * 60_000), endsAt: new Date(Date.now() + 50 * 60 * 60_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 3000, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const participant = await directParticipant("RembPlus24h");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);

    const cancelRes = await api<{ cancelled: boolean; refunded: boolean; refundedAmountCents: number | null; eligible: boolean }>(`/me/applications/${applyRes.body.application.id}/cancel`, { method: "POST" }, participant.token);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.eligible).toBe(true);
    expect(cancelRes.body.refunded).toBe(true);
    expect(cancelRes.body.refundedAmountCents).toBe(3000);
  }, 20_000);

  it("aucun remboursement de plein droit pour une annulation à 24h ou moins de l’événement, sauf exception admin motivée", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-remb-moins-24h-${Date.now()}`, title: "Test remboursement ≤ 24h", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour la politique de remboursement.",
      startsAt: new Date(Date.now() + 12 * 60 * 60_000), endsAt: new Date(Date.now() + 14 * 60 * 60_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 4000, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const participant = await directParticipant("RembMoins24h");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);

    const cancelRes = await api<{ refunded: boolean; eligible: boolean }>(`/me/applications/${applyRes.body.application.id}/cancel`, { method: "POST" }, participant.token);
    expect(cancelRes.body.eligible).toBe(false);
    expect(cancelRes.body.refunded).toBe(false);

    const payment = await prisma.payment.findFirstOrThrow({ where: { reservation: { applicationId: applyRes.body.application.id } } });
    const admin = await adminToken();
    const withoutReason = await api(`/admin/payments/${payment.id}/refund`, { method: "POST", body: JSON.stringify({}) }, admin);
    expect(withoutReason.status).toBe(400);

    const withReason = await api<{ refunded: boolean; exception: boolean }>(`/admin/payments/${payment.id}/refund`, { method: "POST", body: JSON.stringify({ reason: "Exception accordée pour raison médicale." }) }, admin);
    expect(withReason.status).toBe(200);
    expect(withReason.body.refunded).toBe(true);
    expect(withReason.body.exception).toBe(true);
  }, 20_000);
});
