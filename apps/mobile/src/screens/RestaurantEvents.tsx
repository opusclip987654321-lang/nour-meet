import { EVENT_CATEGORIES, EVENT_ZONES } from "@nour/shared";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, CalendarPlus, History, ImagePlus, Inbox, Send, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { api } from "../api";
import { DateTimeField } from "../components/DateTimeField";
import { Badge, Button, CategoryBadge, Chip, Empty, Field, Notice, Skeleton } from "../components/ui";
import { centsToEuros, eurosToCents, imgUrl, shortDate, slugify } from "../format";
import { EVENT_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "../labels";
import { R, S, T, s } from "../theme";

// Soirées d'un restaurateur sur mobile (2026-09-24), mêmes règles que « Mes événements » sur le site :
// une soirée démarre en brouillon, se complète (photos, tarifs, quotas) puis est soumise à validation ;
// seule l'équipe Nūr Meet publie. Aucun remboursement ni donnée financière ici (§6.1) ; une soirée
// publiée ne peut plus être déplacée (l'API le refuse).
type NoticeState = { kind: "error" | "success" | "info"; text: string } | null;
const statusTone = (status: string): "success" | "danger" | "warning" | "neutral" => status === "PUBLISHED" || status === "FULL" ? "success" : status === "CANCELLED" ? "danger" : status === "PENDING_REVIEW" ? "warning" : "neutral";

// Photo choisie dans la galerie du téléphone puis envoyée à l'API (JPEG, PNG ou WEBP, 5 Mo maximum).
const pickAndUpload = async (path: string) => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) { Alert.alert("Accès refusé", "Autorisez l’accès aux photos pour ajouter une image."); return false; }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return false;
  if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) throw new Error("Image trop volumineuse (5 Mo maximum).");
  const body = new FormData();
  body.append("file", { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" } as any);
  await api(path, { method: "POST", body });
  return true;
};

const Perks = ({ value, onChange }: { value: { includesDrink: boolean; includesStarter: boolean; includesMain: boolean; includesDessert: boolean }; onChange: (patch: Partial<typeof value>) => void }) =>
  <View style={{ gap: S[1] }}><Text style={s.label}>Prestations réellement incluses</Text><View style={[s.row, { flexWrap: "wrap" }]}>
    <Chip label="Boisson" active={value.includesDrink} onPress={() => onChange({ includesDrink: !value.includesDrink })} />
    <Chip label="Entrée" active={value.includesStarter} onPress={() => onChange({ includesStarter: !value.includesStarter })} />
    <Chip label="Plat" active={value.includesMain} onPress={() => onChange({ includesMain: !value.includesMain })} />
    <Chip label="Dessert" active={value.includesDessert} onPress={() => onChange({ includesDessert: !value.includesDessert })} />
  </View></View>;

export function RestaurantEvents({ restaurant, focus }: { restaurant: any; focus?: string }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [view, setView] = useState<"list" | "create" | string>(focus ?? "list");
  const load = useCallback(() => api<any[]>("/admin/events").then(setEvents).catch(() => setEvents([])), []);
  useEffect(() => { load(); }, [load]);
  if (view === "create") return <CreateEvent restaurant={restaurant} onDone={() => { setView("list"); load(); }} />;
  const selected = view !== "list" ? events?.find(e => e.id === view) : null;
  if (selected) return <ManageEvent event={selected} onBack={() => setView("list")} onChanged={load} />;
  const sub = restaurant.subscription;
  return <>
    {sub && <Text style={s.small}>Formule {sub.plan.name} : {restaurant.currentMonthEventsPublished}{sub.plan.monthlyEventQuota == null ? " soirée(s) publiée(s) ce mois-ci, sans limite." : ` / ${sub.plan.monthlyEventQuota} soirées publiées ce mois-ci.`} Un brouillon ne compte qu’à sa première publication.</Text>}
    <Button title="Créer une soirée" icon={<CalendarPlus size={18} color={T.onNight} />} onPress={() => setView("create")} />
    {events === null ? [0, 1].map(i => <Skeleton key={i} height={96} />)
      : events.length === 0 ? <Empty icon={<Inbox size={24} color={T.ink3} />} title="Aucune soirée pour le moment" text="Créez votre première soirée : elle démarre en brouillon, puis vous la soumettez à validation." />
        : events.map(ev => <Pressable key={ev.id} accessibilityRole="button" onPress={() => setView(ev.id)} style={({ pressed }) => [s.card, { flexDirection: "row", gap: S[3], opacity: pressed ? 0.85 : 1 }]}>
          <Image source={{ uri: imgUrl(ev.imageUrl) }} style={{ width: 72, height: 72, borderRadius: R.sm, backgroundColor: T.surface2 }} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Badge label={EVENT_STATUS_LABEL[ev.status] ?? ev.status} tone={statusTone(ev.status)} />
            <Text style={s.bodyStrong} numberOfLines={2}>{ev.title}</Text>
            <Text style={s.meta}>{shortDate(ev.startsAt)} · {ev.district}</Text>
          </View>
        </Pressable>)}
  </>;
}

function CreateEvent({ restaurant, onDone }: { restaurant: any; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", slug: "", category: EVENT_CATEGORIES[0].name, description: "", startsAt: "", endsAt: "", district: restaurant.district ?? "", address: restaurant.address ?? "", zone: EVENT_ZONES[0], minAge: "", maxAge: "", capacity: String(restaurant.desiredCapacity ?? 20), price: restaurant.averagePricePerPersonCents != null ? centsToEuros(restaurant.averagePricePerPersonCents) : "30", includesDrink: !!restaurant.priceIncludesDrink, includesStarter: !!restaurant.priceIncludesStarter, includesMain: !!restaurant.priceIncludesMain, includesDessert: !!restaurant.priceIncludesDessert, perksDescription: "", minParticipants: restaurant.defaultMinParticipants ? String(restaurant.defaultMinParticipants) : "", minParticipantsDeadline: "" });
  const [notice, setNotice] = useState<NoticeState>(null), [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));
  const submit = async () => {
    const priceCents = eurosToCents(form.price);
    if (form.title.trim().length < 3 || form.description.trim().length < 20 || !form.startsAt || !form.endsAt || !form.district.trim() || !form.address.trim() || priceCents == null) {
      setNotice({ kind: "error", text: "Renseignez le titre, une description d’au moins 20 caractères, le début, la fin, le quartier, l’adresse et le prix." }); return;
    }
    if (new Date(form.endsAt) <= new Date(form.startsAt)) { setNotice({ kind: "error", text: "La fin doit être après le début." }); return; }
    if (form.minParticipants && !form.minParticipantsDeadline) { setNotice({ kind: "error", text: "Indiquez la date limite de décision pour le minimum de participants." }); return; }
    setBusy(true); setNotice(null);
    try {
      await api("/admin/events", { method: "POST", body: JSON.stringify({
        title: form.title.trim(), slug: form.slug || slugify(form.title), category: form.category, description: form.description.trim(), startsAt: form.startsAt, endsAt: form.endsAt,
        district: form.district.trim(), address: form.address.trim(), zone: form.zone, capacity: Number(form.capacity), priceCents,
        minAge: form.minAge ? Number(form.minAge) : undefined, maxAge: form.maxAge ? Number(form.maxAge) : undefined,
        includesDrink: form.includesDrink, includesStarter: form.includesStarter, includesMain: form.includesMain, includesDessert: form.includesDessert, perksDescription: form.perksDescription || undefined,
        minParticipants: form.minParticipants ? Number(form.minParticipants) : undefined, minParticipantsDeadline: form.minParticipantsDeadline || undefined
      }) });
      onDone();
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return <View style={s.panel}>
    <Pressable accessibilityRole="link" onPress={onDone} style={[s.row, { minHeight: 44 }]}><ArrowLeft size={18} color={T.saffronInk} /><Text style={s.link}>Mes soirées</Text></Pressable>
    <Text style={s.h2}>Créer une soirée</Text>
    <Text style={s.small}>Votre soirée démarre en brouillon : ajoutez ensuite vos photos, puis soumettez-la à validation.</Text>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <Field label="Titre" value={form.title} onChangeText={v => set({ title: v, slug: slugify(v) })} />
    <View style={{ gap: S[1] }}><Text style={s.label}>Catégorie</Text><View style={[s.row, { flexWrap: "wrap" }]}>{EVENT_CATEGORIES.map(c => <Chip key={c.name} label={c.name} active={form.category === c.name} onPress={() => set({ category: c.name })} />)}</View></View>
    <Field label="Description" multiline value={form.description} onChangeText={v => set({ description: v })} hint="20 caractères minimum." />
    <DateTimeField label="Début" value={form.startsAt} onChange={v => set({ startsAt: v, endsAt: form.endsAt || new Date(new Date(v).getTime() + 3 * 3600_000).toISOString() })} />
    <DateTimeField label="Fin" value={form.endsAt} onChange={v => set({ endsAt: v })} />
    <View style={{ gap: S[1] }}><Text style={s.label}>Zone</Text><View style={[s.row, { flexWrap: "wrap" }]}>{EVENT_ZONES.map(z => <Chip key={z} label={z} active={form.zone === z} onPress={() => set({ zone: z })} />)}</View></View>
    <Field label="Quartier / ville" value={form.district} onChangeText={v => set({ district: v })} />
    <Field label="Adresse" value={form.address} onChangeText={v => set({ address: v })} hint="Communiquée aux participants uniquement sur leur billet." />
    <Field label="Capacité totale" keyboardType="number-pad" value={form.capacity} onChangeText={v => set({ capacity: v.replace(/\D/g, "") })} />
    <Field label="Prix par personne (€)" keyboardType="decimal-pad" value={form.price} onChangeText={v => set({ price: v.replace(/[^0-9.,]/g, "") })} />
    <Perks value={form} onChange={set} />
    <Field label="Précisions sur les prestations" multiline value={form.perksDescription} onChangeText={v => set({ perksDescription: v })} placeholder="Ex. : cocktail sans alcool à l’arrivée, buffet salé…" />
    <View style={s.row}><View style={{ flex: 1 }}><Field label="Âge minimum" keyboardType="number-pad" value={form.minAge} onChangeText={v => set({ minAge: v.replace(/\D/g, "") })} placeholder="18" /></View><View style={{ flex: 1 }}><Field label="Âge maximum" keyboardType="number-pad" value={form.maxAge} onChangeText={v => set({ maxAge: v.replace(/\D/g, "") })} placeholder="Facultatif" /></View></View>
    <Field label="Minimum de participants (facultatif)" keyboardType="number-pad" value={form.minParticipants} onChangeText={v => set({ minParticipants: v.replace(/\D/g, "") })} />
    {form.minParticipants ? <DateTimeField label="Date limite de décision" value={form.minParticipantsDeadline} onChange={v => set({ minParticipantsDeadline: v })} /> : null}
    <Text style={s.meta}>Les quotas hommes/femmes (Speed dating), les tarifs différenciés et la galerie photo se règlent après la création.</Text>
    <Button title="Créer le brouillon" busy={busy} onPress={submit} />
  </View>;
}

function ManageEvent({ event: ev, onBack, onChanged }: { event: any; onBack: () => void; onChanged: () => void }) {
  const [notice, setNotice] = useState<NoticeState>(null), [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "edit" | "pricing" | "quotas" | "attendees" | "history">("none");
  const run = async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key); setNotice(null);
    try { await action(); if (success) setNotice({ kind: "success", text: success }); onChanged(); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const locked = ev.status === "PUBLISHED" || ev.status === "FULL";
  const cancelled = ev.status === "CANCELLED";
  const confirmCancel = () => Alert.alert("Annuler cette soirée ?", "Les participants sont prévenus et intégralement remboursés. Cette action est définitive.", [
    { text: "Garder la soirée", style: "cancel" },
    { text: "Annuler la soirée", style: "destructive", onPress: () => run("cancel", async () => { const r = await api<any>(`/admin/events/${ev.id}/cancel`, { method: "POST" }); setNotice({ kind: "success", text: `Soirée annulée.${r.refundedCount ? ` ${r.refundedCount} billet(s) remboursé(s) intégralement.` : ""}` }); }) }
  ]);
  return <>
    <Pressable accessibilityRole="link" onPress={onBack} style={[s.row, { minHeight: 44 }]}><ArrowLeft size={18} color={T.saffronInk} /><Text style={s.link}>Mes soirées</Text></Pressable>
    <View style={[s.panel, { padding: 0, overflow: "hidden" }]}>
      <Image source={{ uri: imgUrl(ev.imageUrl) }} style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: T.surface2 }} />
      <View style={{ padding: S[4], gap: S[2] }}>
        <View style={[s.row, { flexWrap: "wrap" }]}><CategoryBadge category={ev.category} /><Badge label={EVENT_STATUS_LABEL[ev.status] ?? ev.status} tone={statusTone(ev.status)} /></View>
        <Text style={s.h2}>{ev.title}</Text>
        <Text style={s.small}>{shortDate(ev.startsAt)} · {ev.district} · {ev.capacity} places</Text>
        {!cancelled && <Button small variant="secondary" title="Changer la photo principale" busy={busy === "image"} icon={<ImagePlus size={16} color={T.ink} />} onPress={() => run("image", () => pickAndUpload(`/admin/events/${ev.id}/image`), "Photo mise à jour.")} />}
      </View>
    </View>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

    {ev.status === "DRAFT" && <View style={s.panel}>
      <Text style={s.h3}>Prête à être publiée ?</Text>
      <Text style={s.small}>L’équipe Nūr Meet vérifie la soirée avant sa mise en ligne. Vous êtes prévenu(e) dès qu’elle est publiée.</Text>
      <Button title="Soumettre à validation" busy={busy === "submit"} icon={<Send size={18} color={T.onNight} />} onPress={() => run("submit", () => api(`/admin/events/${ev.id}/submit-for-review`, { method: "POST" }), "Soirée soumise à validation.")} />
    </View>}
    {ev.status === "PENDING_REVIEW" && <Notice>Soirée en cours de vérification par l’équipe Nūr Meet.</Notice>}
    {ev.minParticipantsNotifiedAt && !ev.minParticipantsOutcome && <View style={s.panel}>
      <Text style={s.h3}>Minimum de {ev.minParticipants} participants non atteint</Text>
      <Text style={s.small}>Maintenez la soirée, ou annulez-la : les participants sont alors intégralement remboursés.</Text>
      <View style={s.row}><Button small title="Maintenir" busy={busy === "maintain"} onPress={() => run("maintain", () => api(`/admin/events/${ev.id}/min-participants-decision`, { method: "POST", body: JSON.stringify({ action: "MAINTAIN" }) }), "Soirée maintenue.")} /><Button small variant="danger" title="Annuler" busy={busy === "min-cancel"} onPress={() => run("min-cancel", () => api(`/admin/events/${ev.id}/min-participants-decision`, { method: "POST", body: JSON.stringify({ action: "CANCEL" }) }), "Soirée annulée, billets remboursés.")} /></View>
    </View>}

    <Gallery ev={ev} busy={busy} run={run} disabled={cancelled} />
    <View style={[s.row, { flexWrap: "wrap" }]}>
      {!cancelled && <Chip label="Informations" active={panel === "edit"} onPress={() => setPanel(panel === "edit" ? "none" : "edit")} />}
      {!cancelled && <Chip label="Tarifs" active={panel === "pricing"} onPress={() => setPanel(panel === "pricing" ? "none" : "pricing")} />}
      {!cancelled && ev.category === "Speed dating" && <Chip label="Quotas" active={panel === "quotas"} onPress={() => setPanel(panel === "quotas" ? "none" : "quotas")} />}
      <Chip label="Participants" active={panel === "attendees"} onPress={() => setPanel(panel === "attendees" ? "none" : "attendees")} />
      <Chip label="Historique" active={panel === "history"} onPress={() => setPanel(panel === "history" ? "none" : "history")} />
    </View>
    {panel === "edit" && <EditInfo ev={ev} locked={locked} busy={busy} run={run} onSaved={() => setPanel("none")} />}
    {panel === "pricing" && <Pricing ev={ev} busy={busy} run={run} onSaved={() => setPanel("none")} />}
    {panel === "quotas" && <Quotas ev={ev} busy={busy} run={run} onSaved={() => setPanel("none")} />}
    {panel === "attendees" && <Attendees eventId={ev.id} />}
    {panel === "history" && <EventHistory eventId={ev.id} />}
    {!cancelled && <Button variant="danger" title="Annuler la soirée" busy={busy === "cancel"} onPress={confirmCancel} />}
  </>;
}

type Run = (key: string, action: () => Promise<unknown>, success?: string) => Promise<void>;

function Gallery({ ev, busy, run, disabled }: { ev: any; busy: string | null; run: Run; disabled: boolean }) {
  const photos = ev.photos ?? [];
  return <View style={s.panel}>
    <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h3}>Galerie</Text><Text style={s.meta}>{photos.length}/5 photos</Text></View>
    {photos.length > 0 && <View style={[s.row, { flexWrap: "wrap", gap: S[3] }]}>{photos.map((p: any) => <View key={p.id}>
      <Image source={{ uri: imgUrl(p.url) }} style={{ width: 96, height: 96, borderRadius: R.sm, backgroundColor: T.surface2 }} />
      {!disabled && <Pressable accessibilityRole="button" accessibilityLabel="Supprimer la photo" onPress={() => run(`photo-${p.id}`, () => api(`/admin/events/${ev.id}/photos/${p.id}`, { method: "DELETE" }))} style={{ position: "absolute", top: 4, right: 4, width: 32, height: 32, borderRadius: 16, backgroundColor: T.surface, alignItems: "center", justifyContent: "center" }}><X size={16} color={T.ink} /></Pressable>}
    </View>)}</View>}
    {!disabled && <Button small variant="secondary" title="Ajouter une photo" busy={busy === "gallery"} disabled={photos.length >= 5} icon={<ImagePlus size={16} color={T.ink} />} onPress={() => run("gallery", () => pickAndUpload(`/admin/events/${ev.id}/photos`))} />}
    <Text style={s.meta}>JPEG, PNG ou WEBP · 5 Mo maximum. Sans photo personnalisée, l’illustration de la catégorie est utilisée.</Text>
  </View>;
}

function EditInfo({ ev, locked, busy, run, onSaved }: { ev: any; locked: boolean; busy: string | null; run: Run; onSaved: () => void }) {
  const [form, setForm] = useState({ title: ev.title, description: ev.description, capacity: String(ev.capacity), startsAt: ev.startsAt, endsAt: ev.endsAt, includesDrink: ev.includesDrink, includesStarter: ev.includesStarter, includesMain: ev.includesMain, includesDessert: ev.includesDessert, perksDescription: ev.perksDescription ?? "" });
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));
  return <View style={s.panel}>
    <Field label="Titre" value={form.title} onChangeText={v => set({ title: v })} />
    <Field label="Description" multiline value={form.description} onChangeText={v => set({ description: v })} />
    <Field label="Capacité" keyboardType="number-pad" value={form.capacity} onChangeText={v => set({ capacity: v.replace(/\D/g, "") })} />
    <DateTimeField label="Début" value={form.startsAt} disabled={locked} onChange={v => set({ startsAt: v })} />
    <DateTimeField label="Fin" value={form.endsAt} disabled={locked} onChange={v => set({ endsAt: v })} />
    {locked && <Text style={s.meta}>Une soirée publiée ne peut plus être déplacée : annulez-la puis créez-en une nouvelle à la date souhaitée.</Text>}
    <Perks value={form} onChange={set} />
    <Field label="Précisions sur les prestations" multiline value={form.perksDescription} onChangeText={v => set({ perksDescription: v })} />
    <Button title="Enregistrer" busy={busy === "edit"} onPress={() => run("edit", async () => { await api(`/admin/events/${ev.id}`, { method: "PATCH", body: JSON.stringify({ ...form, capacity: Number(form.capacity) }) }); onSaved(); }, "Modifications enregistrées.")} />
  </View>;
}

