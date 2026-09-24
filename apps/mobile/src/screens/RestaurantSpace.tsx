import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { CalendarClock, Check, ExternalLink, LogOut, Minus } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { api } from "../api";
import { Badge, Button, Chip, Field, Loading, Notice, Skeleton, openWeb } from "../components/ui";
import { imgUrl, longDate, money } from "../format";
import { SUBSCRIPTION_STATUS_LABEL } from "../labels";
import { Navigate } from "../links";
import { F, R, S, T, s } from "../theme";
import { TicketScanner } from "./Scanner";

// Espace restaurateur, même organisation que /restaurant sur le site : candidature, fiche et galerie
// une fois approuvé, onglet Abonnement (cartes de formules). Aucune donnée financière ni remboursement
// ici (corrections web 2026-09-24, §6) ; la gestion des soirées reste sur le site.
type Tab = "establishment" | "subscription";
const emptyForm = { name: "", managerName: "", siret: "", description: "", district: "", address: "", phone: "", desiredCapacity: "", desiredSchedule: "", averagePricePerPersonCents: "", defaultMinParticipants: "", priceIncludesDrink: false, priceIncludesStarter: false, priceIncludesMain: false, priceIncludesDessert: false, priceNotes: "", proposesCategoryPricing: false, allowsPrivatization: false, specialConditions: "" };
type Form = typeof emptyForm;
const formFrom = (r: any): Form => ({ ...emptyForm, name: r.name ?? "", managerName: r.managerName ?? "", siret: r.siret ?? "", description: r.description ?? "", district: r.district ?? "", address: r.address ?? "", phone: r.phone ?? "", desiredCapacity: r.desiredCapacity ? String(r.desiredCapacity) : "", desiredSchedule: r.desiredSchedule ?? "", averagePricePerPersonCents: r.averagePricePerPersonCents != null ? String(r.averagePricePerPersonCents / 100) : "", defaultMinParticipants: r.defaultMinParticipants ? String(r.defaultMinParticipants) : "", priceIncludesDrink: !!r.priceIncludesDrink, priceIncludesStarter: !!r.priceIncludesStarter, priceIncludesMain: !!r.priceIncludesMain, priceIncludesDessert: !!r.priceIncludesDessert, priceNotes: r.priceNotes ?? "", proposesCategoryPricing: !!r.proposesCategoryPricing, allowsPrivatization: !!r.allowsPrivatization, specialConditions: r.specialConditions ?? "" });
const payload = (f: Form) => ({ ...f, desiredCapacity: f.desiredCapacity ? Number(f.desiredCapacity) : undefined, defaultMinParticipants: f.defaultMinParticipants ? Number(f.defaultMinParticipants) : undefined, averagePricePerPersonCents: f.averagePricePerPersonCents ? Math.round(Number(f.averagePricePerPersonCents.replace(",", ".")) * 100) : undefined });

const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) =>
  <View style={[s.row, { justifyContent: "space-between", minHeight: 44 }]}><Text style={[s.small, { flex: 1, color: T.ink }]}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ true: T.night, false: T.lineStrong }} accessibilityLabel={label} /></View>;

