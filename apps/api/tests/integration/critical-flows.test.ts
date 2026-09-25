// Tests d'intégration contre le vrai serveur de développement (docker compose up requis). Ils
// couvrent les scénarios à plus fort risque déjà vérifiés manuellement pendant le développement
// (concurrence, sécurité, paiement) pour les protéger d'une régression future. Ce n'est pas une
// couverture exhaustive de tout le cahier des charges : voir le rapport de la Phase 8 pour ce qui
// reste testé manuellement uniquement.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addRestaurantPhoto, api, adminToken, ensureServerRunning, makeValidatedParticipant, deleteTestUsers, testPhone, prisma, signStripeWebhook, applyToEvent, payAndConfirm, SCREENING_ANSWERS_FIXTURE, NETWORKING_ANSWERS_FIXTURE } from "./helpers.js";

const createdUserIds: string[] = [];
async function tracked(displayName?: string, quotaCategory?: "HOMME" | "FEMME") {
  const participant = await makeValidatedParticipant(displayName, quotaCategory);
  createdUserIds.push(participant.userId);
  return participant;
}
// Suivis séparément des utilisateurs (nettoyage en afterAll même si un test échoue en cours de
// route, plutôt qu'un delete en fin de bloc qui ne s'exécuterait jamais dans ce cas).
const createdEventIds: string[] = [];
const createdArticleIds: string[] = [];

beforeAll(ensureServerRunning);
afterAll(async () => {
  await deleteTestUsers(createdUserIds);
  for (const id of createdEventIds) await prisma.event.delete({ where: { id } }).catch(() => {});
  for (const id of createdArticleIds) await prisma.article.delete({ where: { id } }).catch(() => {});
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
    await addRestaurantPhoto(orgToken);
    await api(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
    // Le rôle vient de changer côté serveur : un jeton fraîchement émis le reflète (voir le test de
    // fraîcheur du rôle ci-dessus).
    const { body: reverify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) });
    orgToken = reverify.token;

    // 404 (et non 403) : on ne confirme jamais à un restaurateur qu'un événement existe chez un
    // concurrent, seulement qu'il n'est pas accessible depuis son propre compte.
    const quotas = await api(`/admin/events/${foreignEvent.id}/quotas`, { method: "POST", body: JSON.stringify({ homme: 1, femme: 1 }) }, orgToken);
    expect(quotas.status).toBe(404);

    // Corrections web 2026-09-24 (§6.2) : le grand livre est une information interne de Nūr Meet.
    const ledger = await api<any[]>("/admin/finance/ledger", {}, orgToken);
    expect(ledger.status).toBe(403);
  });
});

describe("entretien global : porte d’entrée obligatoire avant toute inscription à un événement à sélection, jamais pour un accès direct", () => {
  it("refuse l’inscription à un speed dating (SCREENING) tant que le profil n’est pas validé, puis l’autorise après validation", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "GateTest" }) });
    const token = verify.token;
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName: "GateTest", city: "Paris", interests: [], quotaCategory: "HOMME" }) }, token);
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);

    const { body: { items: events } } = await api<{ items: any[] }>("/events");
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
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName: "DirectTest", city: "Paris", interests: [] }) }, token);
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);

    const { body: { items: events } } = await api<{ items: any[] }>("/events");
    const directEvent = events.find(e => e.flow === "DIRECT");
    expect(directEvent).toBeTruthy();
    // Arbitrage 12/E3 : aucun questionnaire à l'inscription networking (il n'est proposé qu'une fois
    // la place confirmée) — un corps vide suffit, et jamais un refus pour défaut de validation.
    const allowed = await api(`/events/${directEvent.id}/apply`, { method: "POST", body: JSON.stringify({}) }, token);
    expect(allowed.status).toBe(201);
    expect(allowed.body.application.status).toBe("PAYMENT_PENDING");
  });

  it("impose un délai de trois mois avant de redemander un entretien après un refus", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "RefusTest" }) });
    const token = verify.token;
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName: "RefusTest", city: "Paris", interests: [] }) }, token);
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);

    const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, token);
    const admin = await adminToken();
    await api(`/admin/global-interviews/${interview.id}/decision`, { method: "POST", body: JSON.stringify({ accept: false, notes: "Motif interne confidentiel jamais destiné au participant." }) }, admin);

    // §4.1 : un refus reste neutre, quel que soit le motif interne consigné par l'admin.
    const refusalNotification = await prisma.notification.findFirstOrThrow({ where: { userId: me.id, title: "Profil non validé" } });
    expect(refusalNotification.body).not.toMatch(/motif interne confidentiel/i);
    const own = await api<Record<string, unknown>>("/me/global-interview", {}, token);
    expect(own.body.notes).toBeUndefined();
    const list = await api<Record<string, unknown>[]>("/me/applications", {}, token);
    expect(JSON.stringify(list.body)).not.toMatch(/motif interne confidentiel/i);

    const retry = await api("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Nouvelle tentative avec une motivation suffisamment longue cette fois." }) }, token);
    expect(retry.status).toBe(409);
    expect(retry.body.retryAvailableAt).toBeTruthy();
    const retryDate = new Date(retry.body.retryAvailableAt);
    const expectedMinimum = new Date(Date.now() + 89 * 24 * 60 * 60_000);
    expect(retryDate.getTime()).toBeGreaterThan(expectedMinimum.getTime());
  });
});

