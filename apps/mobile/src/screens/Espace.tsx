import { CalendarDays, CheckCircle2, Hourglass, Inbox, Ticket } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { PhoneVerification } from "../components/PhoneVerification";
import { Badge, Button, CategoryBadge, Chip, Empty, Field, Loading, Notice, Skeleton } from "../components/ui";
import { dayLabel, imgUrl, longDate, money, shortDate, timeLabel } from "../format";
import { APPLICATION_STATUS_LABEL } from "../labels";
import { EspaceTab, Navigate } from "../links";
import { payByCard } from "../payment";
import { R, S, T, s } from "../theme";
import { loadTickets } from "../ticket-cache";
import { EspaceProfile } from "./EspaceProfile";

// « Mon espace » participant, aligné sur le tableau de bord du site : réservations (avec liste d'attente
// et soirées similaires proposées), billets, entretien de validation et profil. Une notification ouvre
// directement l'inscription ou le billet concerné, mis en évidence (focus).
export function Espace({ user, tab, focus, navigate, onUserChanged, onLogout }: { user: any; tab: EspaceTab; focus?: string; navigate: Navigate; onUserChanged: () => void; onLogout: () => void }) {
  const tabs: [EspaceTab, string][] = [["reservations", "Réservations"], ["tickets", "Billets"], ["interview", "Entretien"], ["profile", "Profil"]];
  return <View style={{ flex: 1 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line }} contentContainerStyle={{ padding: S[3], gap: S[2] }}>
      {tabs.map(([id, label]) => <Chip key={id} label={label} active={tab === id} onPress={() => navigate({ name: "espace", tab: id })} />)}
    </ScrollView>
    {tab === "reservations" && <Reservations user={user} focus={focus} navigate={navigate} onUserChanged={onUserChanged} />}
    {tab === "tickets" && <Tickets focus={focus} navigate={navigate} />}
    {tab === "interview" && <Interview user={user} onUserChanged={onUserChanged} />}
    {tab === "profile" && <EspaceProfile user={user} onSaved={onUserChanged} onLogout={onLogout} />}
  </View>;
}

function useFocusScroll(ready: boolean, focus?: string) {
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  useEffect(() => { if (ready && focus && positions.current[focus] != null) setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, positions.current[focus] - 16), animated: true }), 150); }, [ready, focus]);
  return { scrollRef, register: (id: string) => (e: { nativeEvent: { layout: { y: number } } }) => { positions.current[id] = e.nativeEvent.layout.y; } };
}

