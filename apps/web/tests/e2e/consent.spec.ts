import { expect, test } from "@playwright/test";

// Bandeau de consentement (corrections web 2026-09-24, §15) : navigateur vierge, sans choix enregistré.
test.use({ storageState: { cookies: [], origins: [] } });

test("aucune mesure d'audience avant consentement ; refus mémorisé ; choix modifiable", async ({ page }) => {
  const pageviews: string[] = [];
  page.on("request", r => { if (r.url().includes("/analytics/pageview")) pageviews.push(r.url()); });
  await page.goto("/");
  await expect(page.getByTestId("cookie-consent")).toBeVisible();
  expect(pageviews).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem("nour_anon_id"))).toBeNull();

  await page.getByRole("button", { name: "Tout refuser" }).click();
  await expect(page.getByTestId("cookie-consent")).toHaveCount(0);
  await page.goto("/events");
  await expect(page.getByTestId("cookie-consent")).toHaveCount(0);
  expect(pageviews).toHaveLength(0);

  await page.getByRole("button", { name: "Gérer mes cookies" }).click();
  await page.getByTestId("consent-analytics").check();
  await page.getByRole("button", { name: "Enregistrer mes choix" }).click();
  await expect.poll(() => pageviews.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem("nour_anon_id"))).not.toBeNull();
});
