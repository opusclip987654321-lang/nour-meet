// Connexion par e-mail ou Google et vérification unique du numéro (2026-09-24), contre le vrai serveur.
// Le serveur de test doit tourner sans fournisseur d'e-mail réel (RESEND_API_KEY vide) : le code est
// alors renvoyé dans la réponse, comme le code SMS simulé.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NETWORKING_ANSWERS_FIXTURE, api, deleteTestUsers, ensureServerRunning, prisma, testPhone } from "./helpers.js";

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];
beforeAll(ensureServerRunning);
afterAll(async () => {
  for (const id of createdEventIds) await prisma.event.delete({ where: { id } }).catch(() => {});
  await deleteTestUsers(createdUserIds);
  await prisma.emailLoginCode.deleteMany({ where: { email: { endsWith: "@test.nourmeet.local" } } });
});

const testEmail = () => `login-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.nourmeet.local`;
async function emailLogin(email: string) {
  const request = await api<{ devCode: string }>("/auth/email/request-code", { method: "POST", body: JSON.stringify({ email }) });
  expect(request.status).toBe(200);
  const verify = await api<{ token: string; isNewUser: boolean; user: { id: string; phone: string | null } }>("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code: request.body.devCode }) });
  expect(verify.status).toBe(200);
  if (!createdUserIds.includes(verify.body.user.id)) createdUserIds.push(verify.body.user.id);
  return verify.body;
}

describe("connexion par e-mail, sans SMS", () => {
  it("crée le compte à la première connexion, le retrouve ensuite, sans numéro de téléphone", async () => {
    const email = testEmail();
    const first = await emailLogin(email.toUpperCase());
    expect(first.isNewUser).toBe(true);
    expect(first.user.phone).toBeNull();
    const second = await emailLogin(email);
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    const me = await api<{ email: string; phoneVerified: boolean }>("/me", {}, second.token);
    expect(me.body.email).toBe(email);
    expect(me.body.phoneVerified).toBe(false);
    // Aucun SMS n'a été mis en file pour ce compte sans numéro.
    expect(await prisma.outboxMessage.count({ where: { channel: "SMS", recipient: email } })).toBe(0);
  });

  it("refuse un mauvais code, bloque après 5 essais et n'accepte jamais deux fois le même code", async () => {
    const email = testEmail();
    const { body } = await api<{ devCode: string }>("/auth/email/request-code", { method: "POST", body: JSON.stringify({ email }) });
    const wrong = body.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await api("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code: wrong }) })).status).toBe(401);
    expect((await api("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code: body.devCode }) })).status).toBe(401);
    const fresh = await api<{ devCode: string }>("/auth/email/request-code", { method: "POST", body: JSON.stringify({ email }) });
    const ok = await api<{ user: { id: string } }>("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code: fresh.body.devCode }) });
    expect(ok.status).toBe(200);
    createdUserIds.push(ok.body.user.id);
    expect((await api("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code: fresh.body.devCode }) })).status).toBe(401);
  });

  it("refuse une connexion Google non vérifiable", async () => {
    const res = await api("/auth/google", { method: "POST", body: JSON.stringify({ credential: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.signature-invalide" }) });
    expect([401, 503]).toContain(res.status);
  });
});

describe("numéro vérifié une seule fois, avant la première réservation", () => {
  it("bloque l'inscription tant que le numéro n'est pas confirmé, puis l'autorise", async () => {
    const event = await prisma.event.create({ data: { slug: `test-login-gate-${Date.now()}`, title: "Test vérification numéro", category: "Networking", flow: "DIRECT", description: "Événement de test pour la vérification du numéro.", startsAt: new Date(Date.now() + 20 * 86_400_000), endsAt: new Date(Date.now() + 20 * 86_400_000 + 3_600_000), district: "Paris", address: "1 rue de test", zone: "Paris intra-muros", capacity: 10, priceCents: 2000, status: "PUBLISHED" } });
    createdEventIds.push(event.id);
    const { token } = await emailLogin(testEmail());
    await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName: "Sans Numéro", city: "Paris", interests: [] }) }, token);
    const blocked = await api<{ error: string; phoneVerificationRequired: boolean }>(`/events/${event.id}/apply`, { method: "POST", body: JSON.stringify({ networkingAnswers: NETWORKING_ANSWERS_FIXTURE }) }, token);
    expect(blocked.status).toBe(403);
    expect(blocked.body.phoneVerificationRequired).toBe(true);
    const phone = testPhone();
    expect((await api("/me/phone/request-code", { method: "POST", body: JSON.stringify({ phone }) }, token)).status).toBe(200);
    expect((await api("/me/phone/verify", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) }, token)).status).toBe(200);
    expect((await api<{ phoneVerified: boolean }>("/me", {}, token)).body.phoneVerified).toBe(true);
    expect((await api(`/events/${event.id}/apply`, { method: "POST", body: JSON.stringify({ networkingAnswers: NETWORKING_ANSWERS_FIXTURE }) }, token)).status).toBe(201);
    // Un même numéro ne peut pas être rattaché à un second compte.
    const other = await emailLogin(testEmail());
    expect((await api("/me/phone/request-code", { method: "POST", body: JSON.stringify({ phone }) }, other.token)).status).toBe(409);
  });

  it("un compte créé par SMS a déjà son numéro vérifié : aucun SMS supplémentaire", async () => {
    const phone = testPhone();
    await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
    const { body } = await api<{ token: string; user: { id: string } }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456" }) });
    createdUserIds.push(body.user.id);
    expect((await api<{ phoneVerified: boolean }>("/me", {}, body.token)).body.phoneVerified).toBe(true);
  });
});