function Reservations({ user, focus, navigate, onUserChanged }: { user: any; focus?: string; navigate: Navigate; onUserChanged: () => void }) {
  const [apps, setApps] = useState<any[] | null>(null), [offers, setOffers] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null), [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const load = () => Promise.all([api<any[]>("/me/applications"), api<any[]>("/me/alternative-offers")]).then(([a, o]) => { setApps(a); setOffers(o); }).catch(() => setApps([]));
  useEffect(() => { load(); }, []);
  const { scrollRef, register } = useFocusScroll(apps !== null, focus);
  const act = async (id: string, action: () => Promise<string>) => {
    setBusyId(id); setMessage(null);
    try { setMessage({ kind: "success", text: await action() }); await load(); }
    catch (e) { setMessage({ kind: "error", text: (e as Error).message }); }
    finally { setBusyId(null); }
  };
  const eventApps = (apps ?? []).filter(a => a.eventId);
  const pendingOffers = offers.filter(o => o.status === "PENDING");
  return <ScrollView ref={scrollRef} contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">Mes événements</Text>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {apps === null ? <><Skeleton height={140} /><Skeleton height={140} /></>
      : eventApps.length === 0 ? <Empty icon={<Inbox size={24} color={T.ink3} />} title="Aucune inscription pour le moment" text="Choisissez une soirée : elle apparaîtra ici avec son statut." />
        : eventApps.map(a => {
          const waitlisted = !!a.waitlistEntry && a.status === "PAYMENT_PENDING";
          const offersForEvent = pendingOffers.filter(o => o.originalEventId === a.eventId);
          const focused = focus === a.id;
          return <View key={a.id} onLayout={register(a.id)} style={[s.card, focused && { borderColor: T.saffron, borderWidth: 2 }]} testID={focused ? "focused-reservation" : undefined}>
            <View style={{ flexDirection: "row", gap: S[3] }}>
              <Image source={{ uri: imgUrl(a.event.imageUrl) }} style={{ width: 72, height: 72, borderRadius: R.sm, backgroundColor: T.surface2 }} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={[s.row, { flexWrap: "wrap" }]}><CategoryBadge category={a.event.category} />{waitlisted ? <Badge tone="warning" label="Liste d’attente" icon={<Hourglass size={13} color={T.warning} />} /> : <Text style={s.meta}>{APPLICATION_STATUS_LABEL[a.status] ?? a.status}</Text>}</View>
                <Text style={s.h3}>{a.event.title}</Text>
                <Text style={s.meta}>{shortDate(a.event.startsAt)} · {a.event.district}</Text>
              </View>
            </View>
            {a.call && a.status === "CALL_SCHEDULED" && <Text style={s.small}>Entretien : {shortDate(a.call.startsAt)}</Text>}
            {waitlisted && <Text style={s.small}>Soirée complète pour le moment : dès qu’une place se libère, vous êtes prévenu(e) et elle revient à la première personne qui finalise son paiement.</Text>}
            {a.status === "PAYMENT_PENDING" && (waitlisted
              ? <Button small variant="secondary" title="Voir la soirée" onPress={() => navigate({ name: "events", slug: a.event.slug })} />
              : !user.phoneVerified ? <PhoneVerification onVerified={onUserChanged} />
                : (a.amountCents ?? a.event.priceCents) === 0 ? <Button small title="Confirmer ma place (gratuit)" onPress={() => navigate({ name: "events", slug: a.event.slug })} />
                  : <Button small title={`Payer par carte · ${money(a.amountCents ?? a.event.priceCents)}`} busy={busyId === a.id} onPress={() => act(a.id, async () => { await payByCard(a.id, a.event.id, a.amountCents ?? a.event.priceCents); return "Paiement en cours de confirmation : votre billet apparaîtra dans « Billets »."; })} />)}
            {!["REFUSED", "CANCELLED"].includes(a.status) && <Button small variant="ghost" title="Annuler ma participation" busy={busyId === a.id} onPress={() => act(a.id, async () => {
              const r = await api<{ refunded: boolean; refundedAmountCents: number | null; eligible: boolean | null }>(`/me/applications/${a.id}/cancel`, { method: "POST" });
              return r.refunded ? `Participation annulée. ${money(r.refundedAmountCents!)} ont été remboursés intégralement.` : r.eligible === false ? "Participation annulée. Conformément à notre politique, aucun remboursement n’est possible à 24 heures ou moins de l’événement." : "Participation annulée.";
            })} />}
            {offersForEvent.length > 0 && <View style={{ gap: S[2], marginTop: S[2] }}>
              <Text style={s.bodyStrong}>Soirées similaires proposées pour vous</Text>
              {offersForEvent.map(o => <View key={o.id} style={[s.card, { backgroundColor: T.saffronSoft, borderColor: T.saffronSoft }]}>
                <Text style={s.bodyStrong}>{o.alternativeEvent.title}</Text>
                <Text style={s.meta}>{shortDate(o.alternativeEvent.startsAt)} · {o.alternativeEvent.district} · {o.alternativeEvent.priceCents === 0 ? "Gratuit" : money(o.alternativeEvent.priceCents)}</Text>
                <View style={[s.row, { gap: S[2] }]}>
                  <Button small title="Accepter" busy={busyId === o.id} style={{ flex: 1 }} onPress={() => act(o.id, async () => { await api(`/alternative-offers/${o.id}/respond`, { method: "POST", body: JSON.stringify({ accept: true }) }); return "Place réservée : réglez votre billet avant expiration."; })} />
                  <Button small variant="secondary" title="Refuser" style={{ flex: 1 }} onPress={() => act(o.id, async () => { await api(`/alternative-offers/${o.id}/respond`, { method: "POST", body: JSON.stringify({ accept: false }) }); return "Proposition refusée."; })} />
                </View>
              </View>)}
            </View>}
          </View>;
        })}
  </ScrollView>;
}