function Pricing({ ev, busy, run, onSaved }: { ev: any; busy: string | null; run: Run; onSaved: () => void }) {
  const homme = ev.priceTiers?.find((t: any) => t.category === "HOMME")?.amountCents, femme = ev.priceTiers?.find((t: any) => t.category === "FEMME")?.amountCents;
  const [differentiated, setDifferentiated] = useState(homme != null && femme != null);
  const [flat, setFlat] = useState(centsToEuros(ev.priceCents)), [men, setMen] = useState(centsToEuros(homme ?? ev.priceCents)), [women, setWomen] = useState(centsToEuros(femme ?? ev.priceCents));
  const save = () => run("pricing", async () => {
    const body = differentiated ? { mode: "differentiated", homme: eurosToCents(men), femme: eurosToCents(women) } : { mode: "flat", amountCents: eurosToCents(flat) };
    if (Object.values(body).some(v => v === null)) throw new Error("Prix invalide.");
    await api(`/admin/events/${ev.id}/pricing`, { method: "POST", body: JSON.stringify(body) }); onSaved();
  }, "Tarifs mis à jour.");
  return <View style={s.panel}>
    <View style={[s.row, { justifyContent: "space-between" }]}><Text style={[s.small, { flex: 1, color: T.ink }]}>Tarif différencié hommes / femmes</Text><Switch value={differentiated} onValueChange={setDifferentiated} trackColor={{ true: T.night, false: T.lineStrong }} accessibilityLabel="Tarif différencié hommes / femmes" /></View>
    {differentiated ? <View style={s.row}><View style={{ flex: 1 }}><Field label="Hommes (€)" keyboardType="decimal-pad" value={men} onChangeText={setMen} /></View><View style={{ flex: 1 }}><Field label="Femmes (€)" keyboardType="decimal-pad" value={women} onChangeText={setWomen} /></View></View>
      : <Field label="Prix par personne (€)" keyboardType="decimal-pad" value={flat} onChangeText={setFlat} />}
    {differentiated && <Text style={s.meta}>La conformité juridique d’un tarif différencié selon le sexe doit être vérifiée avant toute mise en ligne.</Text>}
    <Button title="Enregistrer les tarifs" busy={busy === "pricing"} onPress={save} />
  </View>;
}

