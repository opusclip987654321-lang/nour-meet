import { MINIMUM_AGE, isAdult, normalizeInterests } from "@nour/shared";
import DateTimePicker from "@react-native-community/datetimepicker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Camera, LogOut } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { InterestPicker } from "../components/InterestPicker";
import { PhoneVerification } from "../components/PhoneVerification";
import { Toast, type ToastMessage } from "../components/Toast";
import { Avatar, Badge, Button, Chip, ConsentCheck, Field, Notice, legalLink } from "../components/ui";
import { R, S, T, s } from "../theme";

// Profil, numéro vérifié, code personnel et droits RGPD — mêmes règles que le site (âge minimum, CGU,
// export, suppression par anonymisation).
export function EspaceProfile({ user, onSaved, onLogout }: { user: any; onSaved: () => void; onLogout: () => void }) {
  const [form, setForm] = useState({ displayName: user.displayName ?? "", email: user.email ?? "", birthDate: user.profile?.birthDate ? String(user.profile.birthDate).slice(0, 10) : "", city: user.profile?.city ?? "", profession: user.profile?.profession ?? "", interests: normalizeInterests(user.profile?.interests ?? []), bio: user.profile?.bio ?? "", quotaCategory: user.profile?.quotaCategory ?? "" });
  const [toast, setToast] = useState<ToastMessage | null>(null), [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false);
  const setMessage = (m: { kind: "success" | "error"; text: string } | null) => { if (m) setToast({ ...m, id: Date.now() }); };
  const clearToast = useCallback(() => setToast(null), []);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false), [showDatePicker, setShowDatePicker] = useState(false), [acceptCgu, setAcceptCgu] = useState(false);
  const [qr, setQr] = useState<any>(null);
  useEffect(() => { api("/me/share-qr").then(setQr).catch(() => {}); }, []);
  const save = async () => {
    setMessage(null);
    if (!isAdult(form.birthDate)) { setMessage({ kind: "error", text: `Nūr Meet est réservé aux personnes de ${MINIMUM_AGE} ans et plus : renseignez votre date de naissance.` }); return; }
    if (!user.cguAccepted && !acceptCgu) { setMessage({ kind: "error", text: "Vous devez accepter les conditions générales d’utilisation pour continuer." }); return; }
    setBusy(true);
    try { await api("/me/profile", { method: "PATCH", body: JSON.stringify({ ...form, email: form.email || null, quotaCategory: form.quotaCategory || null, interests: form.interests, ...(acceptCgu ? { acceptCgu: true } : {}) }) }); setMessage({ kind: "success", text: "Profil enregistré." }); onSaved(); }
    catch (e) { setMessage({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("Accès refusé", "Autorisez l’accès aux photos pour changer votre photo de profil."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhotoBusy(true); setMessage(null);
    try { const body = new FormData(); body.append("file", { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" } as any); await api("/me/profile-photo", { method: "POST", body }); setMessage({ kind: "success", text: "Photo enregistrée." }); onSaved(); }
    catch (e) { setMessage({ kind: "error", text: (e as Error).message }); }
    finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => { setPhotoBusy(true); try { await api("/me/profile-photo", { method: "DELETE" }); onSaved(); } catch (e) { setMessage({ kind: "error", text: (e as Error).message }); } finally { setPhotoBusy(false); } };
  const downloadData = async () => {
    setBusy(true); setMessage(null);
    // Le fichier n'existe que le temps du partage : des données personnelles ne restent pas dans le cache.
    let file: File | null = null;
    try { const data = await api<object>("/me/export"); file = new File(Paths.cache, `nour-meet-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`); file.write(JSON.stringify(data, null, 2)); await Sharing.shareAsync(file.uri); }
    catch (e) { setMessage({ kind: "error", text: (e as Error).message }); }
    finally { try { if (file?.exists) file.delete(); } catch { /* déjà supprimé */ } setBusy(false); }
  };
  const confirmDeletion = async () => { setBusy(true); try { await api("/me/request-deletion", { method: "POST" }); onLogout(); } catch (e) { setMessage({ kind: "error", text: (e as Error).message }); setBusy(false); } };

  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.h1} accessibilityRole="header">Mon profil</Text>
    <View style={[s.panel, { alignItems: "center" }]}>
      <Avatar name={user.displayName} size={96} photoUrl={user.profile?.photoUrl} verified={!!user.profile?.validatedAt} />
      <View style={[s.row, { gap: S[5] }]}>
        {user.profile?.photoUrl
          ? <Pressable onPress={pickPhoto} disabled={photoBusy} style={{ minHeight: 44, justifyContent: "center" }}><Text style={s.link}>{photoBusy ? "Envoi…" : "Changer la photo"}</Text></Pressable>
          : <Button title={photoBusy ? "Envoi…" : "Ajouter une photo"} icon={<Camera size={18} color={T.onNight} />} busy={photoBusy} onPress={pickPhoto} />}
        {user.profile?.photoUrl && <Pressable onPress={removePhoto} disabled={photoBusy} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[s.link, { color: T.danger }]}>Retirer</Text></Pressable>}
      </View>
      <Text style={[s.meta, { textAlign: "center" }]}>JPEG, PNG ou WEBP · 5 Mo maximum. Visible par les personnes avec qui vous échangez.</Text>
    </View>
    <View style={s.panel}>
      <Field label="Prénom ou pseudonyme" value={form.displayName} onChangeText={v => setForm({ ...form, displayName: v })} />
      <Field label="E-mail" value={form.email} onChangeText={v => setForm({ ...form, email: v })} keyboardType="email-address" autoCapitalize="none" />
      <View style={{ gap: S[1] }}><Text style={s.label}>Date de naissance</Text><Pressable onPress={() => setShowDatePicker(true)} style={[s.input, { justifyContent: "center" }]}><Text style={[s.body, { color: form.birthDate ? T.ink : T.ink3 }]}>{form.birthDate ? new Date(form.birthDate).toLocaleDateString("fr-FR") : "Obligatoire"}</Text></Pressable></View>
      {showDatePicker && <View><DateTimePicker value={form.birthDate ? new Date(form.birthDate) : new Date(2000, 0, 1)} mode="date" display={Platform.OS === "ios" ? "spinner" : "default"} maximumDate={new Date()} onChange={(_, date) => { if (Platform.OS === "android") setShowDatePicker(false); if (date) setForm({ ...form, birthDate: date.toISOString().slice(0, 10) }); }} />{Platform.OS === "ios" && <Button small variant="secondary" title="Terminé" onPress={() => setShowDatePicker(false)} />}</View>}
      <Field label="Ville" value={form.city} onChangeText={v => setForm({ ...form, city: v })} />
      <Field label="Profession" value={form.profession} onChangeText={v => setForm({ ...form, profession: v })} />
      <InterestPicker value={form.interests} onChange={interests => setForm({ ...form, interests })} />
      <View style={{ gap: S[1] }}><Text style={s.label}>Sexe</Text><View style={[s.row, { flexWrap: "wrap" }]}>{([["", "Non renseigné"], ["HOMME", "Homme"], ["FEMME", "Femme"]] as const).map(([value, label]) => <Chip key={value} label={label} active={form.quotaCategory === value} onPress={() => setForm({ ...form, quotaCategory: value })} />)}</View></View>
      <Field label="Biographie" multiline value={form.bio} onChangeText={v => setForm({ ...form, bio: v })} />
      {!user.cguAccepted && <ConsentCheck checked={acceptCgu} onChange={setAcceptCgu}>Je certifie avoir {MINIMUM_AGE} ans ou plus et j’accepte les {legalLink("conditions générales d’utilisation", "cgu")}. Mes données sont traitées conformément à la {legalLink("politique de confidentialité", "confidentialite")}.</ConsentCheck>}
      <Button title="Enregistrer" busy={busy} onPress={save} />
    </View>
    {user.phoneVerified
      ? <View style={s.panel}><View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h3}>Numéro de téléphone</Text><Badge tone="success" label="Vérifié" /></View><Text style={s.small}>{user.phone} — utilisé uniquement pour vos réservations, jamais visible des autres participants ni des restaurants.</Text></View>
      : <PhoneVerification onVerified={onSaved} />}
    {qr && <View style={[s.panel, { alignItems: "center" }]}><Text style={s.h3}>Mon code personnel</Text><Text style={[s.small, { textAlign: "center" }]}>Pendant une soirée, montrez ce QR code à une personne que vous souhaitez revoir : rien ne s’ouvre sans votre accord.</Text><Image source={{ uri: qr.qrDataUrl }} accessibilityLabel={`QR code de votre code personnel ${qr.code}`} style={{ width: 200, height: 200, borderRadius: R.sm, backgroundColor: T.surface }} /><Text style={[s.bodyStrong, { letterSpacing: 1 }]}>{qr.code}</Text></View>}
    <View style={s.panel}>
      <Text style={s.h3}>Mes données</Text>
      <Text style={s.small}>Téléchargez une copie de tout ce que nous détenons sur votre compte, ou demandez la suppression de votre compte.</Text>
      <Button small variant="secondary" title="Télécharger mes données" busy={busy} onPress={downloadData} />
      {!confirmingDeletion ? <Button small variant="secondary" title="Supprimer mon compte" onPress={() => setConfirmingDeletion(true)} />
        : <><Text style={s.small}>Vos coordonnées et informations personnelles seront anonymisées ; les paiements déjà effectués restent conservés à des fins comptables et légales. Cette action est irréversible. Annulez d’abord toute réservation active pour un événement à venir.</Text><Button small variant="danger" title="Confirmer la suppression définitive" busy={busy} onPress={confirmDeletion} /></>}
    </View>
    <Button variant="ghost" title="Se déconnecter" icon={<LogOut size={18} color={T.ink} />} onPress={onLogout} />
  </ScrollView><Toast toast={toast} onDone={clearToast} /></View>;
}
