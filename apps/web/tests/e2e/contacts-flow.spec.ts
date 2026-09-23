import { test, expect, type Page } from "@playwright/test";
import { forgetContacts } from "./helpers.js";

// Mise en relation après une soirée, entièrement depuis le site : code personnel, demande,
// acceptation, message, puis signalement qui ferme la conversation.
const HOMME = "+33600000020";
const FEMME = "+33600000022";
test.beforeAll(() => forgetContacts(HOMME, FEMME));
test.afterAll(() => forgetContacts(HOMME, FEMME));

async function loginAs(page: Page, label: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL("**/dashboard");
}

test("code personnel, demande, acceptation, message puis signalement", async ({ browser }) => {
  const femme = await (await browser.newContext()).newPage();
  const homme = await (await browser.newContext()).newPage();

  await loginAs(femme, "Femme validée");
  await femme.goto("/dashboard?tab=contacts");
  const code = (await femme.locator(".contact-code-value").textContent())!.trim();
  expect(code.length).toBeGreaterThan(5);

  await loginAs(homme, "Homme validé");
  await homme.goto("/dashboard?tab=contacts");
  await homme.getByLabel("Code personnel de la personne").fill(code);
  await homme.getByRole("button", { name: "Rechercher" }).click();
  await homme.getByRole("button", { name: "Envoyer une demande de contact" }).click();
  await expect(homme.getByText(/Demande envoyée/)).toBeVisible();

  await femme.reload();
  await femme.getByRole("button", { name: "Accepter" }).click();
  await femme.getByRole("button", { name: /Homme Validé/ }).click();
  await femme.getByLabel("Votre message").fill("Ravie de vous avoir rencontré !");
  await femme.getByRole("button", { name: "Envoyer" }).click();
  await expect(femme.locator(".bubble.mine", { hasText: "Ravie de vous avoir rencontré" })).toBeVisible();

  await homme.reload();
  await homme.getByRole("button", { name: /Femme Validée/ }).click();
  await expect(homme.locator(".bubble", { hasText: "Ravie de vous avoir rencontré" })).toBeVisible();

  await femme.goto("/dashboard?tab=report");
  await femme.getByLabel("Personne concernée").selectOption({ label: "Homme Validé" });
  await femme.getByLabel("Motif").selectOption("Propos ou contenus déplacés");
  await femme.getByRole("button", { name: "Envoyer le signalement" }).click();
  await expect(femme.getByText(/transmis à l’équipe de modération/)).toBeVisible();

  await homme.goto("/dashboard?tab=contacts");
  await homme.getByRole("button", { name: /Femme Validée/ }).click();
  await expect(homme.getByText("Cette conversation est fermée.")).toBeVisible();
});