function Quotas({ ev, busy, run, onSaved }: { ev: any; busy: string | null; run: Run; onSaved: () => void }) {
  const [men, setMen] = useState(String(ev.quotas?.find((q: any) => q.category === "HOMME")?.capacity ?? Math.floor(ev.capacity / 2)));
  const [women, setWomen] = useState(String(ev.quotas?.find((q: any) => q.category === "FEMME")?.capacity ?? Math.ceil(ev.capacity / 2)));
  return <View style={s.panel}>
    {ev.quotas?.length > 0 && <Text style={s.small}>{ev.quotas.map((q: any) => `${q.category === "HOMME" ? "Hommes" : "Femmes"} : ${q.heldCount}/${q.capacity}`).join(" · ")}</Text>}
    <View style={s.row}><View style={{ flex: 1 }}><Field label="Places hommes" keyboardType="number-pad" value={men} onChangeText={v => setMen(v.replace(/\D/g, ""))} /></View><View style={{ flex: 1 }}><Field label="Places femmes" keyboardType="number-pad" value={women} onChangeText={v => setWomen(v.replace(/\D/g, ""))} /></View></View>
    <Button title="Enregistrer les quotas" busy={busy === "quotas"} onPress={() => run("quotas", async () => { await api(`/admin/events/${ev.id}/quotas`, { method: "POST", body: JSON.stringify({ homme: Number(men), femme: Number(women) }) }); onSaved(); }, "Quotas mis à jour.")} />
  </View>;
}

