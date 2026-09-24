import { writeFileSync } from "node:fs";

// Le bandeau de consentement (corrections web 2026-09-24, §15) recouvre le bas de l'écran tant
// qu'aucun choix n'est fait : les parcours partent donc d'un choix « refuser » déjà enregistré.
// Le bandeau lui-même est testé dans consent.spec.ts, avec un navigateur vierge.
export const CONSENT_STATE = "tests/e2e/.consent-state.json";
export default function globalSetup() {
  const origin = new URL(process.env.WEB_URL ?? "http://localhost:5173").origin;
  writeFileSync(CONSENT_STATE, JSON.stringify({ cookies: [], origins: [{ origin, localStorage: [{ name: "nour_consent", value: JSON.stringify({ version: 1, analytics: false, decidedAt: new Date().toISOString() }) }] }] }));
}
