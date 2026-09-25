import { CameraView, useCameraPermissions } from "expo-camera";
import { ArrowLeft, Camera, CircleCheck, CircleX, Search, UserPlus } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api";
import { Avatar, Button, Field, Notice } from "../components/ui";
import { F, R, S, T, s } from "../theme";

const cameraBox = { height: 300, borderRadius: R.lg, overflow: "hidden" as const, backgroundColor: T.night3 };
const scanGuide = { position: "absolute" as const, top: 50, left: "50%" as const, marginLeft: -100, width: 200, height: 200, borderRadius: R.md, borderWidth: 3, borderColor: T.saffron };

function CameraPlaceholder({ hint, onPress }: { hint: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.nightPanel, { alignItems: "center", paddingVertical: S[7], opacity: pressed ? 0.9 : 1 }]}>
    <Camera size={36} color={T.saffron} />
    <Text style={[s.h3, { color: T.onNight }]}>Ouvrir la caméra</Text>
    <Text style={[s.small, { color: T.onNight2, textAlign: "center" }]}>{hint}</Text>
  </Pressable>;
}

const useCamera = () => {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const open = async () => {
    if (!permission?.granted) { const p = await requestPermission(); if (!p.granted) { Alert.alert("Caméra refusée", "Vous pouvez saisir le code manuellement."); return; } }
    setActive(true);
  };
  return { active, setActive, open };
};

// Scanner de contact entre participants : le QR code personnel d'une personne rencontrée affiche son
// profil validé ; la demande de contact n'ouvre une conversation qu'après acceptation.
export function Scanner() {
  const camera = useCamera();
  const [code, setCode] = useState(""), [profile, setProfile] = useState<any>(null), [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null), [busy, setBusy] = useState(false);
  const lookup = async (value = code) => {
    if (!value.trim()) return;
    setNotice(null); setBusy(true);
    try { setProfile(await api(`/profiles/code/${encodeURIComponent(value.trim())}`)); camera.setActive(false); }
    catch (e) { setProfile(null); setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setNotice(null);
    try { await api("/contacts/request", { method: "POST", body: JSON.stringify({ recipientId: profile.userId }) }); setNotice({ kind: "success", text: `Demande envoyée à ${profile.displayName}. La conversation s’ouvrira si elle est acceptée.` }); setProfile(null); setCode(""); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  if (profile) return <ScrollView contentContainerStyle={s.content}>
    <Pressable accessibilityRole="link" onPress={() => setProfile(null)} style={[s.row, { minHeight: 44 }]}><ArrowLeft size={18} color={T.saffronInk} /><Text style={s.link}>Scanner un autre code</Text></Pressable>
    <View style={[s.panel, { alignItems: "center" }]}>
      <Avatar name={profile.displayName} size={96} photoUrl={profile.photoUrl} verified={profile.validated} />
      <Text style={s.h2}>{profile.displayName}</Text>
      <Text style={s.meta}>{[profile.age ? `${profile.age} ans` : null, profile.city, profile.profession].filter(Boolean).join(" · ")}</Text>
    </View>
    {profile.bio ? <View style={s.panel}><Text style={s.h3}>À propos</Text><Text style={s.body}>{profile.bio}</Text></View> : null}
    {profile.interests?.length > 0 && <View style={[s.row, { flexWrap: "wrap" }]}>{profile.interests.map((x: string) => <View key={x} style={[s.chip, { minHeight: 32 }]}><Text style={s.chipText}>{x}</Text></View>)}</View>}
    <Button title="Envoyer une demande de contact" busy={busy} icon={<UserPlus size={18} color={T.onNight} />} onPress={send} />
  </ScrollView>;
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.h1} accessibilityRole="header">Revoir quelqu’un</Text>
    <Text style={s.body}>Scannez le QR code personnel d’une personne inscrite à la même soirée que vous : rien ne s’ouvre sans son accord.</Text>
    {camera.active ? <View style={cameraBox}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => { if (!busy) lookup(data); }} /><View style={scanGuide} /></View>
      : <CameraPlaceholder hint="Cadrez le QR code personnel." onPress={camera.open} />}
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <Field label="Ou saisir le code" value={code} onChangeText={setCode} placeholder="Ex. NOUR-3F9A-C21B-07E4" autoCapitalize="characters" autoCorrect={false} />
    <Button variant="secondary" title="Rechercher le profil" busy={busy} disabled={!code.trim()} icon={<Search size={18} color={T.ink} />} onPress={() => lookup()} />
  </ScrollView>;
}

// Scanner d'entrée pour le personnel (accueil, administration, restaurateur) : chaque scan valide
// directement le billet côté serveur (/admin/tickets/scan), comme la page Scanner du site.
export function TicketScanner() {
  const camera = useCamera();
  const [code, setCode] = useState(""), [result, setResult] = useState<any>(null), [error, setError] = useState("");
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const runScan = async (scannedCode: string) => {
    if (!scannedCode || busyRef.current) return;
    busyRef.current = true; setResult(null); setError("");
    try { setResult(await api<any>("/admin/tickets/scan", { method: "POST", body: JSON.stringify({ code: scannedCode }) })); }
    catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; }
  };
  // Un même QR code reste plusieurs secondes devant la caméra : on ignore les relectures immédiates.
  const onBarcode = (data: string) => {
    const now = Date.now();
    if (data === lastScanRef.current.code && now - lastScanRef.current.at < 3000) return;
    lastScanRef.current = { code: data, at: now };
    runScan(data);
  };
  return <View style={{ gap: S[4] }}>
    <Text style={s.h2}>Scanner un billet</Text>
    {camera.active ? <View style={cameraBox}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => onBarcode(data)} /><View style={scanGuide} /></View>
      : <CameraPlaceholder hint="Cadrez le QR code du billet." onPress={camera.open} />}
    <View style={[s.panel, result ? { borderColor: T.success, backgroundColor: T.successBg } : error ? { borderColor: T.danger, backgroundColor: T.dangerBg } : null]} accessibilityLiveRegion="polite">
      {result ? <><View style={s.row}><CircleCheck size={22} color={T.success} /><Text style={{ fontFamily: F.textBold, fontSize: 18, color: T.success }}>Entrée autorisée</Text></View><Text style={s.bodyStrong}>{result.participant}</Text><Text style={s.meta}>{result.event}</Text></>
        : error ? <><View style={s.row}><CircleX size={22} color={T.danger} /><Text style={{ fontFamily: F.textBold, fontSize: 18, color: T.danger }}>Entrée refusée</Text></View><Text style={s.small}>{error}</Text></>
          : <Text style={s.small}>En attente d’un billet : présentez le QR code ou saisissez le code manuellement.</Text>}
    </View>
    <Field label="Saisie manuelle (secours)" value={code} onChangeText={setCode} placeholder="Code du billet" autoCapitalize="characters" autoCorrect={false} />
    <Button title="Vérifier et valider l’entrée" disabled={!code.trim()} onPress={() => { runScan(code.trim()); setCode(""); }} />
  </View>;
}
