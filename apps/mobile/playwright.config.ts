import { defineConfig, devices } from "@playwright/test";

// Parcours de l'application mobile dans sa version web (react-native-web), contre une vraie API et
// une base de test jetable : mêmes écrans et mêmes appels réseau que sur téléphone, sans émulateur.
// Préparer l'export avec `npm run test:e2e -w @nour/mobile` (voir package.json).
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8099", ...devices["Pixel 7"], trace: "retain-on-failure" },
  webServer: { command: "node e2e/serve.mjs .e2e-dist", url: "http://127.0.0.1:8099", reuseExistingServer: true }
});
