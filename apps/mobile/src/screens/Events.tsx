import { EVENT_CATEGORIES, NETWORKING_QUESTIONS, SCREENING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import { ArrowLeft, CalendarDays, Clock, MapPin, Search, Share2, Store, Ticket, UserCheck, Users } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { api, type ApiError } from "../api";
import { PhoneVerification } from "../components/PhoneVerification";
import { Badge, Button, CategoryBadge, Chip, ConsentCheck, Empty, EventCard, Field, Loading, Notice, Skeleton, ViewerStatusBadge, availabilityLabel, legalLink, priceLabel } from "../components/ui";
import { imgUrl, money, shortDate, when } from "../format";
import { Navigate } from "../links";
import { payByCard } from "../payment";
import { F, R, S, T, s } from "../theme";

// Catalogue (§5, corrections web 2026-09-24) : l'API ne renvoie que les soirées à venir, triées de la
// plus proche à la plus lointaine, avec le statut du visiteur (« Participe déjà », « Liste d'attente »).
export function Events({ user, slug, category: initialCategory, navigate, goBack, onUserChanged }: { user: any; slug?: string; category?: string; navigate: Navigate; goBack: () => void; onUserChanged: () => void }) {
  if (slug) return <EventDetail user={user} slug={slug} navigate={navigate} goBack={goBack} onUserChanged={onUserChanged} />;
  return <EventList initialCategory={initialCategory} navigate={navigate} />;
}

function EventList({ initialCategory, navigate }: { initialCategory?: string; navigate: Navigate }) {
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState(""), [category, setCategory] = useState(initialCategory ?? "");
  const [events, setEvents] = useState<any[] | null>(null), [page, setPage] = useState(1), [totalPages, setTotalPages] = useState(1), [total, setTotal] = useState(0), [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const query = (p: number) => `/events?${new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(category ? { category } : {}), page: String(p), pageSize: "12" })}`;
  useEffect(() => {
    let ignore = false; setEvents(null); setPage(1);
    api<{ items: any[]; totalPages: number; total: number }>(query(1)).then(r => { if (!ignore) { setEvents(r.items); setTotalPages(r.totalPages); setTotal(r.total); } }).catch(() => { if (!ignore) setEvents([]); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query dérive de ces deux valeurs
  }, [debounced, category]);
  const loadMore = async () => {
    setLoadingMore(true);
    try { const r = await api<{ items: any[]; totalPages: number }>(query(page + 1)); setEvents(prev => [...(prev ?? []), ...r.items]); setPage(page + 1); setTotalPages(r.totalPages); } catch { /* bouton disponible pour réessayer */ }
    finally { setLoadingMore(false); }
  };
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.h1} accessibilityRole="header">Les prochaines soirées</Text>
    <Text style={s.body}>Speed dating sur sélection ou networking en accès direct, dans des restaurants partenaires à Paris et en Île-de-France.</Text>
    <View style={[s.input, s.row]}><Search size={18} color={T.ink3} /><TextInput style={{ flex: 1, fontFamily: F.text, fontSize: 16, color: T.ink, minHeight: 48 }} value={q} onChangeText={setQ} placeholder="Rechercher par nom ou quartier" placeholderTextColor={T.ink3} accessibilityLabel="Rechercher une soirée" /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S[2] }}>
      <Chip label="Toutes" active={!category} onPress={() => setCategory("")} />
      {EVENT_CATEGORIES.map(c => <Chip key={c.name} label={c.name} active={category === c.name} onPress={() => setCategory(c.name)} />)}
    </ScrollView>
    {events === null ? [0, 1].map(i => <Skeleton key={i} height={300} />)
      : events.length === 0 ? <Empty icon={<CalendarDays size={24} color={T.ink3} />} title="Aucune soirée ne correspond" text="Essayez un autre mot-clé ou un autre format — de nouvelles dates sont publiées régulièrement." />
        : <>
          <Text style={s.meta}>{total} soirée{total > 1 ? "s" : ""} à venir</Text>
          {events.map(e => <EventCard key={e.id} event={e} onPress={() => navigate({ name: "events", slug: e.slug })} />)}
          {page < totalPages && <Button variant="secondary" title="Afficher plus de soirées" busy={loadingMore} onPress={loadMore} />}
        </>}
  </ScrollView>;
}

function Fact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: S[3], alignItems: "flex-start" }}>{icon}<Text style={[s.small, { flex: 1, color: T.ink }]}>{children}</Text></View>;
}

