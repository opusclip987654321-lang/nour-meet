// Utilitaires partagés par les tests d'intégration : ceux-ci s'exécutent contre le vrai serveur de
// développement (docker compose up), pas contre une instance en mémoire — ils vérifient donc le
// comportement réel de bout en bout, exactement comme les vérifications manuelles faites pendant le
// développement, mais de façon répétable et automatisée.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";
// Ces tests tournent sur l'hôte (pas dans le réseau Docker) : "postgres" n'y est pas résolvable, on
// passe donc par le port exposé sur localhost avec les identifiants de développement (non secrets,
// déjà visibles dans docker-compose.yml).
process.env.DATABASE_URL ??= "postgresql://nour:nour_dev_password@localhost:5434/nour_meet?schema=public";
export const prisma = new PrismaClient();

export async function api<T = any>(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; body: T }> {
  const isJsonBody = typeof init.body === "string";
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(isJsonBody ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) }
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as T };
}

export async function ensureServerRunning() {
  try {
    const { status } = await api("/health");
    if (status !== 200) throw new Error();
  } catch {
    throw new Error("Le serveur de développement doit être lancé (docker compose up) avant d’exécuter les tests d’intégration.");
  }
}

let seq = 0;
export function testPhone() {
  seq++;
  const suffix = (Date.now() % 100_000_000).toString().padStart(8, "0");
  return `+3369${suffix}${seq}`.slice(0, 15);
}

async function loginOrRegister(phone: string, displayName?: string) {
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  return body.token;
}

export const adminToken = () => loginOrRegister("+33600000001");
export const organizerToken = () => loginOrRegister("+33600000002");

// Crée un participant, complète son profil, passe et fait accepter son entretien global — reproduit
// le seul chemin réel pour obtenir un profil validé (voir Phase 2 : aucun raccourci de test).
export async function makeValidatedParticipant(displayName = "TestUser", quotaCategory?: "HOMME" | "FEMME") {
  const phone = testPhone();
  const token = await loginOrRegister(phone, displayName);
  await api("/me/profile", { method: "PATCH", body: JSON.stringify({ displayName, city: "Paris", interests: [], quotaCategory: quotaCategory ?? null }) }, token);
  const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire soumis." }) }, token);
  const admin = await adminToken();
  await api(`/admin/global-interviews/${interview.id}/decision`, { method: "POST", body: JSON.stringify({ accept: true }) }, admin);
  const { body: me } = await api<{ id: string }>("/me", {}, token);
  return { token, userId: me.id, phone };
}

// Nettoyage : supprime les comptes de test créés pendant un test (cascade Prisma sur toutes leurs
// données), jamais les comptes de démonstration réels (Walid, Maison Amana, Sofia, Karim).
export async function deleteTestUsers(userIds: string[]) {
  for (const id of userIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
}

export function signStripeWebhook(payload: string): { header: string } {
  const envPath = path.resolve(process.cwd(), "..", "..", ".env");
  const raw = readFileSync(envPath, "utf8");
  const match = raw.match(/^STRIPE_WEBHOOK_SECRET=(.+)$/m);
  if (!match) throw new Error("STRIPE_WEBHOOK_SECRET introuvable dans .env : requis pour les tests de paiement.");
  const secret = match[1].trim();
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return { header: `t=${ts},v1=${signature}` };
}
