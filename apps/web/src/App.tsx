import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { EVENT_CATEGORIES } from "@nour/shared";
import type { PublicEvent, SessionUser } from "@nour/shared";
import { API_URL, api, getToken, setToken } from "./api";

const imgUrl = (src: string) => src.startsWith("http") ? src : `${API_URL}${src}`;

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "");

type AuthState = { user: (SessionUser & {profile?: any}) | null; loading: boolean; refresh: () => Promise<void>; logout: () => void };
const AuthContext = createContext<AuthState>(null as never);
const useAuth = () => useContext(AuthContext);

const money = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const dayLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const APPLICATION_STATUS_LABEL: Record<string,string> = { PENDING_CALL: "En attente de choix d’un créneau", CALL_SCHEDULED: "Entretien programmé", CALL_COMPLETED: "Entretien réalisé", ACCEPTED: "Candidature acceptée", REFUSED: "Candidature refusée", PAYMENT_PENDING: "Acceptée · paiement à finaliser", CONFIRMED: "Place confirmée", CANCELLED: "Annulée", NO_SHOW: "Absence à l’entretien" };
const EVENT_STATUS_LABEL: Record<string,string> = { DRAFT: "Brouillon", PENDING_REVIEW: "En attente de validation", PUBLISHED: "Publié", FULL: "Complet", CANCELLED: "Annulé", COMPLETED: "Terminé" };
const RESTAURANT_STATUS_LABEL: Record<string,string> = { PENDING: "En attente", APPROVED: "Approuvé", REJECTED: "Refusé", SUSPENDED: "Suspendu" };

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { if (!getToken()) { setUser(null); setLoading(false); return; } try { setUser(await api("/me")); } catch { setToken(null); setUser(null); } finally { setLoading(false); } };
  useEffect(() => { refresh(); }, []);
  return <AuthContext.Provider value={{ user, loading, refresh, logout: () => { setToken(null); setUser(null); } }}>{children}</AuthContext.Provider>;
}

function Logo() { return <Link className="logo" to="/"><span>N</span><strong>NŪR <b>MEET</b></strong></Link>; }
function Header() {
  const { user, logout } = useAuth();
  return <header className="site-header"><Logo/><nav><NavLink to="/">Accueil</NavLink><NavLink to="/events">Événements</NavLink>{user && <NavLink to="/dashboard">Mon espace</NavLink>}{user && ["ADMIN","ORGANIZER","MODERATOR","RECEPTION"].includes(user.role) && <NavLink to="/admin">Administration</NavLink>}</nav><div className="header-actions">{user ? <><span className="member-name">{user.displayName}</span><button className="link-button" onClick={logout}>Déconnexion</button></> : <Link className="button small" to="/login">Se connecter</Link>}</div></header>;
}
function Layout({ children }: {children: ReactNode}) { return <><Header/><main>{children}</main><footer><Logo/><p>Paris et Île-de-France · Expérience privée · Données protégées</p></footer></>; }
function Loading() { return <div className="state-page"><div className="spinner"/><h2>Chargement…</h2></div>; }
function Notice({ kind="info", children }: {kind?: "info"|"error"|"success", children: ReactNode}) { return <div className={`notice ${kind}`}>{children}</div>; }
function Protected({ children, roles }: {children: ReactNode; roles?: string[]}) { const {user,loading}=useAuth(); if(loading)return <Loading/>; if(!user)return <Navigate to="/login" replace/>; if(roles&&!roles.includes(user.role))return <Navigate to="/dashboard" replace/>; return <>{children}</>; }

function EventCard({ event }: {event: PublicEvent}) {
  const full=event.confirmedCount>=event.capacity;
  return <article className="event-card"><Link to={`/events/${event.slug}`} className="event-art"><img src={imgUrl(event.imageUrl)} alt={event.title} loading="lazy"/><span className="category-badge">{event.category}</span>{full&&<span className="full-badge">Complet</span>}</Link><div className="event-copy"><small>{dateTime(event.startsAt).toUpperCase()}</small><h3>{event.title}</h3><p>{event.district} · {full?"Complet":`${event.capacity-event.confirmedCount} places restantes`}</p><div><strong>{money(event.priceCents)}</strong><Link to={`/events/${event.slug}`}>Découvrir →</Link></div></div></article>;
}
function Home() {
  const [events,setEvents]=useState<PublicEvent[]>([]); useEffect(()=>{api<PublicEvent[]>("/events").then(setEvents).catch(()=>{})},[]);
  return <Layout><section className="hero"><div><span className="eyebrow">PARIS · ÎLE-DE-FRANCE</span><h1>Des rencontres<br/><em>qui comptent.</em></h1><p>Des événements élégants et confidentiels, pensés pour créer de vraies connexions dans un cadre respectueux.</p><div className="hero-actions"><Link className="button" to="/events">Voir les événements</Link><a className="button secondary" href="#concept">Découvrir le concept</a></div><div className="trust"><span>✓ Profils sélectionnés</span><span>✓ Lieux premium</span><span>✓ Cadre confidentiel</span></div></div><div className="hero-art"><div className="arch"><span>ن</span></div><div className="next-card">{events[0]?<img className="next-thumb" src={imgUrl(events[0].imageUrl)} alt=""/>:<div className="avatar">N</div>}<div><small>PROCHAINE SOIRÉE</small><strong>{events[0]?.title??"Dîner & Connexions"}</strong><span>{events[0]?dateTime(events[0].startsAt):"Samedi · Paris"}</span></div></div></div></section><section className="metrics"><div><strong>420+</strong><span>Membres validés</span></div><div><strong>36</strong><span>Événements organisés</span></div><div><strong>4,8/5</strong><span>Satisfaction</span></div></section><section id="concept" className="section"><div className="section-title"><span className="eyebrow">LE CONCEPT</span><h2>Du réel au numérique, avec votre consentement.</h2></div><div className="feature-grid"><div><b>01</b><h3>Candidature</h3><p>Chaque nouveau membre complète son profil et réserve un court appel.</p></div><div><b>02</b><h3>Rencontre</h3><p>Les événements réunissent 20 à 40 personnes dans un cadre privé.</p></div><div><b>03</b><h3>Contact choisi</h3><p>Un code personnel permet d’envoyer une demande. Le chat s’ouvre après acceptation.</p></div></div></section>{events.length>0&&<section className="section"><div className="section-title row"><div><span className="eyebrow">À VENIR</span><h2>Les prochaines rencontres</h2></div><Link to="/events">Tout afficher →</Link></div><div className="event-grid">{events.slice(0,3).map(e=><EventCard key={e.id} event={e}/>)}</div></section>}</Layout>;
}