function EventDetail({ user, slug, navigate, goBack, onUserChanged }: { user: any; slug: string; navigate: Navigate; goBack: () => void; onUserChanged: () => void }) {
  const [event, setEvent] = useState<any>(undefined);
  const [application, setApplication] = useState<any>(null), [waitlistEntry, setWaitlistEntry] = useState<any>(null), [altOffer, setAltOffer] = useState<any>(null);
  const [message, setMessage] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false), [answers, setAnswers] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [acceptCgv, setAcceptCgv] = useState(false);
  const [netAnswers, setNetAnswers] = useState<Record<string, string>>({}), [netDone, setNetDone] = useState(false), [netDismissed, setNetDismissed] = useState(false);
  const [needsPhone, setNeedsPhone] = useState(false);

  const loadEvent = () => api<any>(`/events/${slug}`).then(setEvent).catch(() => setEvent(null));
  const loadMine = (id: string) => {
    api<any>(`/events/${id}/my-application`).then(setApplication).catch(() => setApplication(null));
    api<any>(`/events/${id}/waitlist/me`).then(setWaitlistEntry).catch(() => setWaitlistEntry(null));
    api<any[]>("/me/alternative-offers").then(list => setAltOffer(list.find(o => o.originalEventId === id && o.status === "PENDING") ?? null)).catch(() => {});
  };
  useEffect(() => { loadEvent(); }, [slug]);
  useEffect(() => { if (event?.id) loadMine(event.id); }, [event?.id]);

  if (event === undefined) return <Loading />;
  if (event === null) return <ScrollView contentContainerStyle={s.content}><Empty icon={<CalendarDays size={24} color={T.ink3} />} title="Cette soirée est introuvable" text="Elle a peut-être été retirée, ou le lien est incomplet." /><Button title="Voir les prochaines soirées" onPress={() => navigate({ name: "events" })} /></ScrollView>;

  const requiresScreening = eventRequiresScreening(event);
  const full = event.availability.kind !== "unknown" && event.availability.full;
  const categoryUnknown = event.availability.kind === "unknown";
  const canCancel = application && !["REFUSED", "CANCELLED"].includes(application.status);
  const phoneOk = user.phoneVerified && !needsPhone;
  const refresh = () => { loadEvent(); loadMine(event.id); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await action(); }
    catch (e) {
      const err = e as ApiError;
      if (err.phoneVerificationRequired) setNeedsPhone(true);
      setMessage({ kind: err.notBookable ? "info" : "error", text: err.message });
    }
    finally { setBusy(false); }
  };
  const apply = () => run(async () => {
    const result = await api<any>(`/events/${event.id}/apply`, { method: "POST", body: JSON.stringify(requiresScreening ? { screeningAnswers: answers } : {}) });
    setApplication(result.application); setShowForm(false);
    setMessage({ kind: "success", text: "Inscription enregistrée : vous pouvez régler votre billet ci-dessous." });
  });
  const confirmFree = () => run(async () => {
    const result = await api<{ confirmed: boolean }>(`/applications/${application.id}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) });
    setMessage({ kind: "success", text: result.confirmed ? "Place confirmée ! Votre billet est dans votre espace." : "Votre place a déjà été confirmée." }); refresh();
  });
  const pay = () => run(async () => { await payByCard(application.id, event.id, event.priceCents); refresh(); });
  const cancel = () => run(async () => {
    const result = await api<{ refunded: boolean; refundedAmountCents: number | null; eligible: boolean | null }>(`/me/applications/${application.id}/cancel`, { method: "POST" });
    setMessage({ kind: "success", text: result.refunded ? `Inscription annulée. ${money(result.refundedAmountCents!)} ont été remboursés intégralement.` : result.eligible === false ? "Inscription annulée. Conformément à notre politique, aucun remboursement n’est possible à 24 heures ou moins de l’événement." : "Inscription annulée." });
    refresh();
  });
  const joinWaitlist = () => run(async () => { await api(`/events/${event.id}/waitlist`, { method: "POST" }); refresh(); setMessage({ kind: "success", text: "Vous êtes inscrit(e) sur la liste d’attente." }); });
  const leaveWaitlist = () => run(async () => { await api(`/events/${event.id}/waitlist`, { method: "DELETE" }); refresh(); setMessage({ kind: "success", text: "Vous avez quitté la liste d’attente." }); });
  const respondAlt = (accept: boolean) => run(async () => { await api(`/alternative-offers/${altOffer.id}/respond`, { method: "POST", body: JSON.stringify({ accept }) }); setAltOffer(null); setMessage({ kind: "success", text: accept ? "Place réservée sur la soirée proposée : réglez votre billet depuis votre espace." : "Proposition refusée." }); });
  const submitNetworking = () => run(async () => { await api(`/applications/${application.id}/networking-answers`, { method: "POST", body: JSON.stringify(netAnswers) }); setNetDone(true); });
  const share = async () => {
    try { const link = await api<{ url: string }>(`/events/${event.id}/share-link`, { method: "POST" }); await Share.share({ message: `« ${event.title} » sur Nūr Meet : ${link.url}` }); }
    catch (e) { setMessage({ kind: "error", text: (e as Error).message }); }
  };
  const perks = [event.perks?.drink && "Boisson", event.perks?.starter && "Entrée", event.perks?.main && "Plat", event.perks?.dessert && "Dessert"].filter(Boolean) as string[];
  const ageText = event.minAge && event.maxAge ? `${event.minAge} à ${event.maxAge} ans` : event.minAge ? `${event.minAge} ans et plus` : event.maxAge ? `Jusqu’à ${event.maxAge} ans` : null;

  const booking = (() => {
    if (user.hasRestaurant) return <Notice>Votre compte restaurateur vous permet de découvrir les soirées, mais pas d’y participer.</Notice>;
    if (application) return <View style={{ gap: S[3] }}>
      {application.status === "CONFIRMED" && <Notice kind="success">Votre place est confirmée. Votre billet est dans « Mon espace ».</Notice>}
      {application.status === "CONFIRMED" && !requiresScreening && !application.networkingAnswer && !netDismissed && !netDone && <View style={s.panel}>
        <Text style={s.small}>Facultatif : quelques informations professionnelles pour mieux organiser la soirée.</Text>
        {NETWORKING_QUESTIONS.map(q => <Field key={q.key} label={q.label} multiline value={netAnswers[q.key] ?? ""} onChangeText={v => setNetAnswers({ ...netAnswers, [q.key]: v })} />)}
        <Button small title="Envoyer" busy={busy} onPress={submitNetworking} /><Button small variant="ghost" title="Plus tard" onPress={() => setNetDismissed(true)} />
      </View>}
      {netDone && <Notice kind="success">Merci, vos informations professionnelles ont été enregistrées.</Notice>}
      {application.status === "PAYMENT_PENDING" && <View style={{ gap: S[3] }}>
        {event.viewerStatus === "WAITLIST" ? <Notice>Vous êtes sur la liste d’attente. Dès qu’une place se libère, vous êtes prévenu(e) : elle revient à la première personne qui finalise son paiement.</Notice>
          : <Notice kind="success">{application.reservation ? `Votre place est retenue quelques minutes (jusqu’au ${when(application.reservation.expiresAt)}) : finalisez votre paiement.` : "Vous pouvez régler votre billet dès maintenant."}</Notice>}
        {!phoneOk ? <PhoneVerification onVerified={() => { setNeedsPhone(false); onUserChanged(); }} />
          : event.priceCents === 0 ? <><ConsentCheck checked={acceptCgv} onChange={setAcceptCgv}>J’ai lu et j’accepte les {legalLink("conditions générales de vente", "cgv")}, notamment la politique d’annulation.</ConsentCheck><Button title="Confirmer ma place (gratuit)" busy={busy} disabled={!acceptCgv} onPress={confirmFree} /></>
            : <Button title={`Payer par carte · ${money(event.priceCents)}`} busy={busy} onPress={pay} />}
      </View>}
      {application.call && application.status === "CALL_SCHEDULED" && <Notice>Entretien programmé le {when(application.call.startsAt)} : l’équipe Nūr Meet vous appellera à cette heure.</Notice>}
      {waitlistEntry ? <View style={s.panel}><Badge tone="warning" label="Liste d’attente" /><Text style={s.bodyStrong}>Position {waitlistEntry.rank ?? waitlistEntry.position}</Text><Button small variant="secondary" title="Quitter la liste d’attente" busy={busy} onPress={leaveWaitlist} /></View>
        : full && canCancel && !categoryUnknown ? <Button variant="secondary" title="Rejoindre la liste d’attente" busy={busy} onPress={joinWaitlist} /> : null}
      {canCancel ? <Button variant="ghost" title="Annuler mon inscription" busy={busy} onPress={cancel} /> : <Text style={s.meta}>Cette inscription a été {application.status === "REFUSED" ? "refusée" : "annulée"}.</Text>}
    </View>;
    if (!phoneOk) return <PhoneVerification onVerified={() => { setNeedsPhone(false); onUserChanged(); }} />;
    if (requiresScreening && !user.profile?.validatedAt) return <View style={{ gap: S[3] }}><Notice kind="error">Votre profil doit d’abord être validé lors d’un entretien avec Nūr Meet avant de vous inscrire à un speed dating.</Notice><Button variant="secondary" title="Demander mon entretien" onPress={() => navigate({ name: "espace", tab: "interview" })} /></View>;
    if (categoryUnknown) return <Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cette soirée.</Notice>;
    if (requiresScreening && showForm) return <View style={s.panel}>
      <Text style={s.small}>Vos réponses sont privées : elles servent uniquement à préparer votre entretien et la décision d’acceptation.</Text>
      {SCREENING_QUESTIONS.map(q => <Field key={q.key} label={q.label + (q.key === "noteForOrganizer" ? " (facultatif)" : "")} multiline value={answers[q.key] ?? ""} onChangeText={v => setAnswers({ ...answers, [q.key]: v })} />)}
      <Button title="Envoyer ma candidature" busy={busy} onPress={apply} />
    </View>;
    return <View style={{ gap: S[3] }}>
      {full && <Notice>Cette soirée est complète pour votre catégorie, mais vous pouvez tout de même vous inscrire : au moment de payer, vous serez placé(e) sur liste d’attente et, si possible, une soirée comparable vous sera proposée.</Notice>}
      <Button title="S’inscrire" busy={busy} onPress={() => requiresScreening ? setShowForm(true) : apply()} />
      <Text style={s.meta}>{requiresScreening ? "Le paiement est proposé immédiatement après le questionnaire" : "Le paiement est proposé immédiatement après l’inscription"} ; la place n’est acquise qu’une fois le paiement confirmé.</Text>
    </View>;
  })();

  return <ScrollView contentContainerStyle={[s.content, { paddingTop: 0, paddingHorizontal: 0 }]}>
    <View>
      <Image source={{ uri: imgUrl(event.imageUrl) }} style={{ width: "100%", aspectRatio: 4 / 3, backgroundColor: T.surface2 }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={goBack} style={{ position: "absolute", top: S[3], left: S[3], width: 44, height: 44, borderRadius: 22, backgroundColor: T.surface, alignItems: "center", justifyContent: "center" }}><ArrowLeft size={22} color={T.ink} /></Pressable>
    </View>
    <View style={{ paddingHorizontal: S[5], gap: S[4] }}>
      <View style={[s.row, { flexWrap: "wrap", marginTop: S[4] }]}>
        <CategoryBadge category={event.category} />
        <Badge label={requiresScreening ? "Sur sélection" : "Accès direct"} icon={requiresScreening ? <UserCheck size={13} color={T.ink2} /> : <Ticket size={13} color={T.ink2} />} />
        <ViewerStatusBadge status={event.viewerStatus} />
        {full && <Badge tone="danger" label="Complet" />}
      </View>
      <Text style={s.h1} accessibilityRole="header">{event.title}</Text>
      <View style={[s.panel, { gap: S[3] }]}>
        <Fact icon={<CalendarDays size={18} color={T.saffronInk} />}>{shortDate(event.startsAt)}</Fact>
        <Fact icon={<MapPin size={18} color={T.saffronInk} />}>{event.district} — l’adresse exacte figure sur votre billet, une fois la place confirmée.</Fact>
        <Fact icon={<Users size={18} color={T.saffronInk} />}>{availabilityLabel(event.availability)}{ageText ? ` · ${ageText}` : ""}</Fact>
        {event.organizer?.name && <Fact icon={<Store size={18} color={T.saffronInk} />}>Organisé par {event.organizer.name}{event.venue && event.venue.name !== event.organizer.name ? `, accueilli par ${event.venue.name}` : ""}</Fact>}
        <Fact icon={<Clock size={18} color={T.saffronInk} />}>Annulation gratuite jusqu’à 24 heures avant le début : remboursement intégral automatique.</Fact>
      </View>
      <Text style={s.body}>{event.description}</Text>
      {event.photos?.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S[3] }}>{event.photos.map((url: string, i: number) => <Image key={i} source={{ uri: imgUrl(url) }} accessibilityLabel={`Photo ${i + 1} du lieu`} style={{ width: 220, height: 150, borderRadius: R.md }} />)}</ScrollView>}
      {(perks.length > 0 || event.perks?.description) && <View style={s.panel}><Text style={s.h3}>Compris dans le prix</Text>{perks.length > 0 && <Text style={s.small}>{perks.join(" · ")}</Text>}{event.perks?.description && <Text style={s.small}>{event.perks.description}</Text>}</View>}
      <View style={[s.panel, { gap: S[3] }]} nativeID="reserver">
        <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.h2}>{priceLabel(event)}</Text><Text style={s.meta}>par personne, TTC</Text></View>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        {altOffer && <View style={[s.card, { backgroundColor: T.saffronSoft }]}><Text style={s.bodyStrong}>Soirée similaire proposée : {altOffer.alternativeEvent.title}</Text><Text style={s.meta}>{shortDate(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district} · {altOffer.alternativeEvent.priceCents === 0 ? "Gratuit" : money(altOffer.alternativeEvent.priceCents)}</Text><View style={[s.row, { gap: S[2] }]}><Button small title="Accepter" busy={busy} onPress={() => respondAlt(true)} style={{ flex: 1 }} /><Button small variant="secondary" title="Refuser" onPress={() => respondAlt(false)} style={{ flex: 1 }} /></View></View>}
        {booking}
      </View>
      <Button variant="secondary" title="Inviter un ami" icon={<Share2 size={18} color={T.ink} />} onPress={share} />
    </View>
  </ScrollView>;
}
