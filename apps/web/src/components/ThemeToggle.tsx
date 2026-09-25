import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Theme, currentTheme, setTheme } from "../lib/theme";

// Bouton toujours visible dans l'en-tête (ordinateur et mobile) : l'icône montre le thème vers
// lequel on bascule, le libellé accessible dit l'action.
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(currentTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Activer le mode sombre" : "Activer le mode clair";
  return <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} aria-pressed={theme === "dark"} onClick={() => { setTheme(next); setLocal(next); }}>
    {next === "dark" ? <Moon size={20} aria-hidden="true"/> : <Sun size={20} aria-hidden="true"/>}
  </button>;
}
