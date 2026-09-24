import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { Mail, Smartphone } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { WEB_URL, api, setToken } from "../api";
import { Button, Field, Logo, Notice } from "../components/ui";
import { F, S, T, s } from "../theme";


type LoginResult = { token: string; isNewUser?: boolean };

// Logo Google officiel (quatre couleurs), exigé par les règles d'affichage du bouton « Continuer avec Google ».
function GoogleG() {
  return <Svg width={18} height={18} viewBox="0 0 48 48">
    <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <Path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </Svg>;
}

// Connexion (2026-09-24), identique au site : code par e-mail ou Google, sans SMS ; le SMS reste
// proposé aux comptes créés avec un numéro. Google passe par la page sécurisée du site (navigateur
// intégré) qui renvoie à l'application un code à usage unique, échangé ici contre la session.
export function Login({ onLogin }: { onLogin: (opts?: { restaurateur?: boolean }) => void }) {
  const [method, setMethod] = useState<"email" | "sms">("email");
  const [identifier, setIdentifier] = useState(""), [code, setCode] = useState(""), [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [devCode, setDevCode] = useState<string | null>(null);

  const finish = async (result: LoginResult) => { await setToken(result.token); if (result.isNewUser) setStep(3); else onLogin(); };
  const submit = async () => {
    setBusy(true); setError("");
    const field = method === "email" ? { email: identifier.trim() } : { phone: identifier.trim() };
    try {
      if (step === 1) { const r = await api<{ devCode?: string }>(method === "email" ? "/auth/email/request-code" : "/auth/request-otp", { method: "POST", body: JSON.stringify(field) }); setDevCode(r.devCode ?? null); setStep(2); }
      else await finish(await api<LoginResult>(method === "email" ? "/auth/email/verify" : "/auth/verify-otp", { method: "POST", body: JSON.stringify({ ...field, code }) }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const google = async () => {
    setBusy(true); setError("");
    try {
      const returnUrl = Linking.createURL("auth");
      // PKCE : le secret reste dans l'application, seule son empreinte passe par le navigateur.
      const verifier = Array.from(Crypto.getRandomBytes(32), b => b.toString(16).padStart(2, "0")).join("");
      const challenge = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const result = await WebBrowser.openAuthSessionAsync(`${WEB_URL}/auth/mobile?redirect=${encodeURIComponent(returnUrl)}&challenge=${challenge}`, returnUrl);
      if (result.type !== "success") return;
      const handoff = Linking.parse(result.url).queryParams?.code;
      if (typeof handoff !== "string") throw new Error("Connexion Google interrompue. Réessayez.");
      await finish(await api<LoginResult>("/auth/mobile-handoff/exchange", { method: "POST", body: JSON.stringify({ code: handoff, verifier }) }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const switchMethod = (m: "email" | "sms") => { setMethod(m); setStep(1); setIdentifier(""); setCode(""); setError(""); setDevCode(null); };

  if (step === 3) return <SafeAreaView style={s.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={[s.content, { paddingTop: S[6] }]}>
    <Logo />
    <Text style={[s.display, { marginTop: S[6] }]}>Que souhaitez-vous faire sur Nūr Meet ?</Text>
    <Text style={s.body}>Ce choix détermine votre espace ; il ne peut être fait qu’une seule fois, à la création du compte.</Text>
    <Button title="Participer aux événements" onPress={() => onLogin()} />
    <Button title="Je suis restaurateur" variant="secondary" onPress={() => onLogin({ restaurateur: true })} />
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={s.safe}><StatusBar style="light" />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: T.night, padding: S[5], paddingTop: S[6], paddingBottom: S[7], gap: S[4] }}>
          <Logo onNight />
          <Text style={[s.display, { color: T.onNight, marginTop: S[4] }]}>{step === 1 ? "Bienvenue sur Nūr Meet." : "Entrez le code reçu."}</Text>
          <Text style={[s.body, { color: T.onNight2 }]}>{step === 1 ? "Des soirées en petit comité à Paris. Aucun mot de passe à mémoriser." : method === "email" ? `Code envoyé à ${identifier}. Pensez à vérifier vos courriers indésirables.` : `Code envoyé au ${identifier}.`}</Text>
        </View>
        <View style={[s.content, { marginTop: -S[5], backgroundColor: T.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22 }]}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {step === 1 && method === "email" && <>
            <Pressable accessibilityRole="button" onPress={google} disabled={busy} style={{ minHeight: 50, borderRadius: 8, borderWidth: 1, borderColor: T.lineStrong, backgroundColor: T.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <GoogleG /><Text style={{ fontFamily: F.textSemi, fontSize: 16, color: T.ink }}>Continuer avec Google</Text>
            </Pressable>
            <View style={[s.row, { gap: S[3] }]}><View style={[s.divider, { flex: 1 }]} /><Text style={s.meta}>ou</Text><View style={[s.divider, { flex: 1 }]} /></View>
          </>}
          {step === 1
            ? method === "email"
              ? <Field label="Adresse e-mail" value={identifier} onChangeText={setIdentifier} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="vous@exemple.fr" />
              : <Field label="Numéro de téléphone" value={identifier} onChangeText={setIdentifier} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+33612345678" />
            : <Field label="Code à six chiffres" value={code} onChangeText={v => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" placeholder="••••••" style={s.otp} />}
          <Button title={step === 1 ? (method === "email" ? "Recevoir mon code par e-mail" : "Recevoir mon code par SMS") : "Vérifier le code"} onPress={submit} busy={busy} />
          {step === 2 && <Pressable onPress={() => { setStep(1); setCode(""); }}><Text style={[s.link, { textAlign: "center" }]}>Modifier {method === "email" ? "l’adresse" : "le numéro"}</Text></Pressable>}
          {step === 1 && <Pressable onPress={() => switchMethod(method === "email" ? "sms" : "email")} style={[s.row, { justifyContent: "center", minHeight: 44 }]}>
            {method === "email" ? <Smartphone size={16} color={T.saffronInk} /> : <Mail size={16} color={T.saffronInk} />}
            <Text style={[s.link, { textAlign: "center", flexShrink: 1 }]}>{method === "email" ? "Compte créé avec un numéro ? Connexion par SMS" : "Se connecter avec Google ou par e-mail"}</Text>
          </Pressable>}
          {devCode ? <Notice kind="info">Mode local — aucun {method === "email" ? "e-mail" : "SMS"} réellement envoyé. Code : {devCode}</Notice> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
