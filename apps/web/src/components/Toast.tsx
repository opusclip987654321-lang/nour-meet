import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect } from "react";

// Confirmation toujours visible (décision v2 §1.4) : flottante en bas de l'écran, quelle que soit la
// position dans la page, annoncée aux lecteurs d'écran, puis refermée d'elle-même.
export type ToastMessage = { kind: "success" | "error"; text: string; id: number };
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => { if (!toast) return; const t = setTimeout(onDone, toast.kind === "error" ? 7000 : 4000); return () => clearTimeout(t); }, [toast, onDone]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} key={toast.id}>
    {toast.kind === "success" ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertCircle size={20} aria-hidden="true" />}
    <span>{toast.text}</span>
  </div>;
}
