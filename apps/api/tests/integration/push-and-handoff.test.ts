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
