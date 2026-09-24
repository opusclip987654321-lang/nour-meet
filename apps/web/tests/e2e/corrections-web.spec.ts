import { expect, test } from "@playwright/test";
import { forgetApplication } from "./helpers.js";

// Corrections web du 2026-09-24 : parcours visibles vérifiés dans un vrai navigateur, contre l'API et
// la base du seed (comptes « Parcours participants » et données de démonstration).
const quickLogin = async (page: import("@playwright/test").Page, label: string, url: RegExp) => {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(url);
};

test("page 404 pour une route inconnue, avec retour à l'accueil et aux soirées", async ({ page }) => {
  await page.goto("/cette-page-n-existe-pas");
  await expect(page.getByRole("heading", { name: "Cette page n’existe pas" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.getByRole("link", { name: "Voir les prochaines soirées" }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto("/events/soiree-inexistante-xyz");
  await expect(page.getByRole("heading", { name: "Cette soirée est introuvable" })).toBeVisible();
});

test("catalogue : badge « Liste d’attente » et cloche de notifications menant à l'inscription concernée", async ({ page }) => {
  await quickLogin(page, "Sur liste d’attente, soirées similaires proposées", /dashboard/);
  await page.goto("/events");
  const card = page.locator(".event-card", { hasText: "Dîner networking en petit comité" });
  await expect(card.getByTestId("viewer-status")).toHaveText("Liste d’attente");
  await expect(page.locator(".event-card", { hasText: "Art, thé & conversations" }).getByTestId("viewer-status")).toHaveCount(0);
  // Aucun onglet « Notifications » dans la navigation : une cloche dans l'en-tête.
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toHaveCount(0);
  await page.getByTestId("notification-bell").click();
  await expect(page.getByRole("link", { name: "Voir toutes les notifications" })).toBeVisible();
  await page.locator(".bell-item", { hasText: "Liste d’attente" }).first().click();
  await expect(page).toHaveURL(/tab=reservations&application=/);
  await expect(page.locator(".reservation.focused")).toContainText("Dîner networking en petit comité");
  await expect(page.locator(".reservation.focused")).toContainText("Soirées similaires proposées pour vous");
});

test("catalogue : badge « Participe déjà » pour une place payée", async ({ page }) => {
  await quickLogin(page, "Paiement effectué, participation confirmée", /dashboard/);
  await page.goto("/events");
  await expect(page.locator(".event-card", { hasText: "Soirée Nūr × Maison Amana" }).getByTestId("viewer-status")).toHaveText("Participe déjà");
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await page.locator(".notification", { hasText: "Paiement confirmé" }).click();
  await expect(page).toHaveURL(/tab=tickets&reservation=/);
  await expect(page.locator(".ticket.focused")).toBeVisible();
});

test.describe("événement de démonstration", () => {
  const PHONE = "+33600000042";
  const SLUG = "afterwork-independants-cafe-amel";
  test.beforeAll(() => forgetApplication(PHONE, SLUG));
  test.afterAll(() => forgetApplication(PHONE, SLUG));
  test("le parcours commence mais le paiement est bloqué avec un message clair", async ({ page }) => {
    await quickLogin(page, "Paiement en attente", /dashboard/);
    await page.goto(`/events/${SLUG}`);
    await expect(page.getByText(/d[ée]mo/i)).toHaveCount(0);
    await page.getByRole("button", { name: "S’inscrire" }).click();
    await page.getByRole("button", { name: /Payer par carte/ }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continuer vers le paiement" }).click();
    await expect(page.getByText("Cet événement n’est actuellement pas réservable. Aucun paiement n’a été effectué.")).toBeVisible();
  });
});

test("abonnement restaurateur : cartes de tarifs côte à côte, sans la mention supprimée", async ({ page }) => {
  await quickLogin(page, "Restaurateur approuvé (Maison Amana)", /admin|restaurant/);
  await page.goto("/restaurant?tab=subscription");
  await expect(page.locator(".pricing-card")).toHaveCount(2);
  await expect(page.locator(".pricing-card", { hasText: "Standard" })).toBeVisible();
  await expect(page.locator(".pricing-card", { hasText: "Premium" })).toBeVisible();
  await expect(page.getByText("Mise en avant simple des soirées et de l’établissement")).toHaveCount(0);
  // Aucun onglet Finance pour un restaurateur.
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Finances" })).toHaveCount(0);
  await page.goto("/admin/finance");
  await expect(page).not.toHaveURL(/\/admin\/finance/);
});

test("inscription par e-mail sans SMS, numéro confirmé une seule fois avant la première réservation, puis déconnexion", async ({ page, isMobile }) => {
  const email = `e2e-${Date.now()}@test.nourmeet.local`;
  const phone = `+3361${String(Date.now()).slice(-8)}`;
  try {
    await page.goto("/login");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByRole("button", { name: "Recevoir mon code par e-mail" }).click();
    const emailCode = (await page.locator(".demo-box span").textContent())!.replace(/\D/g, "");
    await page.getByLabel("Code à six chiffres").fill(emailCode);
    await page.getByRole("button", { name: "Vérifier le code" }).click();
    await page.getByRole("button", { name: /Participer aux événements/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("notification-bell")).toBeVisible();
    // Première réservation : la vérification du numéro remplace le bouton d'inscription.
    await page.goto("/events/brunch-networking-independants");
    const verification = page.getByTestId("phone-verification").first();
    await expect(verification).toBeVisible();
    await verification.getByLabel("Numéro de téléphone").fill(phone);
    await verification.getByRole("button", { name: "Recevoir le code" }).click();
    await verification.getByLabel(/Code reçu par SMS/).fill("123456");
    await verification.getByRole("button", { name: "Confirmer mon numéro" }).click();
    await expect(page.getByRole("button", { name: "S’inscrire" }).first()).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await page.getByRole("button", { name: "Se déconnecter" }).first().click();
    await expect(page.getByTestId("notification-bell")).toHaveCount(0);
  } finally {
    const { prisma } = await import("./helpers.js");
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) { await prisma.legalAcceptance.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }).catch(() => {}); }
  }
});