function Tickets({ focus, navigate }: { focus?: string; navigate: Navigate }) {
  const [tickets, setTickets] = useState<any[] | null>(null), [offlineSince, setOfflineSince] = useState<string>(), [error, setError] = useState("");
  useEffect(() => { loadTickets().then(r => { setTickets(r.tickets); setOfflineSince(r.offlineSince); }).catch(e => { setError((e as Error).message); setTickets([]); }); }, []);
  const { scrollRef, register } = useFocusScroll(tickets !== null, focus);
  return <ScrollView ref={scrollRef} contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">{tickets?.length === 1 ? "Mon billet" : "Mes billets"}</Text>
    {offlineSince && <Notice>Hors connexion : billets enregistrés sur ce téléphone le {shortDate(offlineSince)}. Ils restent valables à l’entrée.</Notice>}
    {error ? <Notice kind="error">{error}</Notice> : null}
    {tickets === null ? <Skeleton height={380} /> : tickets.length === 0
      ? <Empty icon={<Ticket size={24} color={T.ink3} />} title="Aucun billet pour le moment" text="Il apparaît ici dès que votre place est confirmée." />
      : tickets.map(t => {
        const focused = focus === t.reservationId;
        const event = t.reservation.event;
        return <View key={t.id} onLayout={register(t.reservationId)} style={[s.panel, { alignItems: "center" }, focused && { borderColor: T.saffron, borderWidth: 2 }]}>
          <CategoryBadge category={event.category} />
          <Text style={[s.meta, { color: T.saffronInk }]}>{shortDate(event.startsAt)}</Text>
          <Text style={[s.h2, { textAlign: "center" }]}>{event.title}</Text>
          {(event.venueRestaurant ?? event.controllerRestaurant) && <Text style={s.small}>{(event.venueRestaurant ?? event.controllerRestaurant).name}</Text>}
          <Text style={[s.small, { textAlign: "center" }]}>{event.address ? `${event.address} · ${event.district}` : event.district}</Text>
          <Image source={{ uri: t.qrDataUrl }} accessibilityLabel={`QR code du billet ${t.code}`} style={{ width: 220, height: 220, backgroundColor: T.surface, borderRadius: R.sm }} />
          <Text style={[s.bodyStrong, { letterSpacing: 1 }]}>{t.code}</Text>
          <Button small variant="ghost" title="Voir la soirée" onPress={() => navigate({ name: "events", slug: event.slug })} />
        </View>;
      })}
  </ScrollView>;
}