function Events() {
  const [events,setEvents]=useState<PublicEvent[]>([]),[q,setQ]=useState(""),[category,setCategory]=useState("");
  useEffect(()=>{api<PublicEvent[]>(`/events?${new URLSearchParams({...(q?{q}:{}),...(category?{category}:{})})}`).then(setEvents)},[q,category]);
  return <Layout><section className="page"><span className="eyebrow">CALENDRIER</span><h1>Trouvez la rencontre qui vous ressemble.</h1><div className="filters"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher un événement"/><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Toutes les catégories</option>{EVENT_CATEGORIES.map(c=><option key={c.name}>{c.name}</option>)}</select></div>{events.length?<div className="event-grid">{events.map(e=><EventCard key={e.id} event={e}/>)}</div>:<div className="empty"><span>◇</span><h2>Aucun événement disponible</h2><p>Modifiez vos filtres ou revenez prochainement.</p></div>}</section></Layout>;
}

function CallCalendar({ slots, loading, onSelect, schedulingId }: { slots: any[]; loading: boolean; onSelect: (id: string) => void; schedulingId: string | null }) {
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const slot of slots) {
      const key = new Date(slot.startsAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [slots]);
  const days = useMemo(() => [...byDay.keys()], [byDay]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  useEffect(() => { if (days.length && !days.includes(activeDay ?? "")) setActiveDay(days[0]); }, [days.join(",")]);
  if (loading) return <div className="calendar-state"><div className="spinner small"/><span>Chargement des disponibilités…</span></div>;
  if (!slots.length) return <div className="calendar-state empty-slots"><span>◇</span><p>Aucun créneau disponible pour le moment. L’organisateur n’a pas encore publié de disponibilités pour cet événement.</p></div>;
  return <div className="calendar"><h3>Choisissez votre appel</h3><div className="calendar-days">{days.map(day => <button type="button" key={day} className={day===activeDay?"active":""} onClick={()=>setActiveDay(day)}><strong>{dayLabel(day)}</strong></button>)}</div><div className="calendar-slots">{(byDay.get(activeDay ?? "")??[]).map(s => <button type="button" key={s.id} disabled={schedulingId===s.id} onClick={()=>onSelect(s.id)}>{timeLabel(s.startsAt)}{schedulingId===s.id?<i className="mini-spinner"/>:null}</button>)}</div></div>;
}

function PaymentForm({ amountCents, onSuccess, onCancel }: { amountCents: number; onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setError("");
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (confirmError) { setError(confirmError.message ?? "Le paiement a été refusé."); setSubmitting(false); return; }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) { onSuccess(); return; }
    setError("Le paiement n’a pas pu être confirmé."); setSubmitting(false);
  };
  return <form onSubmit={submit} className="payment-form">
    <PaymentElement/>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="payment-actions">
      <button type="button" className="button secondary" onClick={onCancel} disabled={submitting}>Annuler</button>
      <button type="submit" className="button" disabled={!stripe || submitting}>{submitting?"Traitement…":`Payer ${money(amountCents)}`}</button>
    </div>
  </form>;
}

function PaymentModal({ reservationId, eventId, amountCents, onClose, onConfirmed }: { reservationId: string; eventId: string; amountCents: number; onClose: () => void; onConfirmed: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "confirming" | "success" | "timeout">("loading");

  useEffect(() => {
    api<{ clientSecret: string }>(`/reservations/${reservationId}/payment-intent`, { method: "POST" })
      .then(r => { setClientSecret(r.clientSecret); setPhase("ready"); })
      .catch(err => setError((err as Error).message));
  }, [reservationId]);

  const handleSuccess = async () => {
    setPhase("confirming");
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const application = await api<any>(`/events/${eventId}/my-application`);
        if (application.status === "CONFIRMED") { setPhase("success"); setTimeout(onConfirmed, 1200); return; }
      } catch { /* on retente */ }
    }
    setPhase("timeout");
  };

  return <div className="modal-overlay" role="dialog" aria-modal="true">
    <div className="modal payment-modal">
      <div className="modal-head"><h2>Paiement sécurisé</h2><button type="button" className="link-button" onClick={onClose} aria-label="Fermer">×</button></div>
      <p className="payment-amount">Montant à régler : <b>{money(amountCents)}</b></p>
      {error && <Notice kind="error">{error}</Notice>}
      {phase === "loading" && <div className="calendar-state"><div className="spinner small"/><span>Chargement du module de paiement…</span></div>}
      {phase === "confirming" && <div className="calendar-state"><div className="spinner small"/><span>Confirmation du paiement…</span></div>}
      {phase === "success" && <Notice kind="success">Paiement confirmé ! Votre billet est prêt.</Notice>}
      {phase === "timeout" && <><Notice kind="error">Le paiement est en cours de confirmation. Actualisez la page dans un instant.</Notice><button className="button full" onClick={onClose}>Fermer</button></>}
      {phase === "ready" && clientSecret && <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#cba969" } } }}>
        <PaymentForm amountCents={amountCents} onSuccess={handleSuccess} onCancel={onClose}/>
      </Elements>}
    </div>
  </div>;
}

function ApplicationStatusPanel({ application, event, onPaid }: { application: any; event: PublicEvent; onPaid: () => void }) {
  const [showPayment, setShowPayment] = useState(false);
  if (application.status === "REFUSED") return <Notice kind="error">Votre candidature n’a pas été retenue pour cet événement.</Notice>;
  if (application.status === "CANCELLED") return <Notice kind="error">Cette candidature a été annulée.</Notice>;
  if (application.status === "CONFIRMED") return <Notice kind="success">Votre place est confirmée. Retrouvez votre billet dans votre espace personnel.</Notice>;
  if (application.status === "PAYMENT_PENDING" && application.reservation) return <div className="payment-block">
    <Notice kind="success">Candidature acceptée ! Finalisez votre place avant le {dateTime(application.reservation.expiresAt)}.</Notice>
    <button className="button full" onClick={() => setShowPayment(true)}>Payer par carte · {money(event.priceCents)}</button>
    {showPayment && <PaymentModal reservationId={application.reservation.id} eventId={event.id} amountCents={event.priceCents} onClose={() => setShowPayment(false)} onConfirmed={() => { setShowPayment(false); onPaid(); }}/>}
  </div>;
  if (application.call) return <div className="call-scheduled"><span className="eyebrow">ENTRETIEN PROGRAMMÉ</span><strong>{dateTime(application.call.startsAt)}</strong><p>L’organisateur vous appellera à cette heure, puis vous serez informé(e) de sa décision.</p></div>;
  return null;
}

