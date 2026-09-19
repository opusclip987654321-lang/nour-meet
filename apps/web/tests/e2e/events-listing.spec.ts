import { test, expect } from "@playwright/test";

// §21 : états de chargement, vide et succès sur la page événements, et filtre par catégorie —
// contre le vrai serveur de développement (docker compose up + seed requis, comme les tests API).
test.describe("liste des événements", () => {
  test("affiche les événements avec un badge de catégorie distinct par type", async ({ page }) => {
    await page.goto("/events");
    await expect(page.locator(".event-card").first()).toBeVisible();
    await expect(page.locator(".category-badge", { hasText: "SPEED DATING" }).first()).toBeVisible();
    await expect(page.locator(".category-badge", { hasText: "NETWORKING" }).first()).toBeVisible();
  });

  test("filtre la liste par catégorie", async ({ page }) => {
    await page.goto("/events");
    await expect(page.locator(".event-card").first()).toBeVisible();

    await page.getByRole("combobox").selectOption("Speed dating");
    await expect(page.locator(".category-badge", { hasText: "SPEED DATING" }).first()).toBeVisible();
    await expect(page.locator(".category-badge", { hasText: "NETWORKING" })).toHaveCount(0);

    await page.getByRole("combobox").selectOption("");
    await expect(page.locator(".event-card").first()).toBeVisible();
  });

  test("affiche un état vide explicite quand aucun événement ne correspond à la recherche", async ({ page }) => {
    await page.goto("/events");
    await page.getByPlaceholder("Rechercher un événement").fill("zzzzz-aucun-resultat-possible-zzzzz");
    await expect(page.getByText("Aucun événement disponible")).toBeVisible();
  });
});
