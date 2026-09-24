import { EVENT_VIEWER_STATUS_LABEL, type EventViewerStatus } from "@nour/shared";
import * as WebBrowser from "expo-web-browser";
import { AlertCircle, CalendarDays, Check, CheckCircle2, CircleCheck, Heart, Hourglass, Info, MapPin, Users } from "lucide-react-native";
import { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { WEB_URL } from "../api";
import { imgUrl, money, shortDate } from "../format";
import { F, R, S, T, s } from "../theme";

// Composants partagés de l'application, équivalents de ceux du site (components/ui.tsx, brand.tsx) :
// mêmes libellés, mêmes couleurs, mêmes règles (jamais d'emoji ni de caractère Unicode comme icône).

export function BrandMark({ size = 32 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 32 32">
    <Rect width="32" height="32" rx="8" fill={T.night} />
    <Rect x="9" y="7.5" width="14" height="3.2" rx="1.6" fill={T.saffron} />
    <Path d="M10.2 14.2v5.6a5.8 5.8 0 0 0 11.6 0v-5.6" fill="none" stroke={T.onNight} strokeWidth={3.4} strokeLinecap="round" />
  </Svg>;
}
export function Logo({ onNight = false }: { onNight?: boolean }) {
  return <View style={s.row} accessibilityLabel="Nūr Meet"><BrandMark size={30} /><Text style={{ fontFamily: F.display, fontSize: 21, color: onNight ? T.onNight : T.night, letterSpacing: -0.4 }}>nūr<Text style={{ fontFamily: F.text, color: onNight ? T.onNight2 : T.ink2 }}> meet</Text></Text></View>;
}

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export function Button({ title, onPress, variant = "primary", small = false, disabled = false, busy = false, icon, style }: { title: string; onPress?: () => void; variant?: ButtonVariant; small?: boolean; disabled?: boolean; busy?: boolean; icon?: ReactNode; style?: ViewStyle }) {
  const bg = { primary: T.night, accent: T.saffron, secondary: T.surface, ghost: "transparent", danger: T.danger }[variant];
  const fg = { primary: T.onNight, accent: T.ink, secondary: T.ink, ghost: T.ink, danger: T.onNight }[variant];
  return <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [{ minHeight: small ? 44 : 50, paddingHorizontal: small ? S[4] : S[5], borderRadius: R.sm, backgroundColor: bg, borderWidth: variant === "secondary" ? 1 : 0, borderColor: T.lineStrong, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S[2], opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
    {busy ? <ActivityIndicator color={fg} /> : icon}
    <Text style={{ fontFamily: F.textSemi, fontSize: small ? 14 : 16, color: fg, textAlign: "center" }}>{title}</Text>
  </Pressable>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "success" | "error"; children: ReactNode }) {
  const palette = { info: [T.infoBg, T.night2], success: [T.successBg, T.success], error: [T.dangerBg, T.danger] }[kind];
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : Info;
  return <View style={{ flexDirection: "row", gap: S[3], backgroundColor: palette[0], borderRadius: R.sm, padding: S[4] }} accessibilityRole={kind === "error" ? "alert" : undefined}>
    <Icon size={20} color={palette[1]} style={{ marginTop: 1 }} />
    <Text style={[s.small, { flex: 1, color: T.ink }]}>{children}</Text>
  </View>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={{ gap: S[1] }}>
    <Text style={s.label}>{label}</Text>
    <TextInput placeholderTextColor={T.ink3} {...props} style={[s.input, props.multiline && { minHeight: 96, paddingTop: S[3], textAlignVertical: "top" }, props.style]} />
    {hint && <Text style={s.meta}>{hint}</Text>}
  </View>;
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[s.chip, active && s.chipActive]}><Text style={[s.chipText, active && { color: T.onNight }]}>{label}</Text></Pressable>;
}

export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: "neutral" | "success" | "warning" | "danger"; icon?: ReactNode }) {
  const [bg, fg] = { neutral: [T.surface2, T.ink2], success: [T.successBg, T.success], warning: [T.warningBg, T.warning], danger: [T.dangerBg, T.danger] }[tone];
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: bg, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3 }}>{icon}<Text style={{ fontFamily: F.textBold, fontSize: 12, color: fg }}>{label}</Text></View>;
}

// §15 : couleur et icône par type d'événement, comme sur le site.
export function CategoryBadge({ category }: { category: string }) {
  const rencontre = category === "Speed dating";
  const color = rencontre ? T.rencontre : T.networking;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: T.surface, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
    {rencontre ? <Heart size={13} color={color} /> : <Users size={13} color={color} />}
    <Text style={{ fontFamily: F.textBold, fontSize: 12, color }}>{category}</Text>
  </View>;
}

// §5.2 : « Participe déjà » ou « Liste d'attente », rien pour les autres événements.
export function ViewerStatusBadge({ status }: { status: EventViewerStatus | undefined }) {
  if (!status) return null;
  return status === "CONFIRMED"
    ? <Badge tone="success" label={EVENT_VIEWER_STATUS_LABEL.CONFIRMED} icon={<CircleCheck size={13} color={T.success} />} />
    : <Badge tone="warning" label={EVENT_VIEWER_STATUS_LABEL.WAITLIST} icon={<Hourglass size={13} color={T.warning} />} />;
}

