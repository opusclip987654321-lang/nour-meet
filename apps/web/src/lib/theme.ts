// Mode clair / sombre (2026-09-25) : le choix explicite de la personne est mémorisé ; sans choix, le
// site suit le réglage de l'appareil. Le script en ligne d'index.html applique le même calcul avant
// le premier affichage (aucun flash blanc en mode sombre) — garder les deux synchronisés.
export type Theme = "light" | "dark";
const KEY = "nour_theme";

const stored = (): Theme | null => {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
};
const system = (): Theme => window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export const currentTheme = (): Theme => (document.documentElement.dataset.theme as Theme | undefined) ?? stored() ?? system();

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0e1120" : "#1c2653");
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* navigation privée : le choix vaut pour la page */ }
  applyTheme(theme);
}