export function RestaurantSpace({ tab: initialTab, navigate, onLogout }: { tab: Tab | string; navigate: Navigate; onLogout: () => void }) {
  const [restaurant, setRestaurant] = useState<any>(undefined);
  const [tab, setTab] = useState<Tab>(initialTab === "subscription" ? "subscription" : "establishment");
  const load = useCallback(() => api<any>("/restaurants/me").then(setRestaurant).catch(() => setRestaurant(null)), []);
  useEffect(() => { load(); }, [load]);
  if (restaurant === undefined) return <Loading />;
  const hasTabs = restaurant && (restaurant.status === "PENDING" || restaurant.status === "APPROVED");
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.h1} accessibilityRole="header">Mon établissement</Text>
    {hasTabs && <View style={s.row}><Chip label="Mon établissement" active={tab === "establishment"} onPress={() => setTab("establishment")} /><Chip label="Abonnement" active={tab === "subscription"} onPress={() => setTab("subscription")} /></View>}
    {hasTabs && tab === "subscription" ? <Subscription restaurant={restaurant} onChanged={load} /> : <Establishment restaurant={restaurant} onChanged={load} />}
    {restaurant?.status === "APPROVED" && tab === "establishment" && <>
      <View style={s.divider} />
      <TicketScanner />
      <Text style={s.small}>La création et la gestion de vos soirées se font depuis le site.</Text>
      <Button variant="secondary" title="Gérer mes soirées sur le site" icon={<ExternalLink size={18} color={T.ink} />} onPress={() => openWeb("/admin")} />
    </>}
    <Button variant="ghost" title="Voir les soirées" onPress={() => navigate({ name: "events" })} />
    <Button variant="ghost" title="Se déconnecter" icon={<LogOut size={18} color={T.ink} />} onPress={onLogout} />
  </ScrollView>;
}

