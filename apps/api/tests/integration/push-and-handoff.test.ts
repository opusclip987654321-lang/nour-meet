// Application mobile (2026-09-24) : enregistrement des appareils pour les notifications push et
// connexion Google par code de retour protégé par PKCE, contre le vrai serveur.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, deleteTestUsers, ensureServerRunning, prisma } from "./helpers.js";

const createdUserIds: string[] = [];
beforeAll(ensureServerRunning);
afterAll(async () => {
  await prisma.pushToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await deleteTestUsers(createdUserIds);
  await prisma.emailLoginCode.deleteMany({ where: { email: { endsWith: "@test.nourmeet.local" } } });
});

async function newUser() {
  const email = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.nourmeet.local`;
  const request = await api<{ devCode: string }>("/auth/email/request-code", { method: "POST", body: JSON.stringify({ email }) });
  const verify = await api<{ token: string; user: { id: string } }>("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code: request.body.devCode }) });
  createdUserIds.push(verify.body.user.id);
  return verify.body;
}
const pushToken = () => `ExponentPushToken[test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}]`;

describe("appareils enregistrés pour les notifications push", () => {
  it("enregistre, réattribue à un autre compte, puis retire le jeton de l'appareil", async () => {
    const a = await newUser(), b = await newUser(), token = pushToken();
    expect((await api("/me/push-tokens", { method: "POST", body: JSON.stringify({ token, platform: "ios" }) }, a.token)).status).toBe(204);
    expect((await prisma.pushToken.findUnique({ where: { token } }))?.userId).toBe(a.user.id);
    // Même téléphone, autre compte : le jeton suit le compte connecté, jamais les deux.
    expect((await api("/me/push-tokens", { method: "POST", body: JSON.stringify({ token, platform: "ios" }) }, b.token)).status).toBe(204);
    expect(await prisma.pushToken.count({ where: { token } })).toBe(1);
    expect((await prisma.pushToken.findUnique({ where: { token } }))?.userId).toBe(b.user.id);
    // L'ancien compte ne peut pas retirer un appareil qui n'est plus le sien.
    await api("/me/push-tokens", { method: "DELETE", body: JSON.stringify({ token }) }, a.token);
    expect(await prisma.pushToken.count({ where: { token } })).toBe(1);
    expect((await api("/me/push-tokens", { method: "DELETE", body: JSON.stringify({ token }) }, b.token)).status).toBe(204);
    expect(await prisma.pushToken.count({ where: { token } })).toBe(0);
  });
  it("refuse un jeton qui n'est pas un jeton Expo", async () => {
    const a = await newUser();
    expect((await api("/me/push-tokens", { method: "POST", body: JSON.stringify({ token: "https://pirate.example", platform: "android" }) }, a.token)).status).toBe(400);
  });
  it("l'anonymisation du compte retire ses appareils", async () => {
    const a = await newUser(), token = pushToken();
    await api("/me/push-tokens", { method: "POST", body: JSON.stringify({ token, platform: "android" }) }, a.token);
    expect((await api("/me/request-deletion", { method: "POST" }, a.token)).status).toBe(200);
    expect(await prisma.pushToken.count({ where: { token } })).toBe(0);
  });
});

describe("connexion Google de l'application (code de retour + PKCE)", () => {
  const verifier = "v".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url");
  it("échange le code une seule fois, et seulement avec le bon secret", async () => {
    const a = await newUser();
    const handoff = await api<{ redirectUrl: string }>("/auth/mobile-handoff", { method: "POST", body: JSON.stringify({ redirect: "nourmeet://auth", challenge }) }, a.token);
    expect(handoff.status).toBe(200);
    const code = new URL(handoff.body.redirectUrl).searchParams.get("code")!;
    expect((await api("/auth/mobile-handoff/exchange", { method: "POST", body: JSON.stringify({ code, verifier: "w".repeat(43) }) })).status).toBe(401);
    const ok = await api<{ token: string; user: { id: string } }>("/auth/mobile-handoff/exchange", { method: "POST", body: JSON.stringify({ code, verifier }) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(a.user.id);
    expect((await api("/auth/mobile-handoff/exchange", { method: "POST", body: JSON.stringify({ code, verifier }) })).status).toBe(401);
  });
  it("refuse un retour vers une adresse web", async () => {
    const a = await newUser();
    expect((await api("/auth/mobile-handoff", { method: "POST", body: JSON.stringify({ redirect: "https://pirate.example/", challenge }) }, a.token)).status).toBe(400);
  });
});

describe("adresse e-mail saisie dans un profil sans vérification", () => {
  it("ne permet jamais de récupérer la connexion de la vraie propriétaire de l'adresse", async () => {
    const attacker = await newUser();
    const victimEmail = `victime-${Date.now()}@test.nourmeet.local`;
    const patch = await api("/me/profile", { method: "PATCH", body: JSON.stringify({ email: victimEmail }) }, attacker.token);
    expect([200, 400]).toContain(patch.status);
    if (patch.status === 200) expect((await prisma.user.findUnique({ where: { id: attacker.user.id } }))?.emailVerifiedAt).toBeNull();
    // La vraie propriétaire se connecte avec un code reçu à son adresse.
    const request = await api<{ devCode: string }>("/auth/email/request-code", { method: "POST", body: JSON.stringify({ email: victimEmail }) });
    const login = await api<{ token: string; isNewUser: boolean; user: { id: string } }>("/auth/email/verify", { method: "POST", body: JSON.stringify({ email: victimEmail, code: request.body.devCode }) });
    expect(login.status).toBe(200);
    createdUserIds.push(login.body.user.id);
    expect(login.body.user.id).not.toBe(attacker.user.id);
    expect(login.body.isNewUser).toBe(true);
    // L'adresse n'appartient plus au compte qui l'avait simplement saisie.
    expect((await prisma.user.findUnique({ where: { id: attacker.user.id } }))?.email).not.toBe(victimEmail);
  });
});

describe("jeton de paiement de la page /pay (15 min)", () => {
  it("ne sert qu'au paiement de l'inscription pour laquelle il a été émis", async () => {
    const user = await newUser();
    const event = await prisma.event.findFirstOrThrow({ where: { status: "PUBLISHED", startsAt: { gt: new Date() } } });
    const other = await prisma.event.findFirstOrThrow({ where: { status: "PUBLISHED", startsAt: { gt: new Date() }, id: { not: event.id } } });
    const application = await prisma.application.create({ data: { eventId: event.id, userId: user.user.id, status: "PAYMENT_PENDING" } });
    const otherApplication = await prisma.application.create({ data: { eventId: other.id, userId: user.user.id, status: "PAYMENT_PENDING" } });
    const session = await api<{ token: string }>("/me/payment-sessions", { method: "POST", body: JSON.stringify({ applicationId: application.id }) }, user.token);
    const exchanged = await api<{ token: string }>("/auth/payment-session-exchange", { method: "POST", body: JSON.stringify({ token: session.body.token }) });
    const paymentToken = exchanged.body.token;

    expect((await api(`/me/applications/${application.id}/amount`, {}, paymentToken)).status).toBe(200);
    expect((await api(`/events/${event.id}/my-application`, {}, paymentToken)).status).toBe(200);
    // Une autre inscription, le profil, la session glissante ou une connexion mobile : refusés.
    expect((await api(`/me/applications/${otherApplication.id}/amount`, {}, paymentToken)).status).toBe(403);
    // Ni paiement d'une autre inscription, ni lecture de sa candidature à une autre soirée.
    expect((await api(`/applications/${otherApplication.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) }, paymentToken)).status).toBe(403);
    expect((await api(`/events/${other.id}/my-application`, {}, paymentToken)).status).toBe(403);
    expect((await api("/me", {}, paymentToken)).status).toBe(403);
    expect((await api("/me/applications", {}, paymentToken)).status).toBe(403);
    expect((await api("/auth/mobile-handoff", { method: "POST", body: JSON.stringify({ redirect: "nourmeet://auth", challenge: "a".repeat(43) }) }, paymentToken)).status).toBe(403);
    // Moindre privilège : ni messagerie, ni billets, ni profil, ni administration, ni notifications.
    for (const [method, path] of [["GET", "/conversations"], ["GET", "/me/tickets"], ["GET", "/me/contact-requests"], ["GET", "/me/share-qr"], ["PATCH", "/me/profile"], ["GET", "/notifications"], ["GET", "/admin/settings"], ["GET", "/restaurants/me"], ["POST", `/me/applications/${application.id}/cancel`]] as const) {
      expect((await api(path, { method, ...(method === "GET" ? {} : { body: "{}" }) }, paymentToken)).status, `${method} ${path}`).toBe(403);
    }
    // Aucun effet de bord : l'inscription n'a pas été annulée par la tentative ci-dessus.
    expect((await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("PAYMENT_PENDING");
    // Le jeton de session normal, lui, garde tous ses droits.
    expect((await api("/me", {}, user.token)).status).toBe(200);
  });
});
