import { ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "../api";
import { S, T, s } from "../theme";
import { Button, Field, Notice } from "./ui";

// Vérification du numéro par SMS, une seule fois (2026-09-24) : demandée avant la première inscription,
// jamais à la connexion — même règle et mêmes textes que sur le site.
export function PhoneVerification({ onVerified }: { onVerified: () => void }) {
  const [phone, setPhone] = useState(""), [code, setCode] = useState(""), [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [devCode, setDevCode] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (step === 1) { const r = await api<{ devCode?: string }>("/me/phone/request-code", { method: "POST", body: JSON.stringify({ phone }) }); setDevCode(r.devCode ?? null); setStep(2); }
      else { await api("/me/phone/verify", { method: "POST", body: JSON.stringify({ phone, code }) }); onVerified(); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <View style={s.panel} testID="phone-verification">
    <View style={{ flexDirection: "row", gap: S[3] }}>
      <ShieldCheck size={22} color={T.success} />
      <View style={{ flex: 1, gap: 2 }}><Text style={s.bodyStrong}>Confirmez votre numéro de téléphone</Text><Text style={s.small}>Une seule fois, par SMS, avant votre première réservation. Il n’est jamais montré aux autres participants ni aux restaurants.</Text></View>
    </View>
    {error ? <Notice kind="error">{error}</Notice> : null}
    {step === 1
      ? <Field label="Numéro de téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+33612345678" />
      : <Field label={`Code reçu par SMS au ${phone}`} value={code} onChangeText={v => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" placeholder="••••••" style={s.otp} />}
    <Button small title={step === 1 ? "Recevoir le code" : "Confirmer mon numéro"} onPress={submit} busy={busy} />
    {step === 2 && <Pressable onPress={() => { setStep(1); setCode(""); }}><Text style={[s.link, { textAlign: "center" }]}>Modifier le numéro</Text></Pressable>}
    {devCode ? <Text style={s.meta}>Mode local — aucun SMS envoyé. Code : {devCode}</Text> : null}
  </View>;
}