// Participants : uniquement ce qui sert à organiser la soirée (nom, catégorie, paiement, billet).
function Attendees({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>(`/admin/events/${eventId}/reservations`).then(setRows).catch(() => setRows([])); }, [eventId]);
  if (rows === null) return <Skeleton height={120} />;
  if (rows.length === 0) return <Empty icon={<Users size={24} color={T.ink3} />} title="Aucun participant pour le moment" />;
  const present = rows.filter(r => r.ticket?.status === "USED").length;
  return <View style={s.panel}>
    <Text style={s.small}>{rows.length} réservation(s) · {present} entrée(s) validée(s)</Text>
    {rows.map(r => <View key={r.id} style={{ paddingVertical: S[2], borderTopWidth: 1, borderTopColor: T.line, gap: 2 }}>
      <Text style={s.bodyStrong}>{r.user.displayName}{r.quotaCategory ? ` · ${r.quotaCategory === "HOMME" ? "Homme" : "Femme"}` : ""}</Text>
      <Text style={s.meta}>Paiement : {r.payment ? PAYMENT_STATUS_LABEL[r.payment.status] ?? r.payment.status : "—"} · Billet : {r.ticket?.status === "USED" ? "utilisé" : r.ticket?.status === "VALID" ? "valide" : r.cancelledAt ? "annulé" : "en attente"}</Text>
    </View>)}
  </View>;
}

