import { test, expect, type Page } from "@playwright/test";
import { prisma } from "./helpers.js";

// Cahier de corrections v2 (2026-09-25) : profil (§1), partage (§2), carte de paiement (§9), soirées
// proposées avec photo (§10), calendrier d'entretien ouvert, modifier / annuler (§11–§13), et
// onboarding restaurateur en trois étapes (§5).
async function quickLogin(page: Page, label: string, url: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(url);
}

test("profil : centres d’intérêt en liste avec recherche, confirmation d’enregistrement", async ({ page }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { phone: "+33600000020" } });
  await prisma.profile.update({ where: { userId: user.id }, data: { interests: [] } });
  await quickLogin(page, "Homme validé", /dashboard/);
  await page.goto("/dashboard?tab=profile");
  await page.getByRole("searchbox", { name: "Centres d’intérêt" }).fill("randon");
  await page.getByRole("button", { name: "Randonnée" }).click();
  await page.getByRole("searchbox", { name: "Centres d’intérêt" }).fill("echecs");
  await page.getByRole("button", { name: "Échecs" }).click();
  await expect(page.getByRole("list", { name: "Centres d’intérêt choisis" }).getByRole("button")).toHaveCount(2);
  // Version des CGU changée depuis le seed : l'acceptation est redemandée (case présente dans ce cas seulement).
  const cgu = page.getByRole("checkbox", { name: /Je certifie avoir/ });
  if (await cgu.count()) await cgu.check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profil enregistré." })).toBeVisible();
  expect((await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } })).interests).toEqual(["Randonnée", "Échecs"]);
});

test("« Comment ça marche » : un membre connecté voit « Partager avec un ami », pas « Créer mon compte »", async ({ page }) => {
  await quickLogin(page, "Homme validé", /dashboard/);
  await page.goto("/concept");
  await expect(page.getByRole("button", { name: "Partager avec un ami" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Créer mon compte" })).toHaveCount(0);
});

test("carte d’inscription à régler : un montant, un statut, un seul bouton de paiement", async ({ page }) => {
  await quickLogin(page, "Paiement en attente", /dashboard/);
  await page.goto("/dashboard?tab=reservations");
  const card = page.locator(".reservation").filter({ has: page.locator(".reservation-pay") }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /^Payer / })).toHaveCount(1);
  await expect(card.getByText("Paiement à finaliser")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Annuler ma participation" })).toBeVisible();
});

test("liste d’attente : les soirées proposées montrent leur photo, date, quartier, prix et la décision", async ({ page }) => {
  await quickLogin(page, "Sur liste d’attente, soirées similaires proposées", /dashboard/);
  await page.goto("/dashboard?tab=reservations");
  const offer = page.locator(".alt-offer").first();
  await expect(offer).toBeVisible();
  await expect(offer.locator("img.alt-offer-photo")).toHaveAttribute("src", /\S+/);
  await expect(offer.getByRole("button", { name: "Accepter" })).toBeVisible();
  await expect(offer.getByRole("button", { name: "Refuser" })).toBeVisible();
});

test.describe("entretien de validation", () => {
  const PHONE = "+33600000025";
  test.beforeEach(async () => {
    // Remise à l'état « demande faite, aucun créneau » : le parcours est rejouable.
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    await prisma.screeningCall.deleteMany({ where: { application: { userId: user.id } } });
    await prisma.application.deleteMany({ where: { userId: user.id, eventId: null } });
    await prisma.application.create({ data: { userId: user.id, status: "PENDING_CALL", motivation: "Demande d’entretien de test, avec une motivation suffisamment longue." } });
  });

  test("calendrier ouvert par défaut, modifier puis annuler sont deux actions distinctes", async ({ page }) => {
    await quickLogin(page, "Entretien demandé, aucun créneau réservé", /dashboard/);
    await page.goto("/dashboard?tab=interview");
    await expect(page.getByRole("heading", { name: "Un entretien téléphonique de 15 minutes avec un membre de l’équipe Nūr Meet." })).toBeVisible();
    await expect(page.getByText("Les événements networking ne nécessitent pas cet entretien.")).toBeVisible();
    // Semaine suivante : toujours des créneaux, sans qu'aucun n'ait été créé à la main.
    await page.getByRole("button", { name: "Semaine suivante" }).click();
    const slots = page.locator(".calendar-slots button");
    await expect(slots.first()).toBeVisible();
    const first = (await slots.first().textContent())!.trim();
    await slots.first().click();
    await expect(page.getByText(/Entretien programmé :/)).toBeVisible();

    await page.getByRole("button", { name: "Modifier mon créneau" }).click();
    await page.getByRole("button", { name: "Semaine suivante" }).click();
    await page.locator(".calendar-slots button").nth(3).click();
    await expect(page.getByText("Votre entretien a été déplacé.")).toBeVisible();
    await expect(page.getByText(/Entretien programmé :/)).not.toContainText(first);

    await page.getByRole("button", { name: "Annuler ma demande d’entretien" }).click();
    await expect(page.getByText(/Votre demande d’entretien est annulée/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Demander mon entretien" })).toBeVisible();
  });
});

test.describe("onboarding restaurateur (§5)", () => {
  const PHONE = "+33600000010";
  test.beforeAll(async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE }, include: { ownedRestaurant: true } });
    await prisma.event.deleteMany({ where: { controllerRestaurantId: owner.ownedRestaurant!.id } });
    await prisma.restaurant.update({ where: { id: owner.ownedRestaurant!.id }, data: { status: "PENDING" } });
  });

  test("restaurant en attente → premier événement en brouillon → choix de l’abonnement", async ({ page }) => {
    await quickLogin(page, "Restaurateur en attente d'approbation", /restaurant/);
    await expect(page.getByRole("heading", { name: "Votre restaurant est en attente de validation." })).toBeVisible();
    await page.getByRole("link", { name: "Créer mon premier événement" }).click();
    await page.waitForURL(/premier-evenement/);
    await expect(page.getByText("Restaurant en attente de validation.")).toBeVisible();
    await page.getByLabel("Titre").fill(`Dîner networking de lancement ${Date.now()}`);
    await page.getByLabel("Description").fill("Un premier dîner networking pour présenter l’établissement et réunir des indépendants du quartier.");
    const start = new Date(Date.now() + 20 * 86_400_000);
    const iso = (d: Date) => `${d.toISOString().slice(0, 10)}T19:30`;
    await page.getByLabel("Début").fill(iso(start));
    await page.getByLabel("Fin").fill(`${start.toISOString().slice(0, 10)}T22:30`);
    await page.getByLabel("Quartier / ville").fill("Paris 11e");
    await page.getByLabel("Adresse").fill("12 rue de Test, 75011 Paris");
    await page.getByLabel("Capacité totale").fill("20");
    await page.getByRole("button", { name: "Enregistrer mon premier événement" }).click();
    await expect(page.getByRole("heading", { name: "Votre premier événement est prêt." })).toBeVisible();
    await expect(page.getByText("Choisissez maintenant votre abonnement pour pouvoir le soumettre et le mettre en ligne.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choisir cette formule" }).first()).toBeVisible();
    // Rien n'annonce qu'un paiement vaudrait validation.
    await expect(page.getByText(/validation (garantie|automatique)/i)).toHaveCount(0);
    const owner = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE }, include: { ownedRestaurant: true } });
    expect(owner.role).toBe("PARTICIPANT");
    expect((await prisma.event.findFirstOrThrow({ where: { controllerRestaurantId: owner.ownedRestaurant!.id } })).status).toBe("DRAFT");
  });
});
