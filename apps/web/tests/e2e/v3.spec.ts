import { test, expect, type Page } from "@playwright/test";
import { prisma } from "./helpers.js";

// Cahier de corrections web v3 (2026-09-26).
async function quickLogin(page: Page, label: string, url: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(url);
}
// Retire l'inscription et l'entrée de liste d'attente d'une personne sur un événement.
async function forgetApplication(phone: string, slug: string) {
  const [user, event] = await Promise.all([prisma.user.findUnique({ where: { phone } }), prisma.event.findUnique({ where: { slug } })]);
  if (!user || !event) return;
  await prisma.waitlistEntry.deleteMany({ where: { userId: user.id, eventId: event.id } });
  await prisma.application.deleteMany({ where: { userId: user.id, eventId: event.id } });
}

test.describe("événement complet (v3 §4.2)", () => {
  const PHONE = "+33600000022";
  const SLUG = "diner-networking-complet";
  test.beforeEach(() => forgetApplication(PHONE, SLUG));
  test.afterAll(() => forgetApplication(PHONE, SLUG));
  test("« Rejoindre la liste d’attente » inscrit en un clic, sans aucun bouton de paiement", async ({ page }) => {
    await quickLogin(page, "Femme validée", /dashboard/);
    await page.goto(`/events/${SLUG}`);
    const booking = page.locator("#reserver");
    await expect(booking.getByRole("button", { name: "S’inscrire" })).toHaveCount(0);
    await booking.getByRole("button", { name: "Rejoindre la liste d’attente" }).click();
    await expect(booking.getByText("Statut : Liste d’attente")).toBeVisible();
    await expect(booking.getByText(/Aucun paiement n’est demandé/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Payer par carte|Confirmer ma place/ })).toHaveCount(0);
  });
});