describe("reprogrammation d’un entretien par l’administration, avec notification (§13/§14)", () => {
  it("libère l’ancien créneau et notifie le participant du nouveau", async () => {
    const participant = await directParticipant("RescheduleTest");
    createdUserIds.push(participant.userId);
    const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, participant.token);

    const base = Date.now() + 5 * 86_400_000;
    const [slotA, slotB] = await Promise.all([
      prisma.screeningCall.create({ data: { startsAt: new Date(base), endsAt: new Date(base + 900_000) } }),
      prisma.screeningCall.create({ data: { startsAt: new Date(base + 3_600_000), endsAt: new Date(base + 4_500_000) } })
    ]);
    await api(`/applications/${interview.id}/schedule`, { method: "POST", body: JSON.stringify({ slotId: slotA.id }) }, participant.token);

    const admin = await adminToken();
    const reschedule = await api<{ rescheduled: boolean; slot: { id: string } }>(`/admin/global-interviews/${interview.id}/reschedule`, { method: "POST", body: JSON.stringify({ slotId: slotB.id }) }, admin);
    expect(reschedule.status).toBe(200);
    expect(reschedule.body.slot.id).toBe(slotB.id);

    const freedSlot = await prisma.screeningCall.findUniqueOrThrow({ where: { id: slotA.id } });
    expect(freedSlot.applicationId).toBeNull();
    const claimedSlot = await prisma.screeningCall.findUniqueOrThrow({ where: { id: slotB.id } });
    expect(claimedSlot.applicationId).toBe(interview.id);

    const notification = await prisma.notification.findFirstOrThrow({ where: { userId: participant.userId, title: "Entretien reprogrammé" } });
    expect(notification).toBeTruthy();
    await prisma.screeningCall.deleteMany({ where: { id: { in: [slotA.id, slotB.id] } } });
  });

  it("refuse de reprogrammer sur un créneau déjà pris par quelqu’un d’autre", async () => {
    const participant = await directParticipant("RescheduleConflict");
    createdUserIds.push(participant.userId);
    const other = await directParticipant("RescheduleConflictOther");
    createdUserIds.push(other.userId);
    const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, participant.token);
    const { body: otherInterview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, other.token);

    const base = Date.now() + 6 * 86_400_000;
    const [mySlot, takenSlot] = await Promise.all([
      prisma.screeningCall.create({ data: { startsAt: new Date(base), endsAt: new Date(base + 900_000) } }),
      prisma.screeningCall.create({ data: { startsAt: new Date(base + 3_600_000), endsAt: new Date(base + 4_500_000) } })
    ]);
    await api(`/applications/${interview.id}/schedule`, { method: "POST", body: JSON.stringify({ slotId: mySlot.id }) }, participant.token);
    await api(`/applications/${otherInterview.id}/schedule`, { method: "POST", body: JSON.stringify({ slotId: takenSlot.id }) }, other.token);

    const admin = await adminToken();
    const reschedule = await api(`/admin/global-interviews/${interview.id}/reschedule`, { method: "POST", body: JSON.stringify({ slotId: takenSlot.id }) }, admin);
    expect(reschedule.status).toBe(409);

    // Le créneau d'origine n'a jamais été libéré puisque la reprogrammation a échoué (transaction annulée).
    const untouchedSlot = await prisma.screeningCall.findUniqueOrThrow({ where: { id: mySlot.id } });
    expect(untouchedSlot.applicationId).toBe(interview.id);
    await prisma.screeningCall.deleteMany({ where: { id: { in: [mySlot.id, takenSlot.id] } } });
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
        api(`/applications/${appA.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, a.token),
        api(`/applications/${appB.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, b.token)
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

describe("tarification différenciée homme/femme protégée par ENABLE_GENDER_PRICING (§6)", () => {
  it("ignore les PriceTier et facture le tarif unique tant que le drapeau est désactivé (comportement par défaut)", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-tarifs-off-${Date.now()}`, title: "Test tarifs désactivés", category: "Networking",
      description: "Événement de test pour vérifier que la tarification différenciée reste inactive par défaut.",
      startsAt: new Date(Date.now() + 30 * 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000 + 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2500,
      status: "PUBLISHED",
      priceTiers: { create: [{ category: "HOMME", amountCents: 3000 }, { category: "FEMME", amountCents: 2000 }] }
    } });
    createdEventIds.push(event.id);

    const publicEvent = await api<{ priceTiers: unknown[] }>(`/events/${event.slug}`);
    expect(publicEvent.body.priceTiers).toEqual([]);

    const femme = await tracked("PrixFemmeOff", "FEMME");
    const applyRes = await applyToEvent(event.id, femme.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const intent = await api<{ amountCents: number }>(`/applications/${applyRes.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, femme.token);
    expect(intent.body.amountCents).toBe(2500);
  });

  it("facture le tarif de la catégorie du participant une fois le drapeau explicitement activé par un admin", async () => {
    const admin = await adminToken();
    const event = await prisma.event.create({ data: {
      slug: `test-tarifs-on-${Date.now()}`, title: "Test tarifs activés", category: "Networking",
      description: "Événement de test pour vérifier la résolution des tarifs différenciés une fois activés.",
      startsAt: new Date(Date.now() + 30 * 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000 + 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2500,
      status: "PUBLISHED",
      priceTiers: { create: [{ category: "HOMME", amountCents: 3000 }, { category: "FEMME", amountCents: 2000 }] }
    } });
    createdEventIds.push(event.id);

    await api("/admin/settings/ENABLE_GENDER_PRICING", { method: "PATCH", body: JSON.stringify({ value: true }) }, admin);
    try {
      const publicEvent = await api<{ priceTiers: unknown[] }>(`/events/${event.slug}`);
      expect(publicEvent.body.priceTiers).toHaveLength(2);

      const femme = await tracked("PrixFemmeOn", "FEMME");
      const applyRes = await applyToEvent(event.id, femme.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
      const intent = await api<{ amountCents: number }>(`/applications/${applyRes.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, femme.token);
      expect(intent.body.amountCents).toBe(2000);
    } finally {
      // Restaure la valeur par défaut : ne doit jamais rester activé au-delà de ce test.
      await api("/admin/settings/ENABLE_GENDER_PRICING", { method: "PATCH", body: JSON.stringify({ value: false }) }, admin);
    }
  });
});

describe("aucune survente si un paiement Stripe arrive après libération de la place", () => {
  it("n’émet pas de billet et journalise le cas plutôt que de confirmer", async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { slug: "soiree-nour-x-amana" } });
    const participant = await tracked("RaceCondition");

    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const application = applyRes.body.application;

    const intent = await api<{ clientSecret: string }>(`/applications/${application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, participant.token);
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

describe("chevauchement horaire interdit entre deux réservations actives (§11)", () => {
  it("refuse une place sur un événement qui chevauche une réservation déjà active, mais accepte un créneau contigu", async () => {
    // Fenêtres éloignées de toute autre date utilisée par les autres tests pour rester déterministe.
    const base = Date.now() + 200 * 86_400_000;
    const overlapping = await prisma.event.create({ data: {
      slug: `test-overlap-a-${Date.now()}`, title: "Test chevauchement A", category: "Networking",
      description: "Événement de test pour le chevauchement horaire.",
      startsAt: new Date(base), endsAt: new Date(base + 3 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    const conflicting = await prisma.event.create({ data: {
      slug: `test-overlap-b-${Date.now()}`, title: "Test chevauchement B", category: "Networking",
      description: "Événement de test pour le chevauchement horaire, avec un horaire qui empiète sur le premier.",
      startsAt: new Date(base + 1.5 * 3_600_000), endsAt: new Date(base + 4.5 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    const contiguous = await prisma.event.create({ data: {
      // Commence exactement quand le premier finit : contigu, pas de chevauchement au sens strict.
      slug: `test-overlap-c-${Date.now()}`, title: "Test chevauchement C", category: "Networking",
      description: "Événement de test pour le chevauchement horaire, avec un horaire strictement contigu au premier.",
      startsAt: new Date(base + 3 * 3_600_000), endsAt: new Date(base + 5 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    createdEventIds.push(overlapping.id, conflicting.id, contiguous.id);

    const participant = await directParticipant("OverlapTest");
    createdUserIds.push(participant.userId);

    const firstApply = await applyToEvent(overlapping.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const firstPay = await api(`/applications/${firstApply.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, participant.token);
    expect(firstPay.status).toBe(200);

    const conflictingApply = await applyToEvent(conflicting.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const conflictingPay = await api(`/applications/${conflictingApply.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, participant.token);
    expect(conflictingPay.status).toBe(409);
    expect((conflictingPay.body as any).error).toMatch(/chevauche/i);
    expect((conflictingPay.body as any).waitlisted).toBeFalsy();

    const contiguousApply = await applyToEvent(contiguous.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    const contiguousPay = await api(`/applications/${contiguousApply.body.application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, participant.token);
    expect(contiguousPay.status).toBe(200);
  });
});

describe("retrait automatique de la liste d’attente d’origine si l’alternatif accepté est incompatible (§11)", () => {
  it("retire l’inscription d’origine quand l’alternatif accepté chevauche son horaire", async () => {
    const base = Date.now() + 210 * 86_400_000;
    const original = await prisma.event.create({ data: {
      slug: `test-altwaitlist-orig-incompat-${Date.now()}`, title: "Test original (incompatible)", category: "Networking",
      description: "Événement de test pour le retrait de liste d'attente.",
      startsAt: new Date(base), endsAt: new Date(base + 3 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    const alternative = await prisma.event.create({ data: {
      slug: `test-altwaitlist-alt-incompat-${Date.now()}`, title: "Test alternatif (incompatible)", category: "Networking",
      description: "Événement de test pour le retrait de liste d'attente, horaire chevauchant l'original.",
      startsAt: new Date(base + 1 * 3_600_000), endsAt: new Date(base + 4 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    createdEventIds.push(original.id, alternative.id);

    const participant = await directParticipant("AltWaitlistIncompat");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(original.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await prisma.waitlistEntry.create({ data: { eventId: original.id, userId: participant.userId, applicationId: applyRes.body.application.id, position: 1 } });
    const offer = await prisma.alternativeOffer.create({ data: { userId: participant.userId, originalEventId: original.id, alternativeEventId: alternative.id, respondsBy: new Date(Date.now() + 86_400_000) } });

    const respond = await api(`/alternative-offers/${offer.id}/respond`, { method: "POST", body: JSON.stringify({ accept: true }) }, participant.token);
    expect(respond.status).toBe(200);

    const remainingEntry = await prisma.waitlistEntry.findUnique({ where: { eventId_userId: { eventId: original.id, userId: participant.userId } } });
    expect(remainingEntry).toBeNull();
  });

  it("conserve l’inscription d’origine quand l’alternatif accepté a un horaire compatible (pas de chevauchement)", async () => {
    const base = Date.now() + 220 * 86_400_000;
    const original = await prisma.event.create({ data: {
      slug: `test-altwaitlist-orig-compat-${Date.now()}`, title: "Test original (compatible)", category: "Networking",
      description: "Événement de test pour le retrait de liste d'attente.",
      startsAt: new Date(base), endsAt: new Date(base + 3 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    const alternative = await prisma.event.create({ data: {
      slug: `test-altwaitlist-alt-compat-${Date.now()}`, title: "Test alternatif (compatible)", category: "Networking",
      description: "Événement de test pour le retrait de liste d'attente, horaire distinct de l'original.",
      startsAt: new Date(base + 10 * 86_400_000), endsAt: new Date(base + 10 * 86_400_000 + 3 * 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    createdEventIds.push(original.id, alternative.id);

    const participant = await directParticipant("AltWaitlistCompat");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(original.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await prisma.waitlistEntry.create({ data: { eventId: original.id, userId: participant.userId, applicationId: applyRes.body.application.id, position: 1 } });
    const offer = await prisma.alternativeOffer.create({ data: { userId: participant.userId, originalEventId: original.id, alternativeEventId: alternative.id, respondsBy: new Date(Date.now() + 86_400_000) } });

    const respond = await api(`/alternative-offers/${offer.id}/respond`, { method: "POST", body: JSON.stringify({ accept: true }) }, participant.token);
    expect(respond.status).toBe(200);

    const remainingEntry = await prisma.waitlistEntry.findUnique({ where: { eventId_userId: { eventId: original.id, userId: participant.userId } } });
    expect(remainingEntry).toBeTruthy();
  });
});

async function newOrganizer(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body: verify } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  let token = verify.token;
  const { body: me } = await api<{ id: string }>("/me", {}, token);
  const { body: restaurant } = await api<{ id: string }>("/restaurants/apply", { method: "POST", body: JSON.stringify({ name: `${displayName} Resto`, managerName: displayName, siret: "12345678900019" }) }, token);
  const admin = await adminToken();
  await addRestaurantPhoto(token);
  await api(`/admin/restaurants/${restaurant.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
  // L'approbation ne crée plus d'abonnement (le restaurateur choisit sa formule) ; or une soirée ne
  // peut être publiée qu'avec un abonnement actif : on l'attribue comme le ferait l'administration.
  const standard = await prisma.plan.findFirstOrThrow({ where: { name: "Standard", active: true } });
  await api(`/admin/restaurants/${restaurant.id}/subscription`, { method: "POST", body: JSON.stringify({ planId: standard.id, status: "ACTIVE" }) }, admin);
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
    // L'abonnement réel naît d'un checkout Stripe Billing (webhook) : simulé ici directement en base,
    // seul l'état ACTIVE compte pour la publication. Le quota est lu sur le plan, jamais codé en dur.
    const plan = await prisma.plan.findFirstOrThrow({ where: { active: true, monthlyEventQuota: { not: null } } });
    const quota = plan.monthlyEventQuota!;
    await prisma.restaurantSubscription.upsert({ where: { restaurantId: organizer.restaurantId }, update: { planId: plan.id, status: "ACTIVE" }, create: { restaurantId: organizer.restaurantId, planId: plan.id, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });

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

    for (let n = 1; n <= quota; n++) expect((await publishOne(n)).status).toBe(200);
    const overQuota = await publishOne(quota + 1);
    expect(overQuota.status).toBe(409);
    expect((overQuota.body as any).error).toMatch(/quota/i);

    const usage = await prisma.restaurantMonthlyUsage.findFirstOrThrow({ where: { restaurantId: organizer.restaurantId } });
    expect(usage.eventsPublished).toBe(quota);
  });
});

describe("un restaurateur ne voit jamais les coordonnées complètes d’un participant (§8.3/§20)", () => {
  it("renvoie le prénom mais jamais le téléphone ni l’e-mail à l’organisateur, contrairement à l’admin", async () => {
    const organizer = await newOrganizer("PrivacyAttendeesTest");
    createdUserIds.push(organizer.userId);
    const admin = await adminToken();
    const { body: event } = await api<{ id: string }>("/admin/events", { method: "POST", body: JSON.stringify({
      title: "Test confidentialité participants", slug: `privacy-attendees-test-${Date.now()}`, category: "Networking", description: "Événement de test pour la confidentialité des coordonnées.",
      startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000).toISOString(),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000
    }) }, organizer.token);
    createdEventIds.push(event.id);
    await api(`/admin/events/${event.id}/submit-for-review`, { method: "POST" }, organizer.token);
    await api(`/admin/events/${event.id}/review-decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);

    const participant = await directParticipant("PrivacyAttendee");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);

    const asOrganizer = await api<any[]>(`/admin/events/${event.id}/reservations`, {}, organizer.token);
    expect(asOrganizer.status).toBe(200);
    expect(asOrganizer.body).toHaveLength(1);
    expect(asOrganizer.body[0].user.displayName).toBe("PrivacyAttendee");
    expect(asOrganizer.body[0].user.phone).toBeUndefined();
    expect(asOrganizer.body[0].user.email).toBeUndefined();

    const asAdmin = await api<any[]>(`/admin/events/${event.id}/reservations`, {}, admin);
    expect(asAdmin.body[0].user.phone).toBeTruthy();
  });
});

describe("filtres du tableau de bord admin : événement, type, statut, ville (§14)", () => {
  it("isole les compteurs à l’événement, la catégorie ou la ville demandés", async () => {
    const admin = await adminToken();
    const marker = Date.now();
    const speedEvent = await prisma.event.create({ data: {
      slug: `test-dashfilter-speed-${marker}`, title: "Test filtre speed dating", category: "Speed dating", flow: "SCREENING",
      description: "Événement de test pour les filtres du dashboard.",
      startsAt: new Date(Date.now() + 20 * 86_400_000), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000),
      district: "Villeneuve-sur-Test", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    const networkingEvent = await prisma.event.create({ data: {
      slug: `test-dashfilter-net-${marker}`, title: "Test filtre networking", category: "Networking",
      description: "Événement de test pour les filtres du dashboard.",
      startsAt: new Date(Date.now() + 21 * 86_400_000), endsAt: new Date(Date.now() + 21 * 86_400_000 + 3_600_000),
      district: "Ailleurs-sur-Test", address: "2 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED"
    } });
    createdEventIds.push(speedEvent.id, networkingEvent.id);

    const byEvent = await api<{ events: number }>(`/admin/dashboard?eventId=${speedEvent.id}`, {}, admin);
    expect(byEvent.body.events).toBe(1);

    const byCategory = await api<{ events: number }>(`/admin/dashboard?category=${encodeURIComponent("Speed dating")}`, {}, admin);
    expect(byCategory.body.events).toBeGreaterThanOrEqual(1);
    const byCategoryNetworking = await api<{ events: number }>(`/admin/dashboard?category=Networking&eventId=${speedEvent.id}`, {}, admin);
    // Combiner un filtre catégorie incompatible avec l'eventId choisi ne doit remonter aucun événement.
    expect(byCategoryNetworking.body.events).toBe(0);

    const byCity = await api<{ events: number }>(`/admin/dashboard?city=${encodeURIComponent("villeneuve-sur-test")}`, {}, admin);
    expect(byCity.body.events).toBe(1);

    const byStatus = await api<{ events: number }>(`/admin/dashboard?status=CANCELLED&eventId=${networkingEvent.id}`, {}, admin);
    expect(byStatus.body.events).toBe(0);
  });
});

describe("volume brut billets restaurateurs à jour même sans registre commission (§14)", () => {
  it("reflète une vente sous abonnement dans grossTicketVolumeCents, indépendamment d’ENABLE_COMMISSION_LEDGER", async () => {
    const admin = await adminToken();
    // ENABLE_COMMISSION_LEDGER=false est la valeur par défaut depuis le Lot 2 : aucune LedgerEntry
    // n'est créée pour cette vente, ce qui est exactement le cas que ce test protège.
    const ledgerEnabled = (await api<{ value: boolean }>("/admin/settings/ENABLE_COMMISSION_LEDGER", { method: "PATCH", body: JSON.stringify({ value: false }) }, admin)).body.value;
    expect(ledgerEnabled).toBe(false);

    const organizer = await newOrganizer("FinanceVolumeTest");
    createdUserIds.push(organizer.userId);
    const { body: event } = await api<{ id: string; slug: string }>("/admin/events", { method: "POST", body: JSON.stringify({
      title: "Test volume brut", slug: `finance-volume-test-${Date.now()}`, category: "Networking", description: "Événement de test pour le volume brut restaurateur.",
      startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000).toISOString(),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 4200
    }) }, organizer.token);
    createdEventIds.push(event.id);
    await api(`/admin/events/${event.id}/submit-for-review`, { method: "POST" }, organizer.token);
    await api(`/admin/events/${event.id}/review-decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);

    const buyer = await directParticipant("FinanceVolumeBuyer");
    createdUserIds.push(buyer.userId);
    const applyRes = await applyToEvent(event.id, buyer.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, buyer.token);

    const ledgerEntry = await prisma.ledgerEntry.findFirst({ where: { eventId: event.id } });
    expect(ledgerEntry).toBeNull();

    const before = (await api<{ grossTicketVolumeCents: number; commissionLedgerEnabled: boolean }>("/admin/finance/summary", {}, admin)).body;
    expect(before.commissionLedgerEnabled).toBe(false);
    expect(before.grossTicketVolumeCents).toBeGreaterThanOrEqual(4200);

    // §6.2 : le restaurateur ne lit plus la synthèse financière interne ; il retrouve ses propres
    // ventes dans son tableau de bord d'administration.
    expect((await api("/admin/finance/summary", {}, organizer.token)).status).toBe(403);
    const dashboard = (await api<{ revenueCents: number }>("/admin/dashboard", {}, organizer.token)).body;
    expect(dashboard.revenueCents).toBe(4200);
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
  await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName, city: "Paris", interests: [] }) }, body.token);
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

describe("droits RGPD : export, et suppression par anonymisation sans toucher aux données comptables (§20)", () => {
  it("l’export personnel reprend le profil, les candidatures, réservations et paiements du compte", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-rgpd-export-${Date.now()}`, title: "Test export RGPD", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour l'export RGPD.",
      startsAt: new Date(Date.now() + 20 * 86_400_000), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2200, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const participant = await directParticipant("RgpdExport");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);
    // Arbitrage 12/E3 : questionnaire professionnel envoyé après confirmation de la place.
    expect((await api(`/applications/${applyRes.body.application.id}/networking-answers`, { method: "POST", body: JSON.stringify(NETWORKING_ANSWERS_FIXTURE) }, participant.token)).status).toBeLessThan(300);

    const exportRes = await api<any>("/me/export", {}, participant.token);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.account.id).toBe(participant.userId);
    expect(exportRes.body.applications).toHaveLength(1);
    expect(exportRes.body.applications[0].networkingAnswer.sector).toBe(NETWORKING_ANSWERS_FIXTURE.sector);
    expect(exportRes.body.reservations).toHaveLength(1);
    expect(exportRes.body.payments).toHaveLength(1);
    expect(exportRes.body.payments[0].amountCents).toBe(2200);
  });

  it("refuse la suppression tant qu’une réservation active porte sur un événement à venir", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-rgpd-blocked-${Date.now()}`, title: "Test suppression bloquée", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour le blocage de la suppression RGPD.",
      startsAt: new Date(Date.now() + 20 * 86_400_000), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2200, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const participant = await directParticipant("RgpdBlocked");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);

    const deletion = await api("/me/request-deletion", { method: "POST" }, participant.token);
    expect(deletion.status).toBe(409);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: participant.userId } });
    expect(user.deletedAt).toBeNull();
  });

  it("anonymise le compte sans toucher au paiement déjà encaissé, et bloque toute connexion ultérieure", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-rgpd-delete-${Date.now()}`, title: "Test suppression RGPD", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour la suppression RGPD.",
      startsAt: new Date(Date.now() + 48 * 60 * 60_000), endsAt: new Date(Date.now() + 50 * 60 * 60_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2600, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const participant = await directParticipant("RgpdDelete");
    createdUserIds.push(participant.userId);
    const applyRes = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    await payAndConfirm(applyRes.body.application.id, participant.token);
    expect((await api(`/applications/${applyRes.body.application.id}/networking-answers`, { method: "POST", body: JSON.stringify(NETWORKING_ANSWERS_FIXTURE) }, participant.token)).status).toBeLessThan(300);
    // Libère la réservation (remboursable, > 24h de l'événement) pour ne plus bloquer la suppression.
    const cancelRes = await api<{ refunded: boolean }>(`/me/applications/${applyRes.body.application.id}/cancel`, { method: "POST" }, participant.token);
    expect(cancelRes.body.refunded).toBe(true);

    const paymentBefore = await prisma.payment.findFirstOrThrow({ where: { reservation: { applicationId: applyRes.body.application.id } } });
    const phoneBefore = (await prisma.user.findUniqueOrThrow({ where: { id: participant.userId } })).phone;

    const deletion = await api<{ deleted: boolean }>("/me/request-deletion", { method: "POST" }, participant.token);
    expect(deletion.status).toBe(200);
    expect(deletion.body.deleted).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: participant.userId } });
    expect(user.deletedAt).toBeTruthy();
    expect(user.email).toBeNull();
    expect(user.displayName).toBe("Compte supprimé");
    expect(user.phone).not.toBe(phoneBefore);

    const networkingAnswer = await prisma.networkingAnswer.findUniqueOrThrow({ where: { applicationId: applyRes.body.application.id } });
    expect(networkingAnswer.sector).toBe("[supprimé]");

    // Comptable : jamais touché par l'anonymisation, quel que soit le statut du compte.
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: paymentBefore.id } });
    expect(paymentAfter.amountCents).toBe(paymentBefore.amountCents);
    expect(paymentAfter.status).toBe(paymentBefore.status);

    const blockedMe = await api("/me", {}, participant.token);
    expect(blockedMe.status).toBe(403);
  }, 20_000);
});

describe("photo de profil : envoi, remplacement, suppression, et nettoyage RGPD", () => {
  const fakeJpeg = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00])], { type: "image/jpeg" });

  it("accepte un envoi, remplace le fichier précédent, puis supprime au retrait", async () => {
    const participant = await directParticipant("PhotoTest");
    createdUserIds.push(participant.userId);

    const firstForm = new FormData();
    firstForm.append("file", fakeJpeg(), "photo1.jpg");
    const firstUpload = await api<{ photoUrl: string }>("/me/profile-photo", { method: "POST", body: firstForm as any }, participant.token);
    expect(firstUpload.status).toBe(200);
    const firstUrl = firstUpload.body.photoUrl;
    const firstFetch = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}${firstUrl}`);
    expect(firstFetch.status).toBe(200);

    const secondForm = new FormData();
    secondForm.append("file", fakeJpeg(), "photo2.jpg");
    const secondUpload = await api<{ photoUrl: string }>("/me/profile-photo", { method: "POST", body: secondForm as any }, participant.token);
    expect(secondUpload.status).toBe(200);
    expect(secondUpload.body.photoUrl).not.toBe(firstUrl);
    // Le remplacement supprime le fichier précédent, jamais juste la référence en base.
    const firstFetchAfterReplace = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}${firstUrl}`);
    expect(firstFetchAfterReplace.status).toBe(404);

    const me = await api<{ profile: { photoUrl: string } }>("/me", {}, participant.token);
    expect(me.body.profile.photoUrl).toBe(secondUpload.body.photoUrl);

    const removed = await api("/me/profile-photo", { method: "DELETE" }, participant.token);
    expect(removed.status).toBe(204);
    const secondFetchAfterDelete = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}${secondUpload.body.photoUrl}`);
    expect(secondFetchAfterDelete.status).toBe(404);
  });

  it("refuse un type de fichier non autorisé", async () => {
    const participant = await directParticipant("PhotoRejectTest");
    createdUserIds.push(participant.userId);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("not an image")], { type: "text/plain" }), "notes.txt");
    const res = await api("/me/profile-photo", { method: "POST", body: form as any }, participant.token);
    expect(res.status).toBe(415);
  });

  it("supprime le fichier de la photo de profil lors de l’anonymisation RGPD, pas seulement la colonne", async () => {
    const participant = await directParticipant("PhotoRgpdTest");
    createdUserIds.push(participant.userId);
    const form = new FormData();
    form.append("file", fakeJpeg(), "photo.jpg");
    const upload = await api<{ photoUrl: string }>("/me/profile-photo", { method: "POST", body: form as any }, participant.token);
    const photoUrl = upload.body.photoUrl;

    const deletion = await api<{ deleted: boolean }>("/me/request-deletion", { method: "POST" }, participant.token);
    expect(deletion.status).toBe(200);

    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: participant.userId } });
    expect(profile.photoUrl).toBeNull();
    const fileAfterDeletion = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}${photoUrl}`);
    expect(fileAfterDeletion.status).toBe(404);
  });
});

describe("blog éditorial : validation humaine obligatoire, jamais de publication automatique", () => {
  it("refuse le mot interdit et n'affiche jamais un article publiquement avant PUBLISHED", async () => {
    const admin = await adminToken();

    const forbidden = await api("/admin/articles", { method: "POST", body: JSON.stringify({
      title: "Un sujet de couple", slug: `forbidden-word-${Date.now()}`, content: "Un article destiné à un public musulman de la plateforme.",
      category: "Couple", keywords: []
    }) }, admin);
    expect(forbidden.status).toBe(400);

    const { body: article } = await api<{ id: string; slug: string; status: string }>("/admin/articles", { method: "POST", body: JSON.stringify({
      title: "Bien communiquer en couple", slug: `bien-communiquer-${Date.now()}`, content: "Un contenu suffisamment long pour passer la validation du formulaire soumis.",
      category: "Communication", keywords: ["couple", "communication"]
    }) }, admin);
    createdArticleIds.push(article.id);
    expect(article.status).toBe("DRAFT");

    // Toujours invisible publiquement avant PUBLISHED, à chaque étape du circuit de validation.
    const notYetPublic = await api(`/articles/${article.slug}`);
    expect(notYetPublic.status).toBe(404);

    await api(`/admin/articles/${article.id}/submit-for-review`, { method: "POST" }, admin);
    const stillNotPublic = await api(`/articles/${article.slug}`);
    expect(stillNotPublic.status).toBe(404);

    const decision = await api<{ status: string }>(`/admin/articles/${article.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
    expect(decision.body.status).toBe("APPROVED");
    const approvedNotPublic = await api(`/articles/${article.slug}`);
    expect(approvedNotPublic.status).toBe(404);

    const published = await api<{ status: string }>(`/admin/articles/${article.id}/publish`, { method: "POST" }, admin);
    expect(published.body.status).toBe("PUBLISHED");

    const nowPublic = await api<{ title: string }>(`/articles/${article.slug}`);
    expect(nowPublic.status).toBe(200);
    expect(nowPublic.body.title).toBe("Bien communiquer en couple");

    const history = await api<{ reviewLogs: any[] }>(`/admin/articles/${article.id}`, {}, admin);
    expect(history.body.reviewLogs.map((l: any) => l.toStatus)).toEqual(expect.arrayContaining(["IN_REVIEW", "APPROVED", "PUBLISHED"]));
  });

  it("un brouillon généré par IA reste un brouillon, jamais publié automatiquement", async () => {
    const admin = await adminToken();
    const generated = await api<{ id: string; status: string; aiGenerated: boolean }>("/admin/articles/generate", { method: "POST", body: JSON.stringify({ topic: "Comment surmonter la solitude", category: "Solitude" }) }, admin);
    expect(generated.status).toBe(201);
    createdArticleIds.push(generated.body.id);
    expect(generated.body.status).toBe("DRAFT");
    expect(generated.body.aiGenerated).toBe(true);
  });
});

describe("majorité et acceptation des CGU/CGV", () => {
  it("refuse un profil sans date de naissance, mineur ou sans acceptation des CGU", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName: "MajoriteTest" }) });
    const token = body.token;
    const { body: me } = await api<{ id: string }>("/me", {}, token);
    createdUserIds.push(me.id);
    const base = { displayName: "MajoriteTest", city: "Paris", interests: [] };

    expect((await api("/me/profile", { method: "PATCH", body: JSON.stringify({ ...base, acceptCgu: true }) }, token)).status).toBe(400);
    const minor = new Date(); minor.setUTCFullYear(minor.getUTCFullYear() - 18); minor.setUTCDate(minor.getUTCDate() + 1);
    expect((await api("/me/profile", { method: "PATCH", body: JSON.stringify({ ...base, birthDate: minor.toISOString().slice(0, 10), acceptCgu: true }) }, token)).status).toBe(422);
    expect((await api("/me/profile", { method: "PATCH", body: JSON.stringify({ ...base, birthDate: "1995-01-01" }) }, token)).status).toBe(422);

    expect((await api("/me/profile", { method: "PATCH", body: JSON.stringify({ ...base, birthDate: "1995-01-01", acceptCgu: true }) }, token)).status).toBe(200);
    expect((await api("/me", {}, token)).body.cguAccepted).toBe(true);
    // Une fois la version en vigueur acceptée, les modifications suivantes ne la redemandent pas.
    expect((await api("/me/profile", { method: "PATCH", body: JSON.stringify({ ...base, birthDate: "1995-01-01", city: "Lyon" }) }, token)).status).toBe(200);
    const acceptances = await prisma.legalAcceptance.findMany({ where: { userId: me.id } });
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]).toMatchObject({ document: "CGU", context: "profile" });
  });

  it("refuse de réserver sans acceptation des CGV, puis l’enregistre pour cette candidature", async () => {
    const event = await prisma.event.create({ data: {
      slug: `test-cgv-${Date.now()}`, title: "Test acceptation CGV", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour l’acceptation des CGV.",
      startsAt: new Date(Date.now() + 72 * 60 * 60_000), endsAt: new Date(Date.now() + 74 * 60 * 60_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 0, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const participant = await directParticipant("CgvTest");
    createdUserIds.push(participant.userId);
    const applied = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    expect(applied.status).toBe(201);
    const applicationId = applied.body.application.id;

    const refused = await api(`/applications/${applicationId}/payment-intent`, { method: "POST" }, participant.token);
    expect(refused.status).toBe(422);
    expect(refused.body.cgvRequired).toBe(true);
    expect(await prisma.reservation.findUnique({ where: { applicationId } })).toBeNull();

    const accepted = await api(`/applications/${applicationId}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, participant.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.confirmed).toBe(true);
    const proof = await prisma.legalAcceptance.findFirst({ where: { userId: participant.userId, document: "CGV" } });
    expect(proof?.context).toBe(`application:${applicationId}`);
  });

  it("bloque l’inscription d’un profil complété avant l’obligation de date de naissance", async () => {
    const participant = await directParticipant("AncienProfilTest");
    createdUserIds.push(participant.userId);
    await prisma.profile.update({ where: { userId: participant.userId }, data: { birthDate: null } });
    const event = await prisma.event.create({ data: {
      slug: `test-ancien-profil-${Date.now()}`, title: "Test profil sans date de naissance", category: "Networking", flow: "DIRECT",
      description: "Événement de test pour la majorité.",
      startsAt: new Date(Date.now() + 96 * 60 * 60_000), endsAt: new Date(Date.now() + 98 * 60 * 60_000),
      district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 0, status: "PUBLISHED"
    } });
    createdEventIds.push(event.id);
    const res = await applyToEvent(event.id, participant.token, { networkingAnswers: NETWORKING_ANSWERS_FIXTURE });
    expect(res.status).toBe(409);
  });
});

describe("mise en relation fondée sur le consentement", () => {
  it("n'autorise ni relance après refus, ni double réponse, ni demande à soi-même", async () => {
    const a = await tracked("ContactA");
    const b = await tracked("ContactB");
    expect((await api("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: a.userId }) }, a.token)).status).toBe(400);

    const first = await api<{ id: string }>("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: b.userId }) }, a.token);
    expect(first.status).toBe(200);
    // Une demande déjà en attente n'est pas renotifiée.
    const notificationsBefore = await prisma.notification.count({ where: { userId: b.userId, title: "Nouvelle demande de contact" } });
    expect((await api("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: b.userId }) }, a.token)).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: b.userId, title: "Nouvelle demande de contact" } })).toBe(notificationsBefore);

    expect((await api(`/contacts/${first.body.id}/respond`, { method: "POST", body: JSON.stringify({ accept: false }) }, b.token)).status).toBe(200);
    expect((await api(`/contacts/${first.body.id}/respond`, { method: "POST", body: JSON.stringify({ accept: true }) }, b.token)).status).toBe(409);
    expect((await api("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: b.userId }) }, a.token)).status).toBe(409);
    expect(await prisma.conversationMember.count({ where: { userId: b.userId } })).toBe(0);
  });
});

describe("signalement et confidentialité entre participants", () => {
  it("valide la personne signalée, bloque les deux côtés et empêche toute nouvelle demande", async () => {
    const a = await tracked("SignalA");
    const b = await tracked("SignalB");
    expect((await api("/reports", { method: "POST", body: JSON.stringify({ reportedId: a.userId, reason: "Test" }) }, a.token)).status).toBe(400);
    expect((await api("/reports", { method: "POST", body: JSON.stringify({ reportedId: "inexistant", reason: "Test" }) }, a.token)).status).toBe(404);

    const req = await api<{ id: string }>("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: a.userId }) }, b.token);
    const accepted = await api<{ conversation: { id: string } }>(`/contacts/${req.body.id}/respond`, { method: "POST", body: JSON.stringify({ accept: true }) }, a.token);
    const conversationId = accepted.body.conversation.id;

    // Aucune donnée privée de l'autre personne dans les réponses de mise en relation.
    const convos = await api<any[]>("/conversations", {}, a.token);
    const requests = await api<any[]>("/me/contact-requests", {}, a.token);
    const dump = JSON.stringify([convos.body, requests.body]);
    expect(dump).not.toContain(b.phone);
    expect(dump).not.toMatch(/"(phone|email|birthDate)"/);

    expect((await api("/reports", { method: "POST", body: JSON.stringify({ reportedId: b.userId, reason: "Harcèlement", block: true }) }, a.token)).status).toBe(200);
    // Bloqué dans les deux sens : la personne signalée ne peut plus écrire non plus.
    expect((await api(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ body: "Bonjour" }) }, b.token)).status).toBe(403);
    expect((await api(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ body: "Bonjour" }) }, a.token)).status).toBe(403);
    expect((await api("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: a.userId }) }, b.token)).status).toBe(409);
  });
});
