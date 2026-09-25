import { devices, expect, test, type Page } from "@playwright/test";
// Préparation en base partagée avec les e2e du site (soirée commune, remise à zéro des contacts).
import { forgetContacts, forgetSharedEvent, shareAnEvent } from "../../web/tests/e2e/helpers.js";

// Comptes de démonstration du seed (connexion SMS simulée, code 123456).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const PARTICIPANT = "+33600000020", RESTAURATEUR = "+33600000002";

async function tokenFor(phone: string) {
  await fetch(`${API_URL}/auth/request-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
  const res = await fetch(`${API_URL}/auth/verify-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code: "123456" }) });
  return (await res.json()).token as string;
}
async function openAs(page: Page, phone: string) {
  const token = await tokenFor(phone);
  await page.goto("/");
  await page.evaluate(t => localStorage.setItem("nour_token", t), token);
  await page.reload();
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name }).click();

test("écran de connexion : Google et e-mail, SMS seulement pour les anciens comptes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Continuer avec Google")).toBeVisible();
  await expect(page.getByText("Recevoir mon code par e-mail")).toBeVisible();
  await expect(page.getByText(/Connexion par SMS/)).toBeVisible();
});

test("participant : accueil, soirées, espace, notifications, messages et scanner", async ({ page }) => {
  await openAs(page, PARTICIPANT);
  await expect(page.getByText("Prochaines soirées", { exact: true })).toBeVisible();
  await tab(page, "Soirées");
  await expect(page.getByText("Les prochaines soirées")).toBeVisible();
  await expect(page.getByText(/soirées? à venir/)).toBeVisible();
  await tab(page, "Mon espace");
  await expect(page.getByText("Mes événements")).toBeVisible();
  await page.getByText("Profil", { exact: true }).click();
  await expect(page.getByText("Mon profil")).toBeVisible();
  await page.getByTestId("notification-bell").click();
  await expect(page.getByText(/Aucune notification|Tout marquer comme lu|non lue/).first()).toBeVisible();
  await tab(page, "Messages");
  await expect(page.getByText("Messages", { exact: true }).first()).toBeVisible();
  await tab(page, "Scanner");
  await expect(page.getByText("Revoir quelqu’un")).toBeVisible();
});

test("billets hors connexion : l'application s'ouvre sans réseau et affiche les billets enregistrés", async ({ page }) => {
  await openAs(page, PARTICIPANT);
  await tab(page, "Mon espace");
  await page.getByText("Billets", { exact: true }).click();
  await expect(page.getByText(/Mes? billets?|Aucun billet/).first()).toBeVisible();
  // Coupure du réseau vers l'API, puis redémarrage de l'application.
  await page.route(`${API_URL}/**`, route => route.abort("internetdisconnected"));
  await page.reload();
  await tab(page, "Mon espace");
  await page.getByText("Billets", { exact: true }).click();
  await expect(page.getByText(/Hors connexion : billets enregistrés/)).toBeVisible();
});

test("restaurateur : soirées, création d'un brouillon et cartes d'abonnement", async ({ page }) => {
  await openAs(page, RESTAURATEUR);
  await tab(page, "Établissement");
  await page.getByText("Mes soirées", { exact: true }).click();
  await expect(page.getByText("Créer une soirée")).toBeVisible();
  await page.getByText("Créer une soirée").click();
  await expect(page.getByText("Créer le brouillon")).toBeVisible();
  await page.getByText("Créer le brouillon").click();
  await expect(page.getByText(/Renseignez le titre/)).toBeVisible();
  await page.getByText("Mes soirées", { exact: true }).first().click();
  await page.getByText("Abonnement", { exact: true }).click();
  await expect(page.getByText(/HT \/ (mois|an)/).first()).toBeVisible();
});

test("restaurateur : crée un brouillon complet depuis l'application puis le soumet à validation", async ({ page }) => {
  const title = `Soirée test mobile ${Date.now()}`;
  await openAs(page, RESTAURATEUR);
  await tab(page, "Établissement");
  await page.getByText("Mes soirées", { exact: true }).click();
  await page.getByText("Créer une soirée").click();
  await page.getByLabel("Titre").fill(title);
  await page.getByLabel("Description").first().fill("Une soirée de test créée depuis l’application mobile, pour vérifier le formulaire.");
  const inputs = page.getByPlaceholder("AAAA-MM-JJ HH:MM");
  await inputs.nth(0).fill("2027-03-12 19:30");
  await inputs.nth(1).fill("2027-03-12 22:30");
  await page.getByLabel("Quartier / ville").fill("Paris 11e");
  await page.getByLabel("Adresse").fill("12 rue de test, 75011 Paris");
  await page.getByText("Créer le brouillon").click();
  await expect(page.getByText(title)).toBeVisible();
  await page.getByText(title).click();
  await expect(page.getByText("Brouillon", { exact: true })).toBeVisible();
  await page.getByText("Soumettre à validation").click();
  await expect(page.getByText("Soirée soumise à validation.")).toBeVisible();
  await expect(page.getByText("En attente de validation", { exact: true })).toBeVisible();
});

// Mise en relation (décision v2 §3) : la messagerie vit dans l'application. Deux personnes inscrites à
// une même soirée : code personnel saisi, demande, acceptation, puis message — entièrement dans l'app.
test.describe("messagerie dans l'application", () => {
  const HOMME = "+33600000020", FEMME = "+33600000022";
  test.beforeAll(async () => { await forgetContacts(HOMME, FEMME); await shareAnEvent(HOMME, FEMME); });
  test.afterAll(async () => { await forgetContacts(HOMME, FEMME); await forgetSharedEvent(); });

  test("code personnel, demande, acceptation puis message", async ({ browser }) => {
    const femmeToken = await tokenFor(FEMME);
    const { code } = await (await fetch(`${API_URL}/me/share-qr`, { headers: { Authorization: `Bearer ${femmeToken}` } })).json();

    const homme = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
    await openAs(homme, HOMME);
    await tab(homme, "Scanner");
    await homme.getByLabel("Ou saisir le code").fill(code);
    await homme.getByText("Rechercher le profil").click();
    await homme.getByText("Envoyer une demande de contact").click();
    await expect(homme.getByText(/Demande envoyée/)).toBeVisible();

    const femme = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
    await openAs(femme, FEMME);
    await tab(femme, "Messages");
    await femme.getByText("Accepter", { exact: true }).click();
    await femme.getByRole("button", { name: /Homme Validé/ }).click();
    await femme.getByLabel("Votre message").fill("Ravie de vous avoir rencontré !");
    await femme.getByLabel("Envoyer").click();
    await expect(femme.getByText("Ravie de vous avoir rencontré !")).toBeVisible();

    await homme.reload();
    await tab(homme, "Messages");
    await homme.getByRole("button", { name: /Femme Validée/ }).click();
    await expect(homme.getByText("Ravie de vous avoir rencontré !")).toBeVisible();
  });
});
