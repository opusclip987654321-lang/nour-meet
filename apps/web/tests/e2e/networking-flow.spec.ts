import { test, expect } from "@playwright/test";
import { forgetApplication } from "./helpers.js";

const PHONE = "+33600000021";
const EVENT_SLUG = "afterwork-entrepreneurs-octobre";

// §21 : parcours complet networking (accès direct, aucune validation de profil requise). Persona
// de test partagée "Homme non validé" — voir speed-dating-flow.spec.ts pour l'explication du
// nettoyage direct en base.
test.beforeAll(() => forgetApplication(PHONE, EVENT_SLUG));
test.afterAll(() => forgetApplication(PHONE, EVENT_SLUG));

test("parcours networking : accès direct sans validation ni questionnaire, puis paiement proposé", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Homme non validé" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto(`/events/${EVENT_SLUG}`);
  await expect(page.locator(".category-badge", { hasText: "NETWORKING" })).toBeVisible();
  await expect(page.getByText("● Accès direct")).toBeVisible();

  // Arbitrage 12/E3 : aucun questionnaire à l'inscription networking — il n'est proposé, facultatif,
  // qu'une fois la place confirmée ; « S’inscrire » mène donc directement au paiement.
  await page.getByRole("button", { name: "S’inscrire" }).click();

  await expect(page.getByRole("button", { name: /Payer par carte/ })).toBeVisible();

  await page.getByRole("button", { name: "Annuler mon inscription" }).click();
  await expect(page.getByRole("button", { name: /Payer par carte/ })).not.toBeVisible();
  await expect(page.getByText("Statut :")).toContainText("Annulée");
});
