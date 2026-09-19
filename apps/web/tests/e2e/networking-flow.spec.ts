import { test, expect } from "@playwright/test";
import { forgetApplication } from "./helpers.js";

const PHONE = "+33600000021";
const EVENT_SLUG = "afterwork-entrepreneurs-octobre";

// §21 : parcours complet networking (accès direct, aucune validation de profil requise). Persona
// de test partagée "Homme non validé" — voir speed-dating-flow.spec.ts pour l'explication du
// nettoyage direct en base.
test.beforeAll(() => forgetApplication(PHONE, EVENT_SLUG));
test.afterAll(() => forgetApplication(PHONE, EVENT_SLUG));

test("parcours networking : accès direct sans validation, questionnaire, puis paiement proposé", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Homme non validé" }).click();
  await page.waitForURL("**/dashboard");

  await page.goto(`/events/${EVENT_SLUG}`);
  await expect(page.locator(".category-badge", { hasText: "NETWORKING" })).toBeVisible();
  await expect(page.getByText("● Accès direct")).toBeVisible();

  await page.getByRole("button", { name: "S’inscrire" }).click();
  for (const label of [
    "Dans quel secteur professionnel évoluez-vous ?",
    "Quelle est votre activité ou fonction actuelle ?",
    "Quel est votre niveau ou nombre d’années d’expérience ?",
    "Quel est votre objectif : associés, clients, emploi, réseau ou autre ?",
    "Quels profils souhaitez-vous rencontrer ?",
    "Que pouvez-vous apporter aux autres participants ?",
    "Sur quels projets ou opportunités souhaitez-vous échanger ?"
  ]) {
    await page.getByLabel(label).fill("Réponse de test end-to-end, suffisamment longue pour être valide.");
  }
  await page.getByRole("button", { name: "Envoyer ma candidature" }).click();

  await expect(page.getByRole("button", { name: /Payer par carte/ })).toBeVisible();

  await page.getByRole("button", { name: "Annuler mon inscription" }).click();
  await expect(page.getByRole("button", { name: /Payer par carte/ })).not.toBeVisible();
  await expect(page.getByText("Statut :")).toContainText("Annulée");
});
