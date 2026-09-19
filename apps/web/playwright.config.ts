import { defineConfig, devices } from "@playwright/test";

// Tests d'interface (§21) contre le vrai serveur de développement (docker compose up requis),
// exactement comme les tests d'intégration API — jamais un DOM en mémoire qui masquerait un vrai
// problème de routage, de CORS ou de rendu.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // Un seul worker : les parcours réutilisent les personas de test partagées du seed par leur
  // numéro de téléphone (voir helpers.ts) — les exécuter en parallèle entre projets (chromium +
  // mobile tournant chacun le même spec) créerait une vraie collision sur ces comptes partagés.
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:5173",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Chromium plutôt que WebKit/iPhone (§21 "navigation mobile") : évite un second téléchargement
    // de navigateur pour ce qui reste un test de mise en page responsive, pas du rendu moteur natif.
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
