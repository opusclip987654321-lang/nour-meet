import { test, expect, type Page } from "@playwright/test";
import { forgetContacts, forgetSharedEvent, prisma, shareAnEvent } from "./helpers.js";

// Mise en relation (décision v2 §3) : sur le site, l'onglet Contacts n'est plus qu'informatif — code
// personnel et explication. Demandes et conversations se font dans l'application mobile (parcours
// testé dans apps/mobile/e2e). Le signalement d'une personne rencontrée reste possible depuis le site.
const HOMME = "+33600000020";
const FEMME = "+33600000022";
test.beforeAll(async () => { await forgetContacts(HOMME, FEMME); await shareAnEvent(HOMME, FEMME); });
test.afterAll(async () => { await forgetContacts(HOMME, FEMME); await forgetSharedEvent(); });

async function loginAs(page: Page, label: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL("**/dashboard");
}

test("l’onglet Contacts explique l’application et montre le code, sans aucune messagerie sur le site", async ({ page }) => {
  await loginAs(page, "Femme validée");
  await page.goto("/dashboard?tab=contacts");
  await expect(page.getByRole("heading", { name: /se passent dans l’application/ })).toBeVisible();
  const code = (await page.locator(".contact-code-value").textContent())!.trim();
  expect(code.length).toBeGreaterThan(5);
  await expect(page.getByRole("img", { name: /QR code de votre code personnel/ })).toBeVisible();
  // Aucune recherche de code, aucune demande, aucune conversation sur le web.
  await expect(page.getByLabel("Code personnel de la personne")).toHaveCount(0);
  await expect(page.getByLabel("Votre message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Envoyer une demande de contact" })).toHaveCount(0);
  // L'application n'est pas publiée : le lien ne doit pas laisser croire qu'elle est téléchargeable.
  await expect(page.getByText("Elle n’est pas encore téléchargeable.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Télécharger/ })).toHaveCount(0);
});

test("une personne rencontrée (contact accepté dans l’application) peut être signalée depuis le site", async ({ page }) => {
  const [homme, femme] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { phone: HOMME } }), prisma.user.findUniqueOrThrow({ where: { phone: FEMME } })]);
  await prisma.contactRequest.create({ data: { requesterId: homme.id, recipientId: femme.id, status: "ACCEPTED" } });
  await loginAs(page, "Femme validée");
  await page.goto("/dashboard?tab=report");
  await page.getByLabel("Personne concernée").selectOption({ label: "Homme Validé" });
  await page.getByLabel("Motif").selectOption("Propos ou contenus déplacés");
  await page.getByRole("button", { name: "Envoyer le signalement" }).click();
  await expect(page.getByText(/transmis à l’équipe de modération/)).toBeVisible();
});
