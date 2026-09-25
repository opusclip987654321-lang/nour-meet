import { CalendarDays, CheckCircle2, Hourglass, Inbox, Ticket } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { CallCalendar } from "../components/CallCalendar";
import { PhoneVerification } from "../components/PhoneVerification";
import { Badge, Button, CategoryBadge, Chip, Empty, Field, Loading, Notice, Skeleton } from "../components/ui";
import { imgUrl, longDate, money, shortDate } from "../format";
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
          // Un seul statut et un seul bouton principal quand il reste à payer (v2 §9), comme sur le site.
          const waitlisted = !!a.waitlistEntry && a.status === "PAYMENT_PENDING";
          const toPay = a.status === "PAYMENT_PENDING" && !waitlisted;
          const amount = a.amountCents ?? a.event.priceCents;
          const offersForEvent = pendingOffers.filter(o => o.originalEventId === a.eventId);
          const focused = focus === a.id;
          return <View key={a.id} onLayout={register(a.id)} style={[s.card, focused && { borderColor: T.saffron, borderWidth: 2 }]} testID={focused ? "focused-reservation" : undefined}>
            <View style={{ flexDirection: "row", gap: S[3] }}>
              <Image source={{ uri: imgUrl(a.event.imageUrl) }} style={{ width: 72, height: 72, borderRadius: R.sm, backgroundColor: T.surface2 }} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={[s.row, { flexWrap: "wrap" }]}><CategoryBadge category={a.event.category} />{waitlisted ? <Badge tone="warning" label="Liste d’attente" icon={<Hourglass size={13} color={T.warning} />} /> : !toPay && <Text style={s.meta}>{APPLICATION_STATUS_LABEL[a.status] ?? a.status}</Text>}</View>
                <Text style={s.h3}>{a.event.title}</Text>
                <Text style={s.meta}>{shortDate(a.event.startsAt)} · {a.event.district}</Text>
              </View>
            </View>
            {a.call && a.status === "CALL_SCHEDULED" && <Text style={s.small}>Entretien : {shortDate(a.call.startsAt)}</Text>}
            {waitlisted && <Text style={s.small}>Soirée complète pour le moment : dès qu’une place se libère, vous êtes prévenu(e) et elle revient à la première personne qui finalise son paiement.</Text>}
            {waitlisted && <Button small variant="secondary" title="Voir la soirée" onPress={() => navigate({ name: "events", slug: a.event.slug })} />}
            {toPay && <View style={{ gap: 2 }}>
              <Text style={s.h2}>{amount === 0 ? "Gratuit" : money(amount)}</Text>
              <Text style={s.small}>{a.event.flow === "SCREENING" ? "Votre candidature est acceptée." : "Votre place vous attend."}</Text>
            </View>}
            {toPay && (!user.phoneVerified ? <PhoneVerification onVerified={onUserChanged} />
              : amount === 0 ? <Button title="Confirmer ma place" onPress={() => navigate({ name: "events", slug: a.event.slug })} />
                : <Button title={`Payer ${money(amount)}`} busy={busyId === a.id} onPress={() => act(a.id, async () => { await payByCard(a.id, a.event.id, amount); return "Paiement en cours de confirmation : votre billet apparaîtra dans « Billets »."; })} />)}
            {!["REFUSED", "CANCELLED"].includes(a.status) && <Button small variant="ghost" title="Annuler ma participation" busy={busyId === a.id} onPress={() => act(a.id, async () => {
              const r = await api<{ refunded: boolean; refundedAmountCents: number | null; eligible: boolean | null }>(`/me/applications/${a.id}/cancel`, { method: "POST" });
              return r.refunded ? `Participation annulée. ${money(r.refundedAmountCents!)} ont été remboursés intégralement.` : r.eligible === false ? "Participation annulée. Conformément à notre politique, aucun remboursement n’est possible à 24 heures ou moins de l’événement." : "Participation annulée.";
            })} />}
            {offersForEvent.length > 0 && <View style={{ gap: S[2], marginTop: S[2] }}>
              <Text style={s.bodyStrong}>Soirées similaires proposées pour vous</Text>
              {offersForEvent.map(o => <View key={o.id} style={[s.card, { backgroundColor: T.saffronSoft, borderColor: T.saffronSoft }]}>
                <View style={{ flexDirection: "row", gap: S[3] }}>
                  <Image source={{ uri: imgUrl(o.alternativeEvent.imageUrl) }} style={{ width: 64, height: 64, borderRadius: R.sm, backgroundColor: T.surface2 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.bodyStrong}>{o.alternativeEvent.title}</Text>
                    <Text style={s.meta}>{shortDate(o.alternativeEvent.startsAt)} · {o.alternativeEvent.district}</Text>
                    <Text style={s.bodyStrong}>{o.alternativeEvent.priceCents === 0 ? "Gratuit" : money(o.alternativeEvent.priceCents)}</Text>
                  </View>
                </View>
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
  const [schedulingId, setSchedulingId] = useState<string | null>(null), [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const load = () => api<any>("/me/global-interview").then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(null); try { await action(); } catch (e) { setMessage({ kind: "error", text: (e as Error).message }); } finally { setBusy(false); } };
  const pick = (action: (startsAt: string) => Promise<string>) => async (startsAt: string) => {
    setSchedulingId(startsAt); setMessage(null);
    try { setMessage({ kind: "success", text: await action(startsAt) }); } catch (e) { setMessage({ kind: "error", text: (e as Error).message }); } finally { setSchedulingId(null); }
  };
  const schedule = pick(async startsAt => { const r = await api<any>(`/applications/${status.id}/schedule`, { method: "POST", body: JSON.stringify({ startsAt }) }); setStatus({ ...status, status: "CALL_SCHEDULED", call: r.slot }); return "Votre entretien est confirmé."; });
  // « Modifier mon créneau » (v2 §12) : déplacement atomique, distinct de l'annulation.
  const move = pick(async startsAt => { const r = await api<any>("/me/global-interview/reschedule", { method: "POST", body: JSON.stringify({ startsAt }) }); setStatus({ ...status, call: r.slot }); setMoving(false); return "Votre entretien a été déplacé."; });
  const cancelRequest = () => run(async () => { await api(`/me/applications/${status.id}/cancel`, { method: "POST" }); setMoving(false); await load(); setMessage({ kind: "success", text: "Votre demande d’entretien est annulée. Vous pourrez en refaire une quand vous le souhaitez." }); });
  if (status === undefined) return <Loading />;
  const requestForm = !user.phoneVerified ? <PhoneVerification onVerified={onUserChanged} /> : <View style={{ gap: S[3] }}>
    <Field label="Votre motivation" multiline value={motivation} onChangeText={setMotivation} placeholder="Expliquez en quelques lignes ce que vous recherchez…" />
    <Button title="Demander mon entretien" busy={busy} onPress={() => run(async () => { if (motivation.trim().length < 30) throw new Error("Expliquez votre motivation en au moins 30 caractères."); await api("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation }) }); setMotivation(""); await load(); })} />
  </View>;
  const cancelButton = <Button small variant="ghost" title="Annuler ma demande d’entretien" busy={busy} onPress={cancelRequest} />;
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.h1} accessibilityRole="header">Entretien de validation</Text>
    {/* v2 §13 : dire concrètement ce qu'est l'entretien, pour rassurer. */}
    <Text style={s.bodyStrong}>Un entretien téléphonique de 15 minutes avec un membre de l’équipe Nūr Meet.</Text>
    <Text style={s.small}>Il est réalisé une seule fois afin de valider votre profil pour les soirées de speed dating. Les événements networking ne nécessitent pas cet entretien.</Text>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {user.profile?.validatedAt ? <Notice kind="success">Votre profil est validé : vous pouvez vous inscrire directement aux soirées.</Notice>
      : !status || status.status == null || status.status === "CANCELLED" ? requestForm
        : status.status === "REFUSED" ? (status.retryAvailableAt && new Date(status.retryAvailableAt) > new Date()
          ? <><Notice kind="error">Votre profil n’a pas été validé.</Notice><Text style={s.small}>Vous pourrez redemander un entretien à partir du {longDate(status.retryAvailableAt)}.</Text></>
          : requestForm)
          : status.status === "PENDING_CALL" && !status.call ? <><CallCalendar onSelect={schedule} schedulingId={schedulingId} />{cancelButton}</>
            : status.call ? <View style={[s.panel, { gap: S[2] }]}>
              <Badge tone="success" label="Entretien programmé" icon={<CheckCircle2 size={13} color={T.success} />} />
              <Text style={s.h2}>{shortDate(status.call.startsAt)}</Text>
              <Text style={s.small}>Un membre de l’équipe Nūr Meet vous appellera à cette heure, puis vous serez informé(e) de la décision.</Text>
              {status.status === "CALL_SCHEDULED" && new Date(status.call.startsAt) > new Date() && (moving
                ? <><CallCalendar title="Choisissez votre nouveau créneau" onSelect={move} schedulingId={schedulingId} exclude={new Date(status.call.startsAt).toISOString()} /><Button small variant="secondary" title="Garder mon créneau actuel" onPress={() => setMoving(false)} /></>
                : <><Button small title="Modifier mon créneau" onPress={() => { setMoving(true); setMessage(null); }} />{cancelButton}</>)}
            </View>
              : <Empty icon={<CalendarDays size={24} color={T.ink3} />} title="Entretien en cours de traitement" />}
  </ScrollView>;
}
