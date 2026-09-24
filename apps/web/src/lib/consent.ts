// Consentement aux traceurs (corrections web 2026-09-24, §15 ; politique cookies §3 à §5). Seule
// finalité soumise à consentement aujourd'hui : la mesure d'audience interne (identifiant anonyme
// nour_anon_id + visites envoyées à /analytics/pageview). Aucun traceur publicitaire n'existe sur le
// site. Le choix est conservé 6 mois puis redemandé ; tant qu'il n'est pas exprimé, rien n'est déposé.
export type ConsentChoice = { version: 1; analytics: boolean; decidedAt: string };

const KEY = "nour_consent";
const MAX_AGE_MS = 182 * 24 * 60 * 60_000;
export const CONSENT_CHANGED = "nour:consent-changed";
export const OPEN_CONSENT = "nour:open-consent";

export function readConsent(now = Date.now()): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentChoice;
    if (parsed?.version !== 1 || typeof parsed.analytics !== "boolean") return null;
    if (now - new Date(parsed.decidedAt).getTime() > MAX_AGE_MS) return null;
    return parsed;
  } catch { return null; }
}

export function saveConsent(analytics: boolean) {
  const choice: ConsentChoice = { version: 1, analytics, decidedAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
    // Retrait du consentement : l'identifiant anonyme déjà posé est effacé immédiatement.
    if (!analytics) { localStorage.removeItem("nour_anon_id"); sessionStorage.removeItem("nour_utm"); }
  } catch { /* stockage indisponible : le choix vaut pour cette visite seulement */ }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED, { detail: choice }));
  return choice;
}

export const analyticsAllowed = () => readConsent()?.analytics === true;
export const openConsentSettings = () => window.dispatchEvent(new Event(OPEN_CONSENT));
