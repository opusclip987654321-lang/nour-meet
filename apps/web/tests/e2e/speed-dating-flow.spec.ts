import { test, expect } from "@playwright/test";
import { forgetApplication } from "./helpers.js";

const PHONE = "+33600000022";
const EVENT_SLUG = "diner-connexions-septembre";

// §21 : parcours complet speed dating (sélection). Utilise la persona de test partagée "Femme
// validée" (déjà acceptée à l'entretien global) : la candidature créée ici est annulée en fin de
// test pour que la persona reste disponible, pristine, pour les prochains tests manuels ou
// automatisés — même convention que le reste du dépôt.
test.beforeAll(() => forgetApplication(PHONE, EVENT_SLUG));
test.afterAll(() => forgetApplication(PHONE, EVENT_SLUG));

test("parcours speed dating : badge de sélection, questionnaire, paiement proposé, puis annulation", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Femme validée" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto(`/events/${EVENT_SLUG}`);
  await expect(page.locator(".category-badge", { hasText: "SPEED DATING" })).toBeVisible();
  await expect(page.locator(".flow-badge", { hasText: "Sur sélection" })).toBeVisible();

  await page.getByRole("button", { name: "Candidater" }).click();
  for (const label of [
    "Qu’est-ce qui vous motive à participer à cette rencontre ?",
    "Quel type de relation recherchez-vous et dans quelle perspective ?",
    "Comment décririez-vous votre personnalité ?",
    "Quelles qualités recherchez-vous chez l’autre ?",
    "Quelle tranche d’âge recherchez-vous ?",
    "Quelles valeurs ou habitudes de vie souhaitez-vous partager ?"
  ]) {
    await page.getByLabel(label).fill("Réponse de test end-to-end, suffisamment longue pour être valide.");
  }
  await page.getByRole("button", { name: "Envoyer ma candidature" }).click();

  await expect(page.getByRole("button", { name: /Payer par carte/ })).toBeVisible();

  await page.getByRole("button", { name: "Annuler mon inscription" }).click();
  await expect(page.getByRole("button", { name: /Payer par carte/ })).not.toBeVisible();
  await expect(page.getByText("Statut :")).toContainText("Annulée");
});
