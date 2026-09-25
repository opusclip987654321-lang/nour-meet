import { Share2 } from "lucide-react";
import { useCallback, useState } from "react";
import { SITE_URL } from "../lib/seo";
import { Toast, type ToastMessage } from "./Toast";

// « Partager avec un ami » (décision v2 §2.1) : remplace « Créer mon compte » pour un membre déjà
// connecté. Feuille de partage native quand le navigateur la propose, sinon copie du lien.
export function ShareSiteButton({ className = "button secondary" }: { className?: string }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const clear = useCallback(() => setToast(null), []);
  const url = SITE_URL || window.location.origin;
  const share = async () => {
    const data = { title: "Nūr Meet", text: "Des soirées en petit comité pour faire de vraies rencontres, à Paris et en Île-de-France.", url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (err) { if ((err as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setToast({ kind: "success", text: "Lien de Nūr Meet copié : collez-le dans un message.", id: Date.now() }); }
    catch { setToast({ kind: "error", text: `Copiez ce lien : ${url}`, id: Date.now() }); }
  };
  return <><button type="button" className={className} onClick={share}><Share2 size={18} aria-hidden="true" />Partager avec un ami</button><Toast toast={toast} onDone={clear} /></>;
}