function Interview({ user, onUserChanged }: { user: any; onUserChanged: () => void }) {
  const [status, setStatus] = useState<any>(undefined), [motivation, setMotivation] = useState("");
  const [slots, setSlots] = useState<any[]>([]), [loadingSlots, setLoadingSlots] = useState(false), [activeDay, setActiveDay] = useState<string | null>(null), [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const load = () => api<any>("/me/global-interview").then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!status || status.status !== "PENDING_CALL" || status.call) { setSlots([]); return; }
    setLoadingSlots(true);
    api<any[]>("/interview-slots").then(list => { setSlots(list); setActiveDay(list[0] ? new Date(list[0].startsAt).toDateString() : null); }).catch(() => setSlots([])).finally(() => setLoadingSlots(false));
  }, [status?.status, status?.call]);
  const slotsByDay = useMemo(() => { const map = new Map<string, any[]>(); for (const slot of slots) { const key = new Date(slot.startsAt).toDateString(); map.set(key, [...(map.get(key) ?? []), slot]); } return map; }, [slots]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(null); try { await action(); } catch (e) { setMessage({ kind: "error", text: (e as Error).message }); } finally { setBusy(false); } };
  if (status === undefined) return <Loading />;
  const requestForm = !user.phoneVerified ? <PhoneVerification onVerified={onUserChanged} /> : <View style={{ gap: S[3] }}>
    <Field label="Votre motivation" multiline value={motivation} onChangeText={setMotivation} placeholder="Expliquez en quelques lignes ce que vous recherchez…" />
    <Button title="Demander mon entretien" busy={busy} onPress={() => run(async () => { if (motivation.trim().length < 30) throw new Error("Expliquez votre motivation en au moins 30 caractères."); await api("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation }) }); setMotivation(""); await load(); })} />
  </View>;
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">Entretien de validation</Text>
    <Text style={s.small}>Obligatoire une seule fois, avant votre première soirée de rencontre (speed dating).</Text>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {user.profile?.validatedAt ? <Notice kind="success">Votre profil est validé : vous pouvez vous inscrire directement aux soirées.</Notice>
      : !status || status.status == null ? requestForm
        : status.status === "REFUSED" ? (status.retryAvailableAt && new Date(status.retryAvailableAt) > new Date()
          ? <><Notice kind="error">Votre profil n’a pas été validé.</Notice><Text style={s.small}>Vous pourrez redemander un entretien à partir du {longDate(status.retryAvailableAt)}.</Text></>
          : requestForm)
          : status.status === "PENDING_CALL" && !status.call ? <View style={[s.panel, { gap: S[3] }]}>
            <Text style={s.h3}>Choisissez votre appel</Text>
            {loadingSlots ? <ActivityIndicator color={T.night} /> : slots.length === 0 ? <Text style={s.small}>Aucun créneau disponible pour le moment. L’équipe Nūr Meet publie régulièrement de nouveaux créneaux : revenez un peu plus tard.</Text>
              : <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S[2] }}>{[...slotsByDay.keys()].map(day => <Chip key={day} label={dayLabel(day)} active={activeDay === day} onPress={() => setActiveDay(day)} />)}</ScrollView>
                <View style={[s.row, { flexWrap: "wrap" }]}>{(slotsByDay.get(activeDay ?? "") ?? []).map(slot => <Chip key={slot.id} label={schedulingId === slot.id ? "…" : timeLabel(slot.startsAt)} active={false} onPress={async () => { setSchedulingId(slot.id); setMessage(null); try { const r = await api<any>(`/applications/${status.id}/schedule`, { method: "POST", body: JSON.stringify({ slotId: slot.id }) }); setStatus({ ...status, status: "CALL_SCHEDULED", call: r.slot }); setMessage({ kind: "success", text: "Votre entretien est confirmé." }); } catch (e) { setMessage({ kind: "error", text: (e as Error).message }); } finally { setSchedulingId(null); } }} />)}</View></>}
            <Button small variant="ghost" title="Annuler ma demande" busy={busy} onPress={() => run(async () => { await api(`/me/applications/${status.id}/cancel`, { method: "POST" }); await load(); })} />
          </View>
            : status.call ? <View style={s.panel}><Badge tone="success" label="Entretien programmé" icon={<CheckCircle2 size={13} color={T.success} />} /><Text style={s.h2}>{shortDate(status.call.startsAt)}</Text><Text style={s.small}>L’équipe Nūr Meet vous appellera à cette heure, puis vous serez informé(e) de la décision.</Text><Button small variant="ghost" title="Annuler" busy={busy} onPress={() => run(async () => { await api(`/me/applications/${status.id}/cancel`, { method: "POST" }); await load(); })} /></View>
              : <Empty icon={<CalendarDays size={24} color={T.ink3} />} title="Entretien en cours de traitement" />}
  </ScrollView>;
}