function EventDetail() {
  const {id}=useParams(); const {user}=useAuth();
  const [event,setEvent]=useState<PublicEvent|null>(null);
  const [motivation,setMotivation]=useState("");
  const [application,setApplication]=useState<any>(null);
  const [loadingApplication,setLoadingApplication]=useState(true);
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [schedulingId,setSchedulingId]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success"|"info";text:string}|null>(null);
  const [waitlistEntry,setWaitlistEntry]=useState<any>(null);
  const [altOffer,setAltOffer]=useState<any>(null);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{api<PublicEvent>(`/events/${id}`).then(setEvent)},[id]);

  useEffect(()=>{
    if(!user||!event){setLoadingApplication(false);return}
    let ignore=false; setLoadingApplication(true);
    api<any>(`/events/${event.id}/my-application`).then(a=>!ignore&&setApplication(a)).catch(()=>!ignore&&setApplication(null)).finally(()=>!ignore&&setLoadingApplication(false));
    api<any>(`/events/${event.id}/waitlist/me`).then(w=>!ignore&&setWaitlistEntry(w)).catch(()=>!ignore&&setWaitlistEntry(null));
    api<any[]>("/me/alternative-offers").then(list=>{if(ignore)return;setAltOffer(list.find(o=>o.originalEventId===event.id&&o.status==="PENDING")??null)}).catch(()=>{});
    return ()=>{ignore=true};
  },[user,event?.id]);

  useEffect(()=>{
    if(!event||!application||application.status!=="PENDING_CALL"||application.call){setSlots([]);return}
    let ignore=false; setLoadingSlots(true);
    api<any[]>(`/events/${event.id}/call-slots`).then(s=>!ignore&&setSlots(s)).catch(()=>!ignore&&setSlots([])).finally(()=>!ignore&&setLoadingSlots(false));
    return ()=>{ignore=true};
  },[event?.id,application?.id,application?.status]);

  if(!event)return <Layout><Loading/></Layout>;

  const myQuota = event.quotas.length>0 ? event.quotas.find(q=>q.category===user?.profile?.quotaCategory) ?? null : null;
  const categoryUnknown = event.quotas.length>0 && !user?.profile?.quotaCategory;
  const bucketFull = event.quotas.length>0 ? (myQuota ? myQuota.heldCount>=myQuota.capacity : false) : event.confirmedCount>=event.capacity;
  const canCancel = application && !["REFUSED","CANCELLED"].includes(application.status);

  const refreshApplication=()=>api<any>(`/events/${event.id}/my-application`).then(setApplication).catch(()=>{});

  const apply=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    try{const a=await api<any>(`/events/${event.id}/apply`,{method:"POST",body:JSON.stringify({motivation})});setApplication(a)}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const schedule=async(slotId:string)=>{
    setSchedulingId(slotId);setNotice(null);
    try{
      const result=await api<any>(`/applications/${application.id}/schedule`,{method:"POST",body:JSON.stringify({slotId})});
      setApplication({...application,status:"CALL_SCHEDULED",call:result.slot});
      setNotice({kind:"success",text:"Votre entretien est confirmé."});
    }catch(err){
      setNotice({kind:"error",text:(err as Error).message});
      api<any[]>(`/events/${event.id}/call-slots`).then(setSlots).catch(()=>{});
    }finally{setSchedulingId(null)}
  };
  const joinWaitlist=async()=>{
    setBusy(true);setNotice(null);
    try{setWaitlistEntry(await api<any>(`/events/${event.id}/waitlist`,{method:"POST"}));setNotice({kind:"success",text:"Vous êtes inscrit(e) sur la liste d’attente."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const leaveWaitlist=async()=>{
    setBusy(true);setNotice(null);
    try{await api(`/events/${event.id}/waitlist`,{method:"DELETE"});setWaitlistEntry(null);setNotice({kind:"success",text:"Vous avez quitté la liste d’attente."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const cancelApplication=async()=>{
    if(!application)return;
    setBusy(true);setNotice(null);
    try{await api(`/me/applications/${application.id}/cancel`,{method:"POST"});setNotice({kind:"success",text:"Votre candidature a été annulée."});await refreshApplication();setWaitlistEntry(null)}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const respondAltOffer=async(accept:boolean)=>{
    if(!altOffer)return;
    setBusy(true);setNotice(null);
    try{await api(`/alternative-offers/${altOffer.id}/respond`,{method:"POST",body:JSON.stringify({accept})});setAltOffer(null);setNotice({kind:"success",text:accept?"Place réservée sur l’événement alternatif : consultez votre espace personnel pour payer.":"Proposition refusée."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  return <Layout><section className="event-hero" style={{backgroundImage:`linear-gradient(180deg,#0b0b0cb0,#0b0b0ce6),url(${imgUrl(event.imageUrl)})`}}><span className="eyebrow">{event.category.toUpperCase()}</span><h1>{event.title}</h1><p>{event.description}</p></section><section className="event-layout"><article><div className="facts"><div><small>DATE</small><b>{dateTime(event.startsAt)}</b></div><div><small>LIEU</small><b>{event.district}</b></div><div><small>CAPACITÉ</small><b>{event.capacity} participants</b></div></div>{event.quotas.length>0&&<div className="quota-breakdown"><small>PLACES PAR CATÉGORIE</small><div className="quota-rows">{event.quotas.map(q=><div key={q.category} className="quota-row"><span>{q.category==="HOMME"?"Hommes":"Femmes"}</span><b>{q.heldCount>=q.capacity?"Complet":`${q.capacity-q.heldCount} places`}</b></div>)}</div></div>}<h2>Une expérience pensée pour de vraies rencontres</h2><p>Accueil personnalisé, animation légère, temps libres et respect de la confidentialité. Une boisson est incluse avec le billet.</p><ul><li>Profils sélectionnés</li><li>QR code d’entrée unique</li><li>Code de contact privé</li><li>Équipe présente sur place</li></ul></article><aside className="booking"><small>À PARTIR DE</small><strong>{money(event.priceCents)}</strong><div><span>Disponibilité</span><b>{event.quotas.length>0?(myQuota?(bucketFull?"Complet pour votre catégorie":`${myQuota.capacity-myQuota.heldCount} places pour vous`):"Places selon catégorie"):(bucketFull?"Complet":`${event.capacity-event.confirmedCount} places`)}</b></div>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}{application&&<p className="fine status-line">Statut : <b>{APPLICATION_STATUS_LABEL[application.status]??application.status}</b></p>}
    {altOffer&&<div className="alt-offer"><span className="eyebrow">ÉVÉNEMENT ALTERNATIF PROPOSÉ</span><h3>{altOffer.alternativeEvent.title}</h3><p>{dateTime(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</p><p><b>{money(altOffer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busy} onClick={()=>respondAltOffer(true)}>Accepter</button><button className="button secondary" disabled={busy} onClick={()=>respondAltOffer(false)}>Refuser</button></div></div>}
    {!user?<Link className="button full" to="/login">Se connecter pour candidater</Link>
    :loadingApplication?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
    :application?<>
      {application.status==="PENDING_CALL"&&!application.call?<CallCalendar slots={slots} loading={loadingSlots} onSelect={schedule} schedulingId={schedulingId}/>:<ApplicationStatusPanel application={application} event={event} onPaid={refreshApplication}/>}
      {waitlistEntry?<div className="waitlist-status"><span className="eyebrow">LISTE D’ATTENTE</span><p>Position {waitlistEntry.rank??waitlistEntry.position}{waitlistEntry.offeredAt?" — une place vous a été proposée, consultez votre espace personnel":""}</p><button className="button secondary small" disabled={busy} onClick={leaveWaitlist}>Quitter la liste d’attente</button></div>
      :(categoryUnknown?<Notice kind="error">Complétez votre catégorie dans votre profil pour rejoindre la liste d’attente.</Notice>:(bucketFull&&canCancel&&<button className="button secondary full" disabled={busy} onClick={joinWaitlist}>Rejoindre la liste d’attente</button>))}
      {canCancel&&<button className="button danger full" disabled={busy} onClick={cancelApplication}>Annuler ma candidature</button>}
    </>
    :categoryUnknown?<Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de candidater à cet événement.</Notice>
    :<form onSubmit={apply}>{bucketFull&&<Notice kind="info">Cet événement est complet pour votre catégorie, mais vous pouvez tout de même candidater : une liste d’attente et une éventuelle proposition alternative vous seront proposées.</Notice>}<label>Votre motivation<textarea required minLength={30} value={motivation} onChange={e=>setMotivation(e.target.value)} placeholder="Expliquez en quelques lignes ce que vous recherchez…"/></label><button className="button full">Envoyer ma candidature</button></form>}
    <p className="fine">Le paiement est proposé uniquement après acceptation.</p></aside></section></Layout>;
}

function Login() {
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2>(1),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null); const {refresh}=useAuth(); const navigate=useNavigate();
  const submit=async(e:FormEvent)=>{e.preventDefault();setError("");try{if(step===1){const result=await api<{delivery:"mock"|"sms";devCode?:string}>("/auth/request-otp",{method:"POST",body:JSON.stringify({phone})});setDevCode(result.devCode??null);setStep(2)}else{const result=await api<{token:string}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone,code})});setToken(result.token);await refresh();navigate("/dashboard")}}catch(err){setError((err as Error).message)}};
  return <Layout><section className="auth-page"><div className="auth-visual"><blockquote>« Une belle rencontre commence par un cadre de confiance. »</blockquote></div><form className="auth-form" onSubmit={submit}><span className="eyebrow">CONNEXION SÉCURISÉE</span><h1>{step===1?"Votre numéro ouvre la porte.":"Entrez le code reçu."}</h1><p>{step===1?"Aucun mot de passe à mémoriser.":`Code envoyé au ${phone}`}</p>{error&&<Notice kind="error">{error}</Notice>}{step===1?<label>Numéro de téléphone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+33612345678" autoComplete="tel" inputMode="tel" required/></label>:<label>Code à six chiffres<input className="otp-input" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••••" autoComplete="one-time-code" inputMode="numeric" required/></label>}<button className="button full">{step===1?"Recevoir mon code":"Vérifier le code"}</button>{devCode&&<div className="demo-box"><b>Mode local — aucun SMS facturé</b><span>Code de développement : {devCode}</span></div>}</form></section></Layout>;
}

function ProfileEditor({onSaved}:{onSaved:()=>void}) {
  const {user}=useAuth(); const [form,setForm]=useState({displayName:user?.displayName??"",email:user?.email??"",birthDate:"1992-06-14",city:user?.profile?.city??"",profession:user?.profile?.profession??"",interests:(user?.profile?.interests??[]).join(", "),bio:user?.profile?.bio??"",quotaCategory:user?.profile?.quotaCategory??""});const [message,setMessage]=useState("");
  const save=async(e:FormEvent)=>{e.preventDefault();await api("/me/profile",{method:"PATCH",body:JSON.stringify({...form,email:form.email||null,quotaCategory:form.quotaCategory||null,interests:form.interests.split(",").map((x:string)=>x.trim()).filter(Boolean)})});setMessage("Profil enregistré.");onSaved()};
  return <form className="panel form-grid" onSubmit={save}><div className="panel-title"><h2>Mon profil</h2><span>Informations privées</span></div>{message&&<Notice kind="success">{message}</Notice>}<label>Prénom ou pseudonyme<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label><label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Date de naissance<input type="date" value={form.birthDate} onChange={e=>setForm({...form,birthDate:e.target.value})}/></label><label>Ville<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label><label>Profession<input value={form.profession} onChange={e=>setForm({...form,profession:e.target.value})}/></label><label>Centres d’intérêt<input value={form.interests} onChange={e=>setForm({...form,interests:e.target.value})}/></label><label>Catégorie (pour les événements avec quotas, ex. speed dating)<select value={form.quotaCategory} onChange={e=>setForm({...form,quotaCategory:e.target.value})}><option value="">Non renseignée</option><option value="HOMME">Homme</option><option value="FEMME">Femme</option></select></label><label className="wide">Biographie<textarea value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})}/></label><button className="button">Enregistrer</button></form>;
}

function RestaurantApplication() {
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({name:"",description:"",district:"",address:"",phone:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [submitting,setSubmitting]=useState(false);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({name:r.name??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
  useEffect(()=>{load()},[]);

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{await api("/restaurants/apply",{method:"POST",body:JSON.stringify(form)});setNotice({kind:"success",text:"Votre demande a été envoyée."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };

  if(loading) return <Loading/>;
  if(restaurant?.status==="PENDING") return <div className="panel"><Notice kind="info">Votre demande pour « {restaurant.name} » est en cours d’examen.</Notice></div>;
  if(restaurant?.status==="APPROVED") return <div className="panel"><Notice kind="success">Votre établissement « {restaurant.name} » est approuvé. <Link to="/admin">Accéder à mon espace restaurateur →</Link></Notice></div>;

  return <form className="panel form-grid" onSubmit={submit}>
    <div className="panel-title"><h2>Devenir restaurateur</h2><span>Ouvrir un compte professionnel</span></div>
    {restaurant?.status==="REJECTED"&&<Notice kind="error">Votre précédente demande n’a pas été retenue{restaurant.rejectionReason?` : ${restaurant.rejectionReason}`:"."} Vous pouvez soumettre une nouvelle demande.</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <label>Nom de l’établissement<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label>Téléphone professionnel<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
    <label>Quartier / ville<input value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
    <label>Adresse<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
    <label className="wide">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <button className="button" disabled={submitting}>{submitting?"Envoi…":"Envoyer ma demande"}</button>
  </form>;
}

function Dashboard() {
  const {user,refresh}=useAuth(); const [apps,setApps]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[notifications,setNotifications]=useState<any[]>([]),[offers,setOffers]=useState<any[]>([]),[tab,setTab]=useState("reservations"),[payingFor,setPayingFor]=useState<{reservationId:string;eventId:string;amountCents:number}|null>(null),[busyId,setBusyId]=useState<string|null>(null),[message,setMessage]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/me/applications"),api<any[]>("/me/tickets"),api<any[]>("/notifications"),api<any[]>("/me/alternative-offers")]).then(([a,t,n,o])=>{setApps(a);setTickets(t);setNotifications(n);setOffers(o)}); useEffect(()=>{load()},[]);
  const pendingOffers=offers.filter(o=>o.status==="PENDING");
  const cancelApplication=async(appId:string)=>{
    setBusyId(appId);setMessage(null);
    try{await api(`/me/applications/${appId}/cancel`,{method:"POST"});setMessage({kind:"success",text:"Candidature annulée."});await load()}
    catch(err){setMessage({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const respondOffer=async(offerId:string, accept:boolean)=>{
    setBusyId(offerId);setMessage(null);
    try{await api(`/alternative-offers/${offerId}/respond`,{method:"POST",body:JSON.stringify({accept})});setMessage({kind:"success",text:accept?"Place réservée : réglez votre billet avant expiration.":"Proposition refusée."});await load()}
    catch(err){setMessage({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const tabs=[["reservations","Réservations"],["tickets","Billets"],["alternatives",`Propositions${pendingOffers.length?` (${pendingOffers.length})`:""}`],["profile","Profil"],["notifications","Notifications"],["contacts","Contacts et messages"],...(user?.role==="PARTICIPANT"?[["restaurant","Devenir restaurateur"]]:[])];
  const titles:Record<string,string>={reservations:"Mes événements",tickets:"Mes billets",alternatives:"Propositions alternatives",profile:"Mon profil",notifications:"Notifications",contacts:"Contacts et messages",restaurant:"Devenir restaurateur"};
  return <Layout><section className="dashboard-shell"><aside><div className="profile-card"><div className="avatar large">{user?.displayName?.slice(0,2).toUpperCase()}</div><h3>{user?.displayName}</h3><span>{user?.profile?.validatedAt?"Profil validé":"Profil à compléter"}</span></div>{tabs.map(([id,label])=><button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}<span>›</span></button>)}</aside><div className="dashboard-content"><span className="eyebrow">ESPACE PARTICIPANT</span><h1>{titles[tab]}</h1>{message&&<Notice kind={message.kind}>{message.text}</Notice>}{tab==="reservations"&&<div className="stack">{apps.map(a=><article className="reservation" key={a.id}><div className="date-box"><strong>{new Date(a.event.startsAt).getDate()}</strong><span>{new Date(a.event.startsAt).toLocaleString("fr-FR",{month:"short"}).toUpperCase()}</span></div><div><small>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</small><h3>{a.event.title}</h3><p>{dateTime(a.event.startsAt)} · {a.event.district}</p>{a.call&&a.status==="CALL_SCHEDULED"&&<p className="call-hint">Entretien : {dateTime(a.call.startsAt)}</p>}</div><div className="reservation-actions">{a.status==="PAYMENT_PENDING"&&a.reservation&&<button className="button" onClick={()=>setPayingFor({reservationId:a.reservation.id,eventId:a.event.id,amountCents:a.event.priceCents})}>Payer par carte · {money(a.event.priceCents)}</button>}{!["REFUSED","CANCELLED"].includes(a.status)&&<button className="button secondary small" disabled={busyId===a.id} onClick={()=>cancelApplication(a.id)}>Annuler</button>}</div></article>)}</div>}{tab==="tickets"&&<div className="ticket-grid">{tickets.map(t=><article className="ticket" key={t.id}><div><span className="eyebrow">{new Date(t.reservation.event.startsAt).toLocaleDateString("fr-FR")}</span><h2>{t.reservation.event.title}</h2><p>{t.reservation.event.district}</p></div><img src={t.qrDataUrl} alt={`QR code du billet ${t.code}`}/><b>{t.code}</b></article>)}</div>}{tab==="alternatives"&&<div className="stack">{offers.length===0?<div className="empty small"><span>◇</span><p>Aucune proposition pour le moment.</p></div>:offers.map(o=><article key={o.id} className="alt-offer"><span className="eyebrow">{o.status==="PENDING"?"EN ATTENTE DE VOTRE RÉPONSE":o.status==="ACCEPTED"?"ACCEPTÉE":o.status==="DECLINED"?"REFUSÉE":"EXPIRÉE"}</span><h3>{o.alternativeEvent.title}</h3><p>À la place de « {o.originalEvent.title} »</p><p>{dateTime(o.alternativeEvent.startsAt)} · {o.alternativeEvent.district}</p><p><b>{money(o.alternativeEvent.priceCents)}</b></p>{o.status==="PENDING"&&<div className="decision-buttons"><button className="button" disabled={busyId===o.id} onClick={()=>respondOffer(o.id,true)}>Accepter</button><button className="button secondary" disabled={busyId===o.id} onClick={()=>respondOffer(o.id,false)}>Refuser</button></div>}</article>)}</div>}{tab==="profile"&&<ProfileEditor onSaved={refresh}/>} {tab==="notifications"&&<div className="stack">{notifications.map(n=><article className="notification" key={n.id}><i/><div><h3>{n.title}</h3><p>{n.body}</p><small>{dateTime(n.createdAt)}</small></div></article>)}</div>}{tab==="contacts"&&<Messages/>}{tab==="restaurant"&&<RestaurantApplication/>}</div></section>
  {payingFor&&<PaymentModal reservationId={payingFor.reservationId} eventId={payingFor.eventId} amountCents={payingFor.amountCents} onClose={()=>setPayingFor(null)} onConfirmed={()=>{setPayingFor(null);load()}}/>}
  </Layout>;
}

function Messages() {
  const [conversations,setConversations]=useState<any[]>([]),[active,setActive]=useState<any>(null),[messages,setMessages]=useState<any[]>([]),[body,setBody]=useState(""); const {user}=useAuth();
  useEffect(()=>{api<any[]>("/conversations").then(c=>{setConversations(c);if(c[0])open(c[0])})},[]);
  const open=async(c:any)=>{setActive(c);setMessages(await api(`/conversations/${c.id}/messages`))};
  const send=async(e:FormEvent)=>{e.preventDefault();if(!body.trim())return;const m=await api<any>(`/conversations/${active.id}/messages`,{method:"POST",body:JSON.stringify({body})});setMessages([...messages,m]);setBody("")};
  const other=(c:any)=>c.members.find((m:any)=>m.userId!==user?.id)?.user;
  return <div className="messages"><aside>{conversations.map(c=><button key={c.id} className={active?.id===c.id?"active":""} onClick={()=>open(c)}><div className="avatar">{other(c)?.displayName.slice(0,2).toUpperCase()}</div><div><b>{other(c)?.displayName}</b><span>{c.messages[0]?.body??"Nouvelle conversation"}</span></div></button>)}</aside><section>{active?<><div className="chat-head"><div className="avatar">{other(active)?.displayName.slice(0,2).toUpperCase()}</div><div><b>{other(active)?.displayName}</b><span>Contact accepté</span></div></div><div className="chat-body">{messages.map(m=><div key={m.id} className={`bubble ${m.senderId===user?.id?"mine":""}`}>{m.body}<small>{new Date(m.createdAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</small></div>)}</div><form className="chat-input" onSubmit={send}><input value={body} onChange={e=>setBody(e.target.value)} placeholder="Votre message…"/><button>Envoyer</button></form></>:<div className="empty"><h3>Aucune conversation</h3></div>}</section></div>;
}

function Admin() {
  const {user}=useAuth();
  const [stats,setStats]=useState<any>(null); useEffect(()=>{api("/admin/dashboard").then(setStats)},[]);
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><div className="admin-heading"><div><span className="eyebrow">{user?.role==="ADMIN"?"SUPER-ADMINISTRATION":"ESPACE RESTAURATEUR"}</span><h1>Tableau de bord {user?.role==="ADMIN"?"général":"de mon établissement"}</h1></div></div>{!stats?<Loading/>:<><div className="stat-grid"><Stat label="Événements actifs" value={stats.events}/><Stat label="Candidatures" value={stats.applications}/><Stat label="Revenus" value={money(stats.revenueCents)}/>{stats.openReports!=null&&<Stat label="Signalements ouverts" value={stats.openReports}/>}</div><div className="admin-grid"><div className="panel chart"><div className="panel-title"><h2>Activité sur 30 jours</h2><span>Données de démonstration</span></div><div className="bars">{[32,50,42,68,60,82,75,94,70,85,97,88].map((n,i)=><i key={i} style={{height:`${n}%`}}/>)}</div></div><div className="panel quick"><h2>Actions rapides</h2><Link to="/admin/applications">Traiter les candidatures <span>→</span></Link><Link to="/admin/scanner">Scanner un billet <span>→</span></Link>{user?.role==="ADMIN"&&<Link to="/admin/restaurants">Demandes restaurateurs <span>→</span></Link>}<Link to="/events">Voir les événements <span>→</span></Link></div></div></>}</div></section></Layout>;
}
function Stat({label,value}:{label:string;value:string|number}){return <div className="stat"><small>{label.toUpperCase()}</small><strong>{value}</strong><span>Mis à jour maintenant</span></div>}
function AdminNav(){
  const {user}=useAuth();
  return <aside className="admin-nav"><Logo/><NavLink end to="/admin">Vue générale</NavLink><NavLink to="/admin/applications">Candidatures</NavLink><NavLink to="/admin/availability">Disponibilités</NavLink><NavLink to="/admin/events">Mes événements</NavLink><NavLink to="/admin/scanner">Scanner les billets</NavLink>{user?.role==="ADMIN"&&<NavLink to="/admin/restaurants">Demandes restaurateurs</NavLink>}<Link to="/events">Événements publics</Link></aside>;
}

function AdminApplications() {
  const [items,setItems]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[message,setMessage]=useState(""); const load=()=>api<any[]>("/admin/applications").then(v=>{setItems(v);if(selected)setSelected(v.find(x=>x.id===selected.id))});useEffect(()=>{load()},[]);
  const decide=async(accept:boolean)=>{await api(`/admin/applications/${selected.id}/decision`,{method:"POST",body:JSON.stringify({accept,notes:"Décision prise depuis l’administration."})});setMessage(accept?"Candidature acceptée et réservation créée.":"Candidature refusée.");await load()};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Candidatures</h1>{message&&<Notice kind="success">{message}</Notice>}<div className="applications-layout"><div className="panel table"><div className="table-row head"><span>Candidat</span><span>Événement</span><span>Statut</span></div>{items.map(a=><button key={a.id} onClick={()=>setSelected(a)} className={`table-row ${selected?.id===a.id?"selected":""}`}><span><b>{a.user.displayName}</b><small>{a.user.profile?.city}</small></span><span>{a.event.title}</span><span>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</span></button>)}</div><aside className="panel candidate-detail">{selected?<><div className="avatar large">{selected.user.displayName.slice(0,2).toUpperCase()}</div><h2>{selected.user.displayName}</h2><p>{selected.user.profile?.profession} · {selected.user.profile?.city}</p><hr/><small>MOTIVATION</small><blockquote>{selected.motivation}</blockquote><small>CENTRES D’INTÉRÊT</small><div className="chips">{selected.user.profile?.interests.map((x:string)=><span key={x}>{x}</span>)}</div><small>ENTRETIEN</small><p>{selected.call?dateTime(selected.call.startsAt):"Aucun créneau réservé pour le moment"}</p>{!["CONFIRMED","REFUSED","PAYMENT_PENDING"].includes(selected.status)&&<div className="decision-buttons"><button className="button" onClick={()=>decide(true)}>Accepter</button><button className="button danger" onClick={()=>decide(false)}>Refuser</button></div>}</>:<div className="empty"><h3>Sélectionnez une candidature</h3></div>}</aside></div></div></section></Layout>;
}

function AdminEventPhotos() {
  const {user}=useAuth();
  const [events,setEvents]=useState<any[]>([]);
  const [uploadingFor,setUploadingFor]=useState<string|null>(null);
  const [actingOn,setActingOn]=useState<string|null>(null);
  const [rejectNoteFor,setRejectNoteFor]=useState<string|null>(null);
  const [rejectNote,setRejectNote]=useState("");
  const [quotaEditFor,setQuotaEditFor]=useState<string|null>(null);
  const [quotaForm,setQuotaForm]=useState({homme:0,femme:0});
  const [cancelConfirmFor,setCancelConfirmFor]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/events").then(setEvents);
  useEffect(()=>{load()},[]);

  const openQuotaEditor=(ev:any)=>{
    const homme=ev.quotas?.find((q:any)=>q.category==="HOMME")?.capacity??0;
    const femme=ev.quotas?.find((q:any)=>q.category==="FEMME")?.capacity??0;
    setQuotaForm({homme,femme});setQuotaEditFor(ev.id);
  };
  const saveQuotas=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/quotas`,{method:"POST",body:JSON.stringify(quotaForm)});setNotice({kind:"success",text:"Quotas mis à jour."});setQuotaEditFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const cancelEvent=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{const res=await api<any>(`/admin/events/${eventId}/cancel`,{method:"POST"});setNotice({kind:"success",text:`Événement annulé.${res.paidReservationsToRefund?` ${res.paidReservationsToRefund} paiement(s) à rembourser manuellement.`:""}`});setCancelConfirmFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const upload=async(eventId:string, file:File)=>{
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setNotice({kind:"error",text:"Format non pris en charge (jpeg, png ou webp uniquement)."});return}
    if(file.size>5*1024*1024){setNotice({kind:"error",text:"Image trop volumineuse (5 Mo maximum)."});return}
    setUploadingFor(eventId);setNotice(null);
    try{
      const form=new FormData();form.append("file",file);
      await api(`/admin/events/${eventId}/image`,{method:"POST",body:form});
      setNotice({kind:"success",text:"Photo mise à jour."});
      await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setUploadingFor(null)}
  };

  const submitForReview=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/submit-for-review`,{method:"POST"});setNotice({kind:"success",text:"Événement soumis à validation."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const reviewDecision=async(eventId:string, accept:boolean, note?:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/review-decision`,{method:"POST",body:JSON.stringify({accept,note})});setNotice({kind:"success",text:accept?"Événement publié.":"Événement renvoyé en brouillon."});setRejectNoteFor(null);setRejectNote("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Mes événements</h1><p className="fine left">Formats acceptés : JPEG, PNG, WEBP · 5 Mo maximum. Sans photo personnalisée, l’illustration de la catégorie est utilisée.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="event-photo-grid">{events.map(ev=><div key={ev.id} className="panel event-photo-card"><img src={imgUrl(ev.imageUrl)} alt={ev.title}/><div><b>{ev.title}</b><small>{ev.category} · {EVENT_STATUS_LABEL[ev.status]??ev.status}</small>
      <label className="button small secondary">{uploadingFor===ev.id?"Envoi…":"Changer la photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id} onChange={e=>{const f=e.target.files?.[0];if(f)upload(ev.id,f);e.target.value=""}}/></label>
      {user?.role==="ORGANIZER"&&ev.status==="DRAFT"&&<button className="button small" disabled={actingOn===ev.id} onClick={()=>submitForReview(ev.id)}>{actingOn===ev.id?"Envoi…":"Soumettre à validation"}</button>}
      {user?.role==="ADMIN"&&ev.status==="PENDING_REVIEW"&&<div className="review-actions">
        <button className="button small" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,true)}>Publier</button>
        {rejectNoteFor===ev.id?<div className="reject-note"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Motif (optionnel)"/><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,false,rejectNote)}>Confirmer le refus</button></div>:<button className="button small danger" onClick={()=>setRejectNoteFor(ev.id)}>Renvoyer en brouillon</button>}
      </div>}
      {ev.category==="Speed dating"&&<div className="quota-editor">
        {quotaEditFor===ev.id?<><div className="time-row"><label>Hommes<input type="number" min={0} value={quotaForm.homme} onChange={e=>setQuotaForm({...quotaForm,homme:Number(e.target.value)})}/></label><label>Femmes<input type="number" min={0} value={quotaForm.femme} onChange={e=>setQuotaForm({...quotaForm,femme:Number(e.target.value)})}/></label></div><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveQuotas(ev.id)}>Enregistrer les quotas</button></>
        :<button className="button small secondary" onClick={()=>openQuotaEditor(ev)}>{ev.quotas?.length?"Modifier les quotas":"Définir des quotas"}</button>}
        {ev.quotas?.length>0&&<p className="fine left">{ev.quotas.map((q:any)=>`${q.category==="HOMME"?"Hommes":"Femmes"} : ${q.heldCount}/${q.capacity}`).join(" · ")}</p>}
      </div>}
      {ev.status!=="CANCELLED"&&(cancelConfirmFor===ev.id?<div className="reject-note"><span className="fine left">Confirmer l’annulation de cet événement ?</span><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>cancelEvent(ev.id)}>Confirmer l’annulation</button></div>:<button className="button small danger" onClick={()=>setCancelConfirmFor(ev.id)}>Annuler l’événement</button>)}
    </div></div>)}</div>
  </div></section></Layout>;
}

function AdminRestaurants() {
  const [items,setItems]=useState<any[]>([]);
  const [filter,setFilter]=useState("PENDING");
  const [actingOn,setActingOn]=useState<string|null>(null);
  const [reasonFor,setReasonFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>(`/admin/restaurants?status=${filter}`).then(setItems);
  useEffect(()=>{load()},[filter]);

  const decide=async(id:string, accept:boolean, rejectReason?:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/decision`,{method:"POST",body:JSON.stringify({accept,reason:rejectReason})});setNotice({kind:"success",text:accept?"Restaurateur approuvé.":"Demande refusée."});setReasonFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Demandes restaurateurs</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="filters"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="PENDING">En attente</option><option value="APPROVED">Approuvés</option><option value="REJECTED">Refusés</option><option value="SUSPENDED">Suspendus</option></select></div>
    {items.length===0?<div className="empty"><span>◇</span><h2>Aucune demande</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request"><div><h3>{r.name}</h3><p>{r.owner.displayName} · {r.owner.phone}</p>{r.district&&<p className="fine left">{r.address}, {r.district}</p>}{r.description&&<p className="fine left">{r.description}</p>}<small>{RESTAURANT_STATUS_LABEL[r.status]}</small></div>{r.status==="PENDING"&&<div className="decision-buttons">
      <button className="button" disabled={actingOn===r.id} onClick={()=>decide(r.id,true)}>Accepter</button>
      {reasonFor===r.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif (optionnel)"/><button className="button danger" disabled={actingOn===r.id} onClick={()=>decide(r.id,false,reason)}>Confirmer le refus</button></div>:<button className="button danger" onClick={()=>setReasonFor(r.id)}>Refuser</button>}
    </div>}</article>)}</div>}
  </div></section></Layout>;
}

function AdminAvailability() {
  const [events,setEvents]=useState<any[]>([]);
  const [eventId,setEventId]=useState("");
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [form,setForm]=useState({date:"",startTime:"18:00",endTime:"20:00",durationMinutes:20});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [generating,setGenerating]=useState(false);

  useEffect(()=>{api<any[]>("/admin/events").then(evts=>{setEvents(evts);if(evts[0])setEventId(evts[0].id)})},[]);
  const loadSlots=(id:string)=>{setLoadingSlots(true);api<any[]>(`/admin/events/${id}/call-slots`).then(setSlots).catch(()=>setSlots([])).finally(()=>setLoadingSlots(false))};
  useEffect(()=>{if(eventId)loadSlots(eventId)},[eventId]);

  const generate=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    if(!form.date){setNotice({kind:"error",text:"Choisissez une date"});return}
    setGenerating(true);
    try{
      const res=await api<{created:number;skipped:number}>(`/admin/events/${eventId}/call-slots/generate`,{method:"POST",body:JSON.stringify(form)});
      setNotice({kind:"success",text:`${res.created} créneau(x) ajouté(s)${res.skipped?`, ${res.skipped} déjà existant(s) ignoré(s)`:""}.`});
      loadSlots(eventId);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setGenerating(false)}
  };
  const remove=async(slotId:string)=>{
    setNotice(null);
    try{await api(`/admin/events/${eventId}/call-slots/${slotId}`,{method:"DELETE"});loadSlots(eventId)}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const byDay=useMemo(()=>{
    const map=new Map<string,any[]>();
    for(const s of slots){const key=new Date(s.startsAt).toDateString();if(!map.has(key))map.set(key,[]);map.get(key)!.push(s)}
    return map;
  },[slots]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Disponibilités d’entretien</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="availability-layout">
      <form className="panel availability-form" onSubmit={generate}>
        <div className="panel-title"><h2>Ajouter des créneaux</h2></div>
        <label>Événement<select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(ev=><option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></label>
        <label>Date<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
        <div className="time-row"><label>Début<input type="time" required value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>Fin<input type="time" required value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label></div>
        <label>Durée par entretien (minutes)<input type="number" min={5} max={180} required value={form.durationMinutes} onChange={e=>setForm({...form,durationMinutes:Number(e.target.value)})}/></label>
        <button className="button full" disabled={generating||!eventId}>{generating?"Génération…":"Générer les créneaux"}</button>
      </form>
      <div className="panel availability-list">
        <div className="panel-title"><h2>Créneaux existants</h2><span>{slots.length} créneau(x)</span></div>
        {loadingSlots?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
        :slots.length===0?<div className="empty small"><span>◇</span><p>Aucun créneau créé pour cet événement.</p></div>
        :<div className="stack">{[...byDay.entries()].map(([day,daySlots])=><div key={day} className="availability-day"><small>{new Date(day).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}</small><div className="slot-chip-grid">{daySlots.map(s=><div key={s.id} className={`slot-chip ${s.application?"booked":""}`}><span>{timeLabel(s.startsAt)}</span>{s.application?<small>{s.application.user.displayName}</small>:<button type="button" onClick={()=>remove(s.id)} aria-label="Supprimer le créneau">×</button>}</div>)}</div></div>)}</div>}
      </div>
    </div>
  </div></section></Layout>;
}

function Scanner() {
  const [code,setCode]=useState("NOUR-TICKET-DEMO-482"),[result,setResult]=useState<any>(null),[error,setError]=useState(""); const scan=async(e:FormEvent)=>{e.preventDefault();setResult(null);setError("");try{setResult(await api("/admin/tickets/scan",{method:"POST",body:JSON.stringify({code})}))}catch(err){setError((err as Error).message)}};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ACCUEIL</span><h1>Scanner un billet</h1><div className="scanner-layout"><form className="scanner panel" onSubmit={scan}><div className="scan-frame"><i/><span>QR</span></div><label>Code du billet<input value={code} onChange={e=>setCode(e.target.value)}/></label><button className="button full">Vérifier et valider l’entrée</button></form><aside className={`scan-result panel ${result?"success":error?"error":""}`}>{result?<><b>✓</b><h2>Entrée autorisée</h2><p>{result.participant}</p><span>{result.event}</span></>:error?<><b>×</b><h2>Entrée refusée</h2><p>{error}</p></>:<><b>⌗</b><h2>En attente d’un billet</h2><p>Scannez ou saisissez le code.</p></>}</aside></div></div></section></Layout>;
}

export function App(){return <AuthProvider><Routes><Route path="/" element={<Home/>}/><Route path="/events" element={<Events/>}/><Route path="/events/:id" element={<EventDetail/>}/><Route path="/login" element={<Login/>}/><Route path="/dashboard" element={<Protected><Dashboard/></Protected>}/><Route path="/admin" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION"]}><Admin/></Protected>}/><Route path="/admin/applications" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminApplications/></Protected>}/><Route path="/admin/availability" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminAvailability/></Protected>}/><Route path="/admin/events" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminEventPhotos/></Protected>}/><Route path="/admin/restaurants" element={<Protected roles={["ADMIN"]}><AdminRestaurants/></Protected>}/><Route path="/admin/scanner" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION"]}><Scanner/></Protected>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AuthProvider>}
