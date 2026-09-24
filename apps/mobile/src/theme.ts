import { StyleSheet } from "react-native";

// Design system de l'application, aligné sur le site (apps/web/DESIGN.md et src/styles/tokens.css) :
// bleu nuit + safran sur fond clair, Bricolage Grotesque pour les titres, Hanken Grotesk pour le
// texte. Toujours un jeton, jamais une couleur ou une taille en dur dans un écran.
export const T = {
  night: "#1c2653", night2: "#2a3670", night3: "#121a3d",
  saffron: "#f2a33a", saffron2: "#f7b85c", saffronInk: "#8a4b00", saffronSoft: "#fdf1de",
  canvas: "#f6f6f8", surface: "#ffffff", surface2: "#eff0f3",
  ink: "#15171c", ink2: "#474c58", ink3: "#687080",
  line: "#e1e3e8", lineStrong: "#c9cdd5",
  onNight: "#ffffff", onNight2: "#c8cde4", onNightLine: "#3a4579",
  success: "#1d7a4c", successBg: "#e7f4ec", warning: "#9a5b00", warningBg: "#fff3dd", danger: "#b3261e", dangerBg: "#fce9e7", infoBg: "#eaedf7",
  rencontre: "#b0406a", rencontreBg: "#fbeaf0", networking: "#1f6f8b", networkingBg: "#e6f2f6",
  chart: "#4a5bb0"
};

export const F = {
  display: "BricolageGrotesque_700Bold", displaySemi: "BricolageGrotesque_600SemiBold",
  text: "HankenGrotesk_400Regular", textMedium: "HankenGrotesk_500Medium", textSemi: "HankenGrotesk_600SemiBold", textBold: "HankenGrotesk_700Bold"
};

export const S = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;
export const R = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
const shadow = { shadowColor: "#1c2653", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 };

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: S[5], paddingBottom: 120, gap: S[4] },
  row: { flexDirection: "row", alignItems: "center", gap: S[2] },
  // Typographie
  display: { fontFamily: F.display, fontSize: 34, lineHeight: 38, color: T.ink, letterSpacing: -0.6 },
  h1: { fontFamily: F.display, fontSize: 28, lineHeight: 33, color: T.ink, letterSpacing: -0.4 },
  h2: { fontFamily: F.display, fontSize: 22, lineHeight: 27, color: T.ink },
  h3: { fontFamily: F.displaySemi, fontSize: 18, lineHeight: 23, color: T.ink },
  body: { fontFamily: F.text, fontSize: 16, lineHeight: 24, color: T.ink2 },
  bodyStrong: { fontFamily: F.textSemi, fontSize: 16, lineHeight: 22, color: T.ink },
  small: { fontFamily: F.text, fontSize: 14, lineHeight: 20, color: T.ink2 },
  meta: { fontFamily: F.text, fontSize: 13, lineHeight: 18, color: T.ink3 },
  label: { fontFamily: F.textSemi, fontSize: 13, color: T.ink, marginBottom: S[1] },
  link: { fontFamily: F.textSemi, fontSize: 15, color: T.saffronInk },
  // Surfaces
  card: { backgroundColor: T.surface, borderRadius: R.md, borderWidth: 1, borderColor: T.line, padding: S[4], gap: S[2], ...shadow, shadowOpacity: 0.05 },
  panel: { backgroundColor: T.surface, borderRadius: R.md, borderWidth: 1, borderColor: T.line, padding: S[5], gap: S[3] },
  nightPanel: { backgroundColor: T.night, borderRadius: R.lg, padding: S[5], gap: S[3], ...shadow },
  // Champs
  input: { minHeight: 50, borderWidth: 1, borderColor: T.lineStrong, borderRadius: R.sm, backgroundColor: T.surface, paddingHorizontal: S[4], fontFamily: F.text, fontSize: 16, color: T.ink },
  otp: { fontFamily: F.textSemi, fontSize: 24, letterSpacing: 8, textAlign: "center" },
  // En-tête et barre d'onglets
  header: { height: 60, paddingHorizontal: S[5], flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.line, paddingBottom: 18, paddingTop: 8 },
  tabItem: { flex: 1, alignItems: "center", gap: 3, minHeight: 48, justifyContent: "center" },
  tabLabel: { fontFamily: F.textSemi, fontSize: 11, color: T.ink3 },
  // Divers
  chip: { minHeight: 40, paddingHorizontal: S[4], borderRadius: R.pill, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: T.night, borderColor: T.night },
  chipText: { fontFamily: F.textSemi, fontSize: 14, color: T.ink2 },
  divider: { height: 1, backgroundColor: T.line, marginVertical: S[2] }
});