const HISTORY_LABEL: Record<string, string> = { CREATE_EVENT: "Création", SUBMIT_EVENT_FOR_REVIEW: "Soumise à validation", APPROVE_EVENT: "Publiée", REJECT_EVENT: "Renvoyée en brouillon", UPDATE_EVENT: "Modifiée", SET_EVENT_PRICING: "Tarifs modifiés", SET_EVENT_QUOTAS: "Quotas modifiés", ADD_EVENT_PHOTO: "Photo ajoutée", CANCEL_EVENT: "Annulée", APPROVE_DATE_CHANGE: "Changement de date approuvé", REJECT_DATE_CHANGE: "Changement de date refusé" };
function EventHistory({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>(`/admin/events/${eventId}/history`).then(setItems).catch(() => setItems([])); }, [eventId]);
  if (items === null) return <Skeleton height={80} />;
  return <View style={s.panel}>
    {items.length === 0 ? <Text style={s.small}>Aucun historique.</Text> : items.map(h => <View key={h.id} style={[s.row, { alignItems: "flex-start" }]}><History size={16} color={T.ink3} /><Text style={[s.small, { flex: 1 }]}>{shortDate(h.createdAt)} — {HISTORY_LABEL[h.action] ?? h.action}</Text></View>)}
  </View>;
}
