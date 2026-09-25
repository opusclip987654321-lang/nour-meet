import { useEffect } from "react";
import { Text, View } from "react-native";
import { R, S, T, F } from "../theme";

// Confirmation toujours visible (décision v2 §1.4) : flottante en bas de l'écran, où qu'on soit dans
// la page, annoncée par les lecteurs d'écran, puis refermée d'elle-même.
export type ToastMessage = { kind: "success" | "error"; text: string; id: number };
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => { if (!toast) return; const t = setTimeout(onDone, toast.kind === "error" ? 7000 : 4000); return () => clearTimeout(t); }, [toast, onDone]);
  if (!toast) return null;
  const [bg, fg] = toast.kind === "success" ? [T.successBg, T.success] : [T.dangerBg, T.danger];
  return <View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityRole="alert" style={{ position: "absolute", left: S[4], right: S[4], bottom: S[5], alignItems: "center" }}>
    <View style={{ backgroundColor: bg, borderRadius: R.pill, paddingHorizontal: S[5], paddingVertical: S[3], shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
      <Text style={{ fontFamily: F.textBold, fontSize: 15, color: fg, textAlign: "center" }}>{toast.text}</Text>
    </View>
  </View>;
}
