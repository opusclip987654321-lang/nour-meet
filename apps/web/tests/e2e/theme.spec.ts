import { expect, test } from "@playwright/test";

// Mode sombre (2026-09-25) : bouton visible dans l'en-tête, choix mémorisé d'une visite à l'autre.
test("le bouton de l'en-tête bascule en mode sombre et le choix est gardé au rechargement", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Activer le mode sombre" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Activer le mode clair" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("l'accueil explique l'entretien et l'échange de codes, illustrations IA signalées", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "L’entretien de validation, en clair" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sur place, échangez vos codes/ })).toBeVisible();
  await expect(page.getByText("Illustration générée par IA").first()).toBeVisible();
});