function Establishment({ restaurant, onChanged }: { restaurant: any; onChanged: () => void }) {
  const [form, setForm] = useState<Form>(restaurant ? formFrom(restaurant) : emptyForm);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null), [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false);
  useEffect(() => { if (restaurant) setForm(formFrom(restaurant)); }, [restaurant]);
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));
  const submit = async () => {
    if (!form.name.trim() || !form.managerName.trim() || !/^\d{14}$/.test(form.siret)) { setNotice({ kind: "error", text: "Renseignez le nom, le responsable et un SIRET à 14 chiffres." }); return; }
    setBusy(true); setNotice(null);
    try { await api("/restaurants/apply", { method: "POST", body: JSON.stringify(payload(form)) }); setNotice({ kind: "success", text: "Votre demande a été envoyée." }); onChanged(); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setNotice(null);
    try { await api("/restaurants/me", { method: "PATCH", body: JSON.stringify(payload(form)) }); setNotice({ kind: "success", text: "Fiche mise à jour." }); onChanged(); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const uploadPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("Accès refusé", "Autorisez l’accès aux photos pour ajouter une photo."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhotoBusy(true); setNotice(null);
    try { const body = new FormData(); body.append("file", { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" } as any); await api("/restaurants/me/photos", { method: "POST", body }); onChanged(); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setPhotoBusy(false); }
  };
  const removePhoto = async (id: string) => { setPhotoBusy(true); try { await api(`/restaurants/me/photos/${id}`, { method: "DELETE" }); onChanged(); } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); } finally { setPhotoBusy(false); } };

  const priceFields = <>
    <Field label="Places pour la soirée" keyboardType="number-pad" value={form.desiredCapacity} onChangeText={v => set({ desiredCapacity: v.replace(/\D/g, "") })} />
    <Field label="Jours et horaires souhaités" value={form.desiredSchedule} onChangeText={v => set({ desiredSchedule: v })} placeholder="Vendredi et samedi soir" />
    <Field label="Prix moyen par personne (€)" keyboardType="decimal-pad" value={form.averagePricePerPersonCents} onChangeText={v => set({ averagePricePerPersonCents: v.replace(/[^0-9.,]/g, "") })} />
    <Field label="Minimum de participants habituel" keyboardType="number-pad" value={form.defaultMinParticipants} onChangeText={v => set({ defaultMinParticipants: v.replace(/\D/g, "") })} />
    <View style={{ gap: S[1] }}><Text style={s.label}>Le prix comprend habituellement</Text><View style={[s.row, { flexWrap: "wrap" }]}>
      <Chip label="Boisson" active={form.priceIncludesDrink} onPress={() => set({ priceIncludesDrink: !form.priceIncludesDrink })} />
      <Chip label="Entrée" active={form.priceIncludesStarter} onPress={() => set({ priceIncludesStarter: !form.priceIncludesStarter })} />
      <Chip label="Plat" active={form.priceIncludesMain} onPress={() => set({ priceIncludesMain: !form.priceIncludesMain })} />
      <Chip label="Dessert" active={form.priceIncludesDessert} onPress={() => set({ priceIncludesDessert: !form.priceIncludesDessert })} />
    </View></View>
    <Field label="Précisions sur le contenu du prix" multiline value={form.priceNotes} onChangeText={v => set({ priceNotes: v })} />
    <Toggle label="Je propose des tarifs par catégorie (homme/femme)" value={form.proposesCategoryPricing} onChange={v => set({ proposesCategoryPricing: v })} />
    <Toggle label="Privatisation possible" value={form.allowsPrivatization} onChange={v => set({ allowsPrivatization: v })} />
    <Field label="Conditions particulières" multiline value={form.specialConditions} onChangeText={v => set({ specialConditions: v })} />
  </>;

  if (restaurant?.status === "PENDING") return <Notice>Votre demande pour « {restaurant.name} » est en cours d’examen.</Notice>;
  if (restaurant?.status === "APPROVED") {
    const photos = restaurant.photos ?? [];
    return <>
      <Notice kind="success">Votre établissement « {restaurant.name} » est approuvé.</Notice>
      <View style={s.panel}>
        <Text style={s.h3}>Fiche établissement</Text>
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        {priceFields}
        <Button title="Enregistrer" busy={busy} onPress={save} />
      </View>
      <View style={s.panel}>
        <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h3}>Galerie</Text><Text style={s.meta}>{photos.length}/8 photos</Text></View>
        <View style={[s.row, { flexWrap: "wrap", gap: S[3] }]}>{photos.map((p: any) => <View key={p.id} style={{ width: 96, gap: 2 }}><Image source={{ uri: imgUrl(p.url) }} style={{ width: 96, height: 96, borderRadius: R.sm, backgroundColor: T.surface2 }} /><Pressable onPress={() => removePhoto(p.id)} disabled={photoBusy} style={{ minHeight: 36, justifyContent: "center" }}><Text style={[s.link, { fontSize: 13, textAlign: "center" }]}>Retirer</Text></Pressable></View>)}</View>
        <Button small variant="secondary" title="Ajouter une photo" busy={photoBusy} disabled={photos.length >= 8} onPress={uploadPhoto} />
      </View>
    </>;
  }
  return <View style={s.panel}>
    <Text style={s.h2}>Devenir restaurateur</Text>
    {restaurant?.status === "REJECTED" && <Notice kind="error">Votre précédente demande n’a pas été retenue{restaurant.rejectionReason ? ` : ${restaurant.rejectionReason}` : "."} Vous pouvez soumettre une nouvelle demande.</Notice>}
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <Field label="Nom de l’établissement" value={form.name} onChangeText={v => set({ name: v })} />
    <Field label="Nom du responsable" value={form.managerName} onChangeText={v => set({ managerName: v })} />
    <Field label="SIRET (14 chiffres)" keyboardType="number-pad" value={form.siret} onChangeText={v => set({ siret: v.replace(/\D/g, "").slice(0, 14) })} />
    <Field label="Téléphone professionnel" keyboardType="phone-pad" value={form.phone} onChangeText={v => set({ phone: v })} />
    <Field label="Quartier / ville" value={form.district} onChangeText={v => set({ district: v })} />
    <Field label="Adresse" value={form.address} onChangeText={v => set({ address: v })} />
    <Field label="Description" multiline value={form.description} onChangeText={v => set({ description: v })} />
    {priceFields}
    <Text style={s.meta}>Le SIRET est déclaratif : Nūr Meet ne réalise pas de vérification officielle auprès d’un registre. La galerie de photos se complète après approbation.</Text>
    <Button title="Envoyer ma demande" busy={busy} onPress={submit} />
  </View>;
}

type Plan = { id: string; name: string; monthlyPriceCents: number; annualPriceCents: number | null; monthlyEventQuota: number | null; highlightTier: "simple" | "priority" | null };
type Period = "MONTHLY" | "ANNUAL";
const priceFor = (plan: Plan, period: Period) => period === "ANNUAL" ? plan.annualPriceCents : plan.monthlyPriceCents;
// Mêmes lignes que les cartes du site : uniquement ce qui existe réellement dans le produit.
const planFeatures = (plan: Plan) => [
  { label: plan.monthlyEventQuota == null ? "Soirées publiées en illimité" : `${plan.monthlyEventQuota} soirées publiées par mois`, included: true },
  { label: "Billetterie, paiement en ligne et billets QR", included: true },
  { label: "Liste des participants et scan à l’entrée", included: true },
  { label: "Comptes pour votre personnel d’accueil", included: true },
  { label: "Mise en avant prioritaire des soirées et de l’établissement", included: plan.highlightTier === "priority" }
];

// Cartes de formules (corrections web 2026-09-24, §1) : la règle de changement (immédiat avec prorata
// vers le haut, à l'échéance vers le bas) est appliquée par l'API ; cet écran l'explique avant
// confirmation. Le paiement et le portail Stripe s'ouvrent dans le navigateur intégré, puis l'état est
// relu chez Stripe (/subscription/sync) au retour.
function Subscription({ restaurant, onChanged }: { restaurant: any; onChanged: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const subscription = restaurant.subscription;
  const subscribed = !!subscription && subscription.status !== "CANCELLED";
  const [period, setPeriod] = useState<Period>(subscribed ? subscription.billingPeriod : "MONTHLY");
  const [busy, setBusy] = useState<string | null>(null), [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  useEffect(() => { api<Plan[]>("/plans").then(setPlans).catch(() => setPlans([])); }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setNotice(null);
    try { await action(); } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); } finally { setBusy(null); }
  };
  const syncAfterBrowser = async () => {
    setNotice({ kind: "info", text: "Vérification de votre abonnement auprès de Stripe…" });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const synced = await api<any>("/restaurants/me/subscription/sync", { method: "POST" });
        if (synced?.stripeSubscriptionId) { setNotice({ kind: "success", text: synced.status === "TRIALING" ? `Formule ${synced.plan.name} activée : votre essai gratuit court jusqu’au ${longDate(synced.currentPeriodEnd)}.` : `Formule ${synced.plan.name} active.` }); onChanged(); return; }
      } catch { /* nouvel essai ci-dessous */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    setNotice({ kind: "info", text: "Aucune formule confirmée pour l’instant. Si vous avez payé, la confirmation de Stripe arrivera dans quelques instants." });
    onChanged();
  };
  const checkout = (planId: string) => run(planId, async () => {
    const { url } = await api<{ url: string }>("/restaurants/me/subscription/checkout", { method: "POST", body: JSON.stringify({ planId, billingPeriod: period }) });
    await WebBrowser.openBrowserAsync(url);
    await syncAfterBrowser();
  });
  const changePlan = (plan: Plan) => run(plan.id, async () => {
    const result = await api<{ direction: "UPGRADE" | "DOWNGRADE"; subscription: any }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: plan.id }) });
    setConfirming(null);
    setNotice({ kind: "success", text: result.direction === "UPGRADE" ? `Vous êtes passé en formule ${plan.name}. Le prorata a été facturé sur votre moyen de paiement.` : `Changement programmé : vous restez en formule ${subscription.plan.name} jusqu’au ${longDate(result.subscription.pendingChangeAt)}, puis passez en ${plan.name}.` });
    onChanged();
  });
  const cancelPendingChange = () => run("cancel-change", async () => { await api("/restaurants/me/subscription/cancel-plan-change", { method: "POST" }); setNotice({ kind: "success", text: `Changement annulé : vous conservez la formule ${subscription.plan.name}.` }); onChanged(); });
  const cancelSubscription = () => Alert.alert("Résilier l’abonnement ?", "Vos avantages restent actifs jusqu’à la fin de la période déjà payée.", [
    { text: "Garder", style: "cancel" },
    { text: "Résilier", style: "destructive", onPress: () => run("cancel", async () => { await api("/restaurants/me/subscription/cancel", { method: "POST" }); setNotice({ kind: "success", text: "Résiliation programmée : vos avantages restent actifs jusqu’à la fin de la période déjà payée." }); onChanged(); }) }
  ]);
  const openPortal = () => run("portal", async () => { const { url } = await api<{ url: string }>("/restaurants/me/subscription/portal", { method: "POST" }); await WebBrowser.openBrowserAsync(url); onChanged(); });

  const pendingPlan = subscribed && subscription.pendingPlanId ? plans?.find(p => p.id === subscription.pendingPlanId) : null;
  return <>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    {subscribed && <View style={s.panel}>
      <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h3}>Mon abonnement</Text><Badge tone={subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? "success" : "warning"} label={SUBSCRIPTION_STATUS_LABEL[subscription.status] ?? subscription.status} /></View>
      <Text style={s.small}>Formule <Text style={s.bodyStrong}>{subscription.plan.name}</Text> · facturation {subscription.billingPeriod === "ANNUAL" ? "annuelle" : "mensuelle"} · {subscription.cancelAtPeriodEnd ? `résiliation effective le ${longDate(subscription.currentPeriodEnd)}` : subscription.status === "TRIALING" ? `essai gratuit jusqu’au ${longDate(subscription.currentPeriodEnd)}` : `prochaine échéance le ${longDate(subscription.currentPeriodEnd)}`}</Text>
      <Text style={s.small}>Ce mois-ci : {restaurant.currentMonthEventsPublished}{subscription.plan.monthlyEventQuota == null ? " soirée(s) publiée(s), sans limite" : ` / ${subscription.plan.monthlyEventQuota} soirées publiées`}</Text>
      {pendingPlan && <View style={[s.row, { alignItems: "flex-start" }]}><CalendarClock size={18} color={T.ink2} /><Text style={[s.small, { flex: 1 }]}>Passage en formule {pendingPlan.name} le {longDate(subscription.pendingChangeAt)}. Vous gardez la formule {subscription.plan.name} jusqu’à cette date.</Text></View>}
      {subscription.status === "PAST_DUE" && <Notice kind="error">Le dernier prélèvement a échoué. Mettez à jour votre moyen de paiement pour conserver votre formule.</Notice>}
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {subscription.stripeCustomerId && <Button small variant="secondary" title="Moyen de paiement et factures" disabled={!!busy} onPress={openPortal} />}
        {pendingPlan && <Button small variant="secondary" title={`Conserver ${subscription.plan.name}`} busy={busy === "cancel-change"} onPress={cancelPendingChange} />}
        {!subscription.cancelAtPeriodEnd && <Button small variant="ghost" title="Résilier" busy={busy === "cancel"} onPress={cancelSubscription} />}
      </View>
    </View>}
    <Text style={s.h2}>{subscribed ? "Les formules" : "Choisissez votre formule"}</Text>
    <Text style={s.small}>Prix hors taxes. {!subscription ? "Essai gratuit de 7 jours, carte requise, résiliable avant l’échéance." : "Sans engagement au-delà de la période en cours."}</Text>
    {!subscribed && <View style={s.row}><Chip label="Mensuel" active={period === "MONTHLY"} onPress={() => setPeriod("MONTHLY")} /><Chip label="Annuel · 2 mois offerts" active={period === "ANNUAL"} onPress={() => setPeriod("ANNUAL")} /></View>}
    {plans === null ? [0, 1].map(i => <Skeleton key={i} height={380} />) : plans.map(plan => {
      const price = priceFor(plan, period);
      const isCurrent = subscribed && subscription.planId === plan.id;
      const isPending = subscribed && subscription.pendingPlanId === plan.id;
      const featured = plan.highlightTier === "priority";
      const upgrade = subscribed && plan.monthlyPriceCents > subscription.plan.monthlyPriceCents;
      const onNight = featured;
      const ink = onNight ? T.onNight : T.ink, ink2 = onNight ? T.onNight2 : T.ink2;
      return <View key={plan.id} style={[featured ? s.nightPanel : s.panel, isCurrent && { borderWidth: 2, borderColor: T.saffron }]}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Text style={[s.h2, { color: ink }]}>{plan.name}</Text>
          {isCurrent ? <View style={{ backgroundColor: T.saffron, borderRadius: R.pill, paddingHorizontal: S[3], paddingVertical: 4 }}><Text style={{ fontFamily: F.textBold, fontSize: 12, color: T.night }}>Offre actuelle</Text></View>
            : isPending ? <Text style={[s.meta, { color: ink2 }]}>Dès le {longDate(subscription.pendingChangeAt)}</Text> : null}
        </View>
        {price == null ? <Text style={[s.small, { color: ink2 }]}>Non disponible en annuel</Text>
          : <Text style={{ color: ink }}><Text style={{ fontFamily: F.display, fontSize: 36 }}>{money(price).replace(",00", "")}</Text><Text style={[s.small, { color: ink2 }]}> {period === "ANNUAL" ? "HT / an" : "HT / mois"}</Text></Text>}
        {period === "ANNUAL" && price != null && <Text style={[s.meta, { color: ink2 }]}>soit {money(Math.round(price / 12))} HT par mois</Text>}
        <View style={{ gap: S[2] }}>{planFeatures(plan).map(f => <View key={f.label} style={[s.row, { alignItems: "flex-start" }]} accessibilityLabel={f.included ? f.label : `${f.label} (non inclus)`}>
          {f.included ? <Check size={18} color={onNight ? T.saffron : T.success} /> : <Minus size={18} color={ink2} />}
          <Text style={[s.small, { flex: 1, color: f.included ? ink : ink2 }]}>{f.label}</Text>
        </View>)}</View>
        {isCurrent ? <Button variant="secondary" title="Offre actuelle" disabled />
          : isPending ? <Text style={[s.meta, { color: ink2 }]}>Changement déjà programmé.</Text>
            : subscribed && subscription.stripeSubscriptionId
              ? confirming === plan.id
                ? <View style={{ gap: S[2] }}>
                  <Text style={[s.small, { color: ink }]}>{upgrade ? `Passage immédiat en ${plan.name}. Stripe facture aujourd’hui la différence au prorata de la période en cours.` : `Vous gardez ${subscription.plan.name} jusqu’au ${longDate(subscription.currentPeriodEnd)}, puis passez en ${plan.name} à l’échéance.`}</Text>
                  <View style={s.row}><Button small variant={featured ? "accent" : "primary"} title="Confirmer" busy={busy === plan.id} onPress={() => changePlan(plan)} /><Button small variant="secondary" title="Annuler" disabled={!!busy} onPress={() => setConfirming(null)} /></View>
                </View>
                : <Button variant={featured ? "accent" : "secondary"} title="Changer de formule" disabled={!!busy || price == null} onPress={() => setConfirming(plan.id)} />
              : <Button variant={featured ? "accent" : "primary"} title={subscribed ? "Changer de formule" : "Choisir cette formule"} busy={busy === plan.id} disabled={!!busy || price == null} onPress={() => checkout(plan.id)} />}
      </View>;
    })}
    <Text style={s.meta}>Le choix de la formule ne publie rien automatiquement : chaque soirée reste soumise à validation par l’équipe Nūr Meet. Paiement sécurisé par Stripe.</Text>
  </>;
}
