import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { S, T, s } from "../theme";
import { Button } from "./ui";

const label = (iso: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// Date et heure d'une soirée. iOS choisit les deux d'un coup ; Android enchaîne la date puis l'heure ;
// la version web de test garde une saisie texte (AAAA-MM-JJ HH:MM).
export function DateTimeField({ label: title, value, onChange, disabled = false }: { label: string; value: string; onChange: (iso: string) => void; disabled?: boolean }) {
  const [step, setStep] = useState<"closed" | "date" | "time">("closed");
  const [webText, setWebText] = useState(value ? value.slice(0, 16).replace("T", " ") : "");
  const current = value ? new Date(value) : (() => { const d = new Date(); d.setDate(d.getDate() + 14); d.setHours(19, 30, 0, 0); return d; })();
  if (Platform.OS === "web") return <View style={{ gap: S[1] }}>
    <Text style={s.label}>{title}</Text>
    <TextInput style={s.input} editable={!disabled} value={webText} placeholder="AAAA-MM-JJ HH:MM" placeholderTextColor={T.ink3} onChangeText={t => { setWebText(t); const d = new Date(t.replace(" ", "T")); if (!Number.isNaN(d.getTime())) onChange(d.toISOString()); }} />
  </View>;
  return <View style={{ gap: S[1] }}>
    <Text style={s.label}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title} : ${value ? label(value) : "à choisir"}`} disabled={disabled} onPress={() => setStep("date")} style={[s.input, { justifyContent: "center", opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[s.body, { color: value ? T.ink : T.ink3 }]}>{value ? label(value) : "Choisir la date et l’heure"}</Text>
    </Pressable>
    {step !== "closed" && Platform.OS === "ios" && <>
      <DateTimePicker value={current} mode="datetime" display="spinner" locale="fr-FR" minuteInterval={5} minimumDate={new Date()} onChange={(_, d) => { if (d) onChange(d.toISOString()); }} />
      <Button small variant="secondary" title="Terminé" onPress={() => { if (!value) onChange(current.toISOString()); setStep("closed"); }} />
    </>}
    {step === "date" && Platform.OS === "android" && <DateTimePicker value={current} mode="date" minimumDate={new Date()} onChange={(event, d) => {
      if (event.type !== "set" || !d) { setStep("closed"); return; }
      const next = new Date(current); next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); onChange(next.toISOString()); setStep("time");
    }} />}
    {step === "time" && Platform.OS === "android" && <DateTimePicker value={current} mode="time" is24Hour onChange={(event, d) => {
      setStep("closed");
      if (event.type !== "set" || !d) return;
      const next = new Date(current); next.setHours(d.getHours(), d.getMinutes(), 0, 0); onChange(next.toISOString());
    }} />}
  </View>;
}
