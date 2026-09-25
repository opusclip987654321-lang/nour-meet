import { expect, test, type Page } from "@playwright/test";
import { prisma } from "./helpers.js";

// Décisions du 2026-09-25 : espaces restaurateur et administration séparés, abonnement consulté en
// lecture seule par l'administration, et non-régression de la page de paiement ouverte depuis
// l'application mobile (jeton de paiement restreint aux seules routes du paiement).
const API = process.env.API_URL ?? "http://localhost:4000";

async function quickLogin(page: Page, label: string, url: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(url);
}
async function tokenFor(phone: string) {
  const json = { "Content-Type": "application/json" };
  await fetch(`${API}/auth/request-otp`, { method: "POST", headers: json, body: JSON.stringify({ phone }) });
  return (await (await fetch(`${API}/auth/verify-otp`, { method: "POST", headers: json, body: JSON.stringify({ phone, code: "123456" }) })).json()).token as string;
}

test("restaurateur : son espace sous /restaurant, jamais l'administration", async ({ page }) => {
  await quickLogin(page, "Restaurateur approuvé (Maison Amana)", /\/restaurant\/tableau-de-bord/);
  const nav = page.getByRole("complementary", { name: "Espace restaurateur" });
  // Sur mobile la barre est repliée : on vérifie la présence des liens, pas leur visibilité.
  await expect(nav.locator("a", { hasText: "Mes soirées" })).toHaveCount(1);
  await expect(nav.locator("a", { hasText: "Abonnement" })).toHaveCount(1);
  await expect(page.locator("a", { hasText: "Paramètres" })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/restaurant\/tableau-de-bord/);
  // Ancien lien de notification vers /admin : même section, dans son espace.
  await page.goto("/admin/events?highlight=abc");
  await expect(page).toHaveURL(/\/restaurant\/soirees\?highlight=abc/);
  await page.goto("/restaurant?tab=subscription");
  await expect(page.getByRole("group", { name: "Périodicité de facturation" })).toBeVisible();
});

test("administration : pages principales intactes, abonnement d'un restaurateur en lecture seule", async ({ page }) => {
  await quickLogin(page, "Administrateur (Walid)", /\/admin$/);
  await page.goto("/admin/settings");
  await expect(page.getByText("RESTAURANT_TRIAL_DAYS")).toBeVisible();
  await page.goto("/admin/restaurants");
  await page.locator(".filters select").first().selectOption("APPROVED");
  const card = page.locator(".panel", { hasText: "Maison Amana" }).first();
  await card.getByRole("button", { name: "consulter" }).click();
  await expect(page.getByText("Consultation seule : le restaurateur gère son abonnement depuis son espace.")).toBeVisible();
  // Aucune commande de modification dans l'encart d'abonnement (ni liste de formules, ni bouton).
  await expect(page.locator(".admin-subscription select, .admin-subscription button")).toHaveCount(0);
  await expect(page.locator("a", { hasText: "Mes soirées" })).toHaveCount(0);
});

test("paiement ouvert depuis l'application mobile : montant du serveur, paiement préparé", async ({ page }) => {
  const token = await tokenFor("+33600000042");
  const applications = await (await fetch(`${API}/me/applications`, { headers: { Authorization: `Bearer ${token}` } })).json() as { id: string; status: string; amountCents: number; event: { title: string } }[];
  // Soirée réelle du seed (jamais une démonstration, dont le paiement est volontairement refusé).
  const application = applications.find(a => a.status === "PAYMENT_PENDING" && a.event.title === "Art, thé & conversations")!;
  const session = await (await fetch(`${API}/me/payment-sessions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ applicationId: application.id }) })).json() as { token: string };
  await page.goto(`/pay/${application.id}?session=${session.token}`);
  const amount = (application.amountCents / 100).toFixed(2).replace(".", ",");
  await expect(page.locator(".payment-amount")).toContainText(amount);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continuer vers le paiement" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Payer ${amount}`) })).toBeVisible();
  const reservation = await prisma.reservation.findFirst({ where: { applicationId: application.id } });
  expect(reservation).not.toBeNull();
  // Place rendue tout de suite : aucun verrou de test ne doit gêner les autres parcours.
  await prisma.payment.deleteMany({ where: { reservationId: reservation!.id } });
  await prisma.reservation.delete({ where: { id: reservation!.id } });
});