export const availabilityLabel = (a: any) => a.kind === "unknown" ? "Places selon catégorie" : a.full ? "Complet" : `${a.remaining} place${a.remaining > 1 ? "s" : ""} restante${a.remaining > 1 ? "s" : ""}`;
export const priceLabel = (event: any) => event.priceTiers?.length > 0 ? `dès ${money(Math.min(...event.priceTiers.map((t: any) => t.amountCents)))}` : event.priceCents === 0 ? "Gratuit" : money(event.priceCents);

// Carte événement : image 4:3, catégorie, date, titre, lieu et disponibilité, prix — même ordre que sur le site.
export function EventCard({ event, onPress }: { event: any; onPress: () => void }) {
  const full = event.availability?.kind !== "unknown" && event.availability?.full;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${event.title}, ${shortDate(event.startsAt)}, ${event.district}`} onPress={onPress} style={({ pressed }) => [s.card, { padding: 0, overflow: "hidden", opacity: pressed ? 0.92 : 1 }]}>
    <View>
      <Image source={{ uri: imgUrl(event.imageUrl) }} style={{ width: "100%", aspectRatio: 4 / 3, backgroundColor: T.surface2 }} />
      <View style={{ position: "absolute", top: S[3], left: S[3] }}><CategoryBadge category={event.category} /></View>
      {full && <View style={{ position: "absolute", bottom: S[3], right: S[3] }}><Badge tone="danger" label="Complet" /></View>}
    </View>
    <View style={{ padding: S[4], gap: S[2] }}>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <View style={s.row}><CalendarDays size={16} color={T.saffronInk} /><Text style={{ fontFamily: F.textSemi, fontSize: 14, color: T.saffronInk }}>{shortDate(event.startsAt)}</Text></View>
        <ViewerStatusBadge status={event.viewerStatus} />
      </View>
      <Text style={s.h3}>{event.title}</Text>
      <View style={s.row}><MapPin size={16} color={T.ink3} /><Text style={s.meta}>{event.district} · {availabilityLabel(event.availability)}</Text></View>
      <View style={[s.divider, { marginVertical: S[1] }]} />
      <Text style={s.bodyStrong}>{priceLabel(event)}</Text>
    </View>
  </Pressable>;
}

export function Avatar({ name, size = 48, photoUrl, verified }: { name: string; size?: number; photoUrl?: string | null; verified?: boolean }) {
  const img = photoUrl
    ? <Image source={{ uri: imgUrl(photoUrl) }} style={{ width: size, height: size, borderRadius: size / 2 }} />
    : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: T.night, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: F.textBold, color: T.onNight, fontSize: size * 0.34 }}>{(name || "?").slice(0, 2).toUpperCase()}</Text></View>;
  if (!verified) return img;
  return <View>{img}<View style={{ position: "absolute", bottom: -2, right: -2, backgroundColor: T.success, borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: T.surface }}><Check size={11} color={T.onNight} strokeWidth={3} /></View></View>;
}

export function ScreenTitle({ title, lead, action }: { title: string; lead?: string; action?: ReactNode }) {
  return <View style={{ gap: S[2] }}>
    <View style={[s.row, { justifyContent: "space-between", alignItems: "flex-end" }]}><Text style={[s.h1, { flex: 1 }]} accessibilityRole="header">{title}</Text>{action}</View>
    {lead && <Text style={s.body}>{lead}</Text>}
  </View>;
}

export function Loading() { return <View style={[s.center, { flex: 1, padding: S[7] }]}><ActivityIndicator color={T.night} /></View>; }
export function Skeleton({ height, width = "100%" }: { height: number; width?: number | `${number}%` }) { return <View style={{ height, width, borderRadius: R.sm, backgroundColor: T.surface2 }} />; }

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return <View style={[s.panel, s.center, { paddingVertical: S[6] }]}>{icon}<Text style={[s.h3, { textAlign: "center" }]}>{title}</Text>{text && <Text style={[s.small, { textAlign: "center" }]}>{text}</Text>}</View>;
}

// Case d'acceptation d'un texte juridique : le lien ouvre la page web correspondante (source unique
// des textes, apps/web/src/legal/*.md) dans le navigateur intégré.
export const openWeb = (path: string) => WebBrowser.openBrowserAsync(`${WEB_URL}${path}`);
export function ConsentCheck({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <Pressable onPress={() => onChange(!checked)} style={{ flexDirection: "row", alignItems: "flex-start", gap: S[3] }} accessibilityRole="checkbox" accessibilityState={{ checked }}>
    <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: checked ? T.night : T.lineStrong, backgroundColor: checked ? T.night : T.surface, alignItems: "center", justifyContent: "center", marginTop: 1 }}>{checked && <Check size={14} color={T.onNight} strokeWidth={3} />}</View>
    <Text style={[s.small, { flex: 1, color: T.ink }]}>{children}</Text>
  </Pressable>;
}
export const legalLink = (label: string, slug: string) => <Text style={{ color: T.saffronInk, textDecorationLine: "underline" }} onPress={() => openWeb(`/legal/${slug}`)}>{label}</Text>;
