import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import jsQR from "jsqr";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { EVENT_CATEGORIES, EVENT_ZONES, SCREENING_QUESTIONS, NETWORKING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import type { PublicEvent, SessionUser, ScreeningAnswers, NetworkingAnswers } from "@nour/shared";
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
const STAFF_ROLES = ["ADMIN","ORGANIZER","MODERATOR","RECEPTION"];
function Header() {
  const { user, logout } = useAuth();
  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  return <header className="site-header"><Logo/><nav>{isStaff?<><NavLink to="/admin">Administration</NavLink><NavLink to="/">Voir le site public</NavLink></>:<><NavLink to="/">Accueil</NavLink><NavLink to="/events">Événements</NavLink>{user && <NavLink to="/dashboard">Mon espace</NavLink>}</>}</nav><div className="header-actions">{user ? <><span className="member-name">{user.displayName}</span><button className="link-button" onClick={logout}>Déconnexion</button></> : <Link className="button small" to="/login">Se connecter</Link>}</div></header>;
}
function Layout({ children }: {children: ReactNode}) { return <><Header/><main>{children}</main><footer><Logo/><p>Paris et Île-de-France · Expérience privée · Données protégées</p></footer></>; }
function Loading() { return <div className="state-page"><div className="spinner"/><h2>Chargement…</h2></div>; }
function Notice({ kind="info", children }: {kind?: "info"|"error"|"success", children: ReactNode}) { return <div className={`notice ${kind}`}>{children}</div>; }
function Protected({ children, roles }: {children: ReactNode; roles?: string[]}) {
  const {user,loading}=useAuth();
  if(loading)return <Loading/>;
  if(!user)return <Navigate to="/login" replace/>;
  if(roles&&!roles.includes(user.role))return <Navigate to={STAFF_ROLES.includes(user.role)?"/admin":"/dashboard"} replace/>;
  return <>{children}</>;
}

function EventCard({ event }: {event: PublicEvent}) {
  const full=event.confirmedCount>=event.capacity;
  const priceLabel=event.priceTiers.length>0?`À partir de ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:money(event.priceCents);
  return <article className="event-card"><Link to={`/events/${event.slug}`} className="event-art"><img src={imgUrl(event.imageUrl)} alt={event.title} loading="lazy"/><span className="category-badge">{event.category}</span>{full&&<span className="full-badge">Complet</span>}</Link><div className="event-copy"><small>{dateTime(event.startsAt).toUpperCase()}</small><h3>{event.title}</h3><p>{event.district} · {full?"Complet":`${event.capacity-event.confirmedCount} places restantes`}</p><div><strong>{priceLabel}</strong><Link to={`/events/${event.slug}`}>Découvrir →</Link></div></div></article>;
}
function Home() {
  const [events,setEvents]=useState<PublicEvent[]>([]); useEffect(()=>{api<PublicEvent[]>("/events").then(setEvents).catch(()=>{})},[]);
  return <Layout><section className="hero"><div><span className="eyebrow">PARIS · ÎLE-DE-FRANCE</span><h1>Des rencontres<br/><em>qui comptent.</em></h1><p>Des événements élégants et confidentiels, pensés pour créer de vraies connexions dans un cadre respectueux.</p><div className="hero-actions"><Link className="button" to="/events">Voir les événements</Link><a className="button secondary" href="#concept">Découvrir le concept</a></div><div className="trust"><span>✓ Profils sélectionnés</span><span>✓ Lieux premium</span><span>✓ Cadre confidentiel</span></div></div><div className="hero-art"><div className="arch"><span>ن</span></div><div className="next-card">{events[0]?<img className="next-thumb" src={imgUrl(events[0].imageUrl)} alt=""/>:<div className="avatar">N</div>}<div><small>PROCHAINE SOIRÉE</small><strong>{events[0]?.title??"Dîner & Connexions"}</strong><span>{events[0]?dateTime(events[0].startsAt):"Samedi · Paris"}</span></div></div></div></section><section id="concept" className="section"><div className="section-title"><span className="eyebrow">LE CONCEPT</span><h2>Du réel au numérique, avec votre consentement.</h2></div><div className="feature-grid"><div><b>01</b><h3>Candidature</h3><p>Chaque nouveau membre complète son profil et réserve un court appel.</p></div><div><b>02</b><h3>Rencontre</h3><p>Les événements réunissent 20 à 40 personnes dans un cadre privé.</p></div><div><b>03</b><h3>Contact choisi</h3><p>Un code personnel permet d’envoyer une demande. Le chat s’ouvre après acceptation.</p></div></div></section>{events.length>0&&<section className="section"><div className="section-title row"><div><span className="eyebrow">À VENIR</span><h2>Les prochaines rencontres</h2></div><Link to="/events">Tout afficher →</Link></div><div className="event-grid">{events.slice(0,3).map(e=><EventCard key={e.id} event={e}/>)}</div></section>}</Layout>;
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

function PaymentModal({ applicationId, eventId, amountCents, onClose, onConfirmed, onWaitlisted }: { applicationId: string; eventId: string; amountCents: number; onClose: () => void; onConfirmed: () => void; onWaitlisted: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "confirming" | "success" | "timeout">("loading");

  useEffect(() => {
    // Ne garantit jamais une place avant cet appel précis (§5) : c'est ici, et seulement ici, qu'un
    // verrou technique court est posé — si la place vient d'être prise entre l'inscription et cet
    // instant, la personne rejoint automatiquement la liste d'attente plutôt que d'échouer sans suite.
    api<{ clientSecret: string }>(`/applications/${applicationId}/payment-intent`, { method: "POST" })
      .then(r => { setClientSecret(r.clientSecret); setPhase("ready"); })
      .catch((err: any) => { if (err?.waitlisted) { onWaitlisted(); onClose(); } else setError((err as Error).message); });
  }, [applicationId]);

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

function ApplicationStatusPanel({ application, event, onPaid, onWaitlisted }: { application: any; event: PublicEvent; onPaid: () => void; onWaitlisted: () => void }) {
  const [showPayment, setShowPayment] = useState(false);
  if (application.status === "REFUSED") return <Notice kind="error">Votre candidature n’a pas été retenue pour cet événement.</Notice>;
  if (application.status === "CANCELLED") return <Notice kind="error">Cette candidature a été annulée.</Notice>;
  if (application.status === "CONFIRMED") return <Notice kind="success">Votre place est confirmée. Retrouvez votre billet dans votre espace personnel.</Notice>;
  // La candidature autorise à tenter le paiement, elle ne garantit jamais de place à elle seule
  // (§5) : le clic sur "Payer" est ce qui pose réellement le verrou, via PaymentModal.
  if (application.status === "PAYMENT_PENDING") return <div className="payment-block">
    <Notice kind="success">{application.reservation ? `Votre place est retenue quelques minutes (jusqu’au ${dateTime(application.reservation.expiresAt)}) : finalisez votre paiement.` : "Vous pouvez régler votre billet dès maintenant."}</Notice>
    <button className="button full" onClick={() => setShowPayment(true)}>Payer par carte · {money(event.priceCents)}</button>
    {showPayment && <PaymentModal applicationId={application.id} eventId={event.id} amountCents={event.priceCents} onClose={() => setShowPayment(false)} onConfirmed={() => { setShowPayment(false); onPaid(); }} onWaitlisted={onWaitlisted}/>}
  </div>;
  if (application.call) return <div className="call-scheduled"><span className="eyebrow">ENTRETIEN PROGRAMMÉ</span><strong>{dateTime(application.call.startsAt)}</strong><p>L’organisateur vous appellera à cette heure, puis vous serez informé(e) de sa décision.</p></div>;
  return null;
}

// Questionnaire obligatoire avant toute candidature (§4.1/§4.2) : 7 questions selon le parcours de
// l'événement, jamais une comparaison de catégorie (voir eventRequiresScreening). Les réponses
// speed dating sont privées ; les réponses networking ne bloquent jamais l'achat.
function QuestionnaireForm({ requiresScreening, submitting, onSubmit }: { requiresScreening: boolean; submitting: boolean; onSubmit: (answers: Record<string, string>) => void }) {
  const questions = requiresScreening ? SCREENING_QUESTIONS : NETWORKING_QUESTIONS;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(answers); };
  return <form className="questionnaire" onSubmit={submit}>
    <p className="fine">{requiresScreening ? "Vos réponses sont privées : elles servent uniquement à préparer votre entretien et la décision d’acceptation." : "Vos réponses ne bloquent jamais l’achat : elles aident seulement à mieux organiser la soirée."}</p>
    {questions.map(q => <label key={q.key}>{q.label}{q.key === "noteForOrganizer" && <span className="fine"> (facultatif)</span>}
      <textarea required={q.key !== "noteForOrganizer"} value={answers[q.key] ?? ""} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })}/>
    </label>)}
    <button className="button full" disabled={submitting}>{submitting ? "Envoi…" : "Envoyer ma candidature"}</button>
  </form>;
}

function EventDetail() {
  const {id}=useParams(); const {user}=useAuth();
  const [event,setEvent]=useState<PublicEvent|null>(null);
  const [application,setApplication]=useState<any>(null);
  const [loadingApplication,setLoadingApplication]=useState(true);
  const [notice,setNotice]=useState<{kind:"error"|"success"|"info";text:string}|null>(null);
  const [waitlistEntry,setWaitlistEntry]=useState<any>(null);
  const [altOffer,setAltOffer]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [showQuestionnaire,setShowQuestionnaire]=useState(false);

  useEffect(()=>{api<PublicEvent>(`/events/${id}`).then(setEvent)},[id]);

  useEffect(()=>{
    if(!user||!event){setLoadingApplication(false);return}
    let ignore=false; setLoadingApplication(true);
    api<any>(`/events/${event.id}/my-application`).then(a=>!ignore&&setApplication(a)).catch(()=>!ignore&&setApplication(null)).finally(()=>!ignore&&setLoadingApplication(false));
    api<any>(`/events/${event.id}/waitlist/me`).then(w=>!ignore&&setWaitlistEntry(w)).catch(()=>!ignore&&setWaitlistEntry(null));
    api<any[]>("/me/alternative-offers").then(list=>{if(ignore)return;setAltOffer(list.find(o=>o.originalEventId===event.id&&o.status==="PENDING")??null)}).catch(()=>{});
    return ()=>{ignore=true};
  },[user,event?.id]);

  if(!event)return <Layout><Loading/></Layout>;

  const requiresScreening = eventRequiresScreening(event);
  const profileValidated = !!user?.profile?.validatedAt;
  const myQuota = event.quotas.length>0 ? event.quotas.find(q=>q.category===user?.profile?.quotaCategory) ?? null : null;
  const categoryUnknown = event.quotas.length>0 && !user?.profile?.quotaCategory;
  const bucketFull = event.quotas.length>0 ? (myQuota ? myQuota.heldCount>=myQuota.capacity : false) : event.confirmedCount>=event.capacity;
  const canCancel = application && !["REFUSED","CANCELLED"].includes(application.status);

  const refreshApplication=()=>api<any>(`/events/${event.id}/my-application`).then(setApplication).catch(()=>{});
  const markWaitlisted=()=>{api<any>(`/events/${event.id}/waitlist/me`).then(setWaitlistEntry).catch(()=>{});setNotice({kind:"info",text:"Cet événement est complet pour votre catégorie : vous avez été placé(e) sur liste d’attente."})};

  // La candidature ne garantit jamais de place (§5) : elle enregistre le questionnaire et autorise
  // seulement à tenter le paiement ensuite (voir ApplicationStatusPanel → PaymentModal).
  const apply=async(answers:Record<string,string>)=>{
    setBusy(true);setNotice(null);
    try{
      const body=requiresScreening?{screeningAnswers:answers}:{networkingAnswers:answers};
      const result=await api<any>(`/events/${event.id}/apply`,{method:"POST",body:JSON.stringify(body)});
      setApplication(result.application);setShowQuestionnaire(false);
      setNotice({kind:"success",text:"Candidature envoyée : vous pouvez maintenant régler votre billet."});
    }
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
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
  // Écran de confirmation clair sur le montant remboursé (§7), jamais un simple "annulé" muet :
  // le calcul (plus de 24h → intégral, 24h ou moins → aucun remboursement de plein droit) est
  // renvoyé par le serveur, jamais recalculé ou supposé côté interface.
  const cancelApplication=async()=>{
    if(!application)return;
    setBusy(true);setNotice(null);
    try{
      const result=await api<{refunded:boolean;refundedAmountCents:number|null;eligible:boolean|null}>(`/me/applications/${application.id}/cancel`,{method:"POST"});
      const text=result.refunded?`Candidature annulée. ${money(result.refundedAmountCents!)} ont été remboursés intégralement.`
        :result.eligible===false?"Candidature annulée. Conformément à notre politique, aucun remboursement n’est possible pour une annulation à 24 heures ou moins de l’événement."
        :"Votre candidature a été annulée.";
      setNotice({kind:"success",text});await refreshApplication();setWaitlistEntry(null);
    }
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

  const perkLabels=[event.perks.drink&&"Boisson incluse",event.perks.starter&&"Entrée incluse",event.perks.main&&"Plat inclus",event.perks.dessert&&"Dessert inclus"].filter(Boolean) as string[];
  return <Layout><section className="event-hero" style={{backgroundImage:`linear-gradient(180deg,#0b0b0cb0,#0b0b0ce6),url(${imgUrl(event.imageUrl)})`}}><span className="eyebrow">{event.category.toUpperCase()}</span><h1>{event.title}</h1><p>{event.description}</p></section>{event.photos.length>0&&<section className="event-gallery">{event.photos.map((url,i)=><img key={i} src={imgUrl(url)} alt=""/>)}</section>}<section className="event-layout"><article><div className="facts"><div><small>DATE</small><b>{dateTime(event.startsAt)}</b></div><div><small>LIEU</small><b>{event.district}</b></div><div><small>CAPACITÉ</small><b>{event.capacity} participants</b></div></div>{event.quotas.length>0&&<div className="quota-breakdown"><small>PLACES PAR CATÉGORIE</small><div className="quota-rows">{event.quotas.map(q=><div key={q.category} className="quota-row"><span>{q.category==="HOMME"?"Hommes":"Femmes"}</span><b>{q.heldCount>=q.capacity?"Complet":`${q.capacity-q.heldCount} places`}</b></div>)}</div></div>}<h2>Une expérience pensée pour de vraies rencontres</h2><p>Accueil personnalisé, animation légère, temps libres et respect de la confidentialité.</p>{(perkLabels.length>0||event.perks.description)&&<div className="event-perks">{perkLabels.map(l=><span key={l}>{l}</span>)}{event.perks.description&&<span>{event.perks.description}</span>}</div>}<ul><li>Profils sélectionnés</li><li>QR code d’entrée unique</li><li>Code de contact privé</li><li>Équipe présente sur place</li></ul></article><aside className="booking"><small>{event.priceTiers.length>0?"TARIFS":"À PARTIR DE"}</small>{event.priceTiers.length>0?<div className="quota-rows">{event.priceTiers.map(t=><div key={t.category} className="quota-row"><span>{t.category==="HOMME"?"Hommes":"Femmes"}</span><b>{money(t.amountCents)}</b></div>)}</div>:<strong>{money(event.priceCents)}</strong>}<div><span>Disponibilité</span><b>{event.quotas.length>0?(myQuota?(bucketFull?"Complet pour votre catégorie":`${myQuota.capacity-myQuota.heldCount} places pour vous`):"Places selon catégorie"):(bucketFull?"Complet":`${event.capacity-event.confirmedCount} places`)}</b></div>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}{application&&<p className="fine status-line">Statut : <b>{APPLICATION_STATUS_LABEL[application.status]??application.status}</b></p>}
    {altOffer&&<div className="alt-offer"><span className="eyebrow">ÉVÉNEMENT ALTERNATIF PROPOSÉ</span><h3>{altOffer.alternativeEvent.title}</h3><p>{dateTime(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</p><p><b>{money(altOffer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busy} onClick={()=>respondAltOffer(true)}>Accepter</button><button className="button secondary" disabled={busy} onClick={()=>respondAltOffer(false)}>Refuser</button></div></div>}
    {!user?<Link className="button full" to="/login">Se connecter pour vous inscrire</Link>
    :loadingApplication?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
    :application?<>
      <ApplicationStatusPanel application={application} event={event} onPaid={refreshApplication} onWaitlisted={markWaitlisted}/>
      {waitlistEntry?<div className="waitlist-status"><span className="eyebrow">LISTE D’ATTENTE</span><p>Position {waitlistEntry.rank??waitlistEntry.position}{waitlistEntry.offeredAt?" — une place vous a été proposée, consultez votre espace personnel":""}</p><button className="button secondary small" disabled={busy} onClick={leaveWaitlist}>Quitter la liste d’attente</button></div>
      :(categoryUnknown?<Notice kind="error">Complétez votre catégorie dans votre profil pour rejoindre la liste d’attente.</Notice>:(bucketFull&&canCancel&&<button className="button secondary full" disabled={busy} onClick={joinWaitlist}>Rejoindre la liste d’attente</button>))}
      {canCancel&&<button className="button danger full" disabled={busy} onClick={cancelApplication}>Annuler mon inscription</button>}
    </>
    :requiresScreening&&!profileValidated?<Notice kind="error">Votre profil doit d’abord être validé lors d’un entretien avec Nour Meet avant de vous inscrire à un speed dating. <Link to="/dashboard">Demander mon entretien →</Link></Notice>
    :categoryUnknown?<Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement.</Notice>
    :showQuestionnaire?<QuestionnaireForm requiresScreening={requiresScreening} submitting={busy} onSubmit={apply}/>
    :<>{bucketFull&&<Notice kind="info">Cet événement est complet pour votre catégorie, mais vous pouvez tout de même candidater : une liste d’attente et une éventuelle proposition alternative vous seront proposées au moment de payer.</Notice>}<button className="button full" onClick={()=>setShowQuestionnaire(true)}>{requiresScreening?"Candidater":"S’inscrire"}</button></>}
    <p className="fine">Le paiement est proposé immédiatement après le questionnaire ; la place n’est acquise qu’une fois le paiement confirmé.</p></aside></section></Layout>;
}

// Comptes de test créés par prisma/seed.ts (voir ce fichier pour le détail de chaque état) : ces
// boutons ne sont affichés que lorsque le serveur tourne en mode SMS simulé (jamais en production,
// même si quelqu'un forçait NODE_ENV=production avec SMS_MODE=mock, ce que env.ts refuse déjà).
const QUICK_LOGIN_GROUPS: {title:string; items:{label:string; phone:string}[]}[] = [
  { title: "Administration", items: [
    { label: "Administrateur (Walid)", phone: "+33600000001" },
    { label: "Modérateur", phone: "+33600000031" },
    { label: "Personnel d'accueil", phone: "+33600000030" },
  ] },
  { title: "Restaurateurs", items: [
    { label: "Restaurateur approuvé (Maison Amana)", phone: "+33600000002" },
    { label: "Restaurateur en attente d'approbation", phone: "+33600000010" },
  ] },
  { title: "Participants (comptes de test)", items: [
    { label: "Homme validé", phone: "+33600000020" },
    { label: "Homme non validé", phone: "+33600000021" },
    { label: "Femme validée", phone: "+33600000022" },
    { label: "Femme non validée", phone: "+33600000023" },
    { label: "Refusé (délai de 3 mois en cours)", phone: "+33600000024" },
    { label: "Entretien demandé, aucun créneau réservé", phone: "+33600000025" },
  ] },
  { title: "Comptes de démonstration réels", items: [
    { label: "Sofia (participante, historique complet)", phone: "+33612345678" },
    { label: "Karim (participant, historique complet)", phone: "+33687654321" },
  ] },
];

function Login() {
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2>(1),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null); const {refresh}=useAuth(); const navigate=useNavigate();
  const [smsMode,setSmsMode]=useState<string|null>(null); const [quickLoginBusy,setQuickLoginBusy]=useState<string|null>(null);
  useEffect(()=>{api<{smsMode:string}>("/health").then(r=>setSmsMode(r.smsMode)).catch(()=>{})},[]);
  const submit=async(e:FormEvent)=>{e.preventDefault();setError("");try{if(step===1){const result=await api<{delivery:"mock"|"sms";devCode?:string}>("/auth/request-otp",{method:"POST",body:JSON.stringify({phone})});setDevCode(result.devCode??null);setStep(2)}else{const result=await api<{token:string;user:{role:string}}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone,code})});setToken(result.token);await refresh();navigate(STAFF_ROLES.includes(result.user.role)?"/admin":"/dashboard")}}catch(err){setError((err as Error).message)}};
  const quickLogin=async(label:string,quickPhone:string)=>{setError("");setQuickLoginBusy(label);try{await api("/auth/request-otp",{method:"POST",body:JSON.stringify({phone:quickPhone})});const result=await api<{token:string;user:{role:string}}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone:quickPhone,code:"123456"})});setToken(result.token);await refresh();navigate(STAFF_ROLES.includes(result.user.role)?"/admin":"/dashboard")}catch(err){setError((err as Error).message)}finally{setQuickLoginBusy(null)}};
  const quickLoginNew=()=>quickLogin("Nouveau compte","+336"+Math.floor(10_000_000+Math.random()*89_999_999));
  return <Layout><section className="auth-page"><div className="auth-visual"><blockquote>« Une belle rencontre commence par un cadre de confiance. »</blockquote></div><form className="auth-form" onSubmit={submit}><span className="eyebrow">CONNEXION SÉCURISÉE</span><h1>{step===1?"Votre numéro ouvre la porte.":"Entrez le code reçu."}</h1><p>{step===1?"Aucun mot de passe à mémoriser.":`Code envoyé au ${phone}`}</p>{error&&<Notice kind="error">{error}</Notice>}{step===1?<label>Numéro de téléphone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+33612345678" autoComplete="tel" inputMode="tel" required/></label>:<label>Code à six chiffres<input className="otp-input" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••••" autoComplete="one-time-code" inputMode="numeric" required/></label>}<button className="button full">{step===1?"Recevoir mon code":"Vérifier le code"}</button>{devCode&&<div className="demo-box"><b>Mode local — aucun SMS facturé</b><span>Code de développement : {devCode}</span></div>}{smsMode==="mock"&&<div className="quick-login"><b>Mode local — connexion rapide (jamais en production)</b>{QUICK_LOGIN_GROUPS.map(group=><div key={group.title}><small>{group.title}</small><div className="quick-login-grid">{group.items.map(item=><button type="button" key={item.phone} disabled={!!quickLoginBusy} onClick={()=>quickLogin(item.label,item.phone)}>{quickLoginBusy===item.label?"…":item.label}</button>)}</div></div>)}<div><small>Autre</small><div className="quick-login-grid"><button type="button" disabled={!!quickLoginBusy} onClick={quickLoginNew}>{quickLoginBusy==="Nouveau compte"?"…":"Nouveau compte (jamais inscrit)"}</button></div></div></div>}</form></section></Layout>;
}

function ProfileEditor({onSaved}:{onSaved:()=>void}) {
  const {user}=useAuth(); const [form,setForm]=useState({displayName:user?.displayName??"",email:user?.email??"",birthDate:"1992-06-14",city:user?.profile?.city??"",profession:user?.profile?.profession??"",interests:(user?.profile?.interests??[]).join(", "),bio:user?.profile?.bio??"",quotaCategory:user?.profile?.quotaCategory??""});const [message,setMessage]=useState("");
  const save=async(e:FormEvent)=>{e.preventDefault();await api("/me/profile",{method:"PATCH",body:JSON.stringify({...form,email:form.email||null,quotaCategory:form.quotaCategory||null,interests:form.interests.split(",").map((x:string)=>x.trim()).filter(Boolean)})});setMessage("Profil enregistré.");onSaved()};
  return <form className="panel form-grid" onSubmit={save}><div className="panel-title"><h2>Mon profil</h2><span>Informations privées</span></div>{message&&<Notice kind="success">{message}</Notice>}<label>Prénom ou pseudonyme<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label><label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Date de naissance<input type="date" value={form.birthDate} onChange={e=>setForm({...form,birthDate:e.target.value})}/></label><label>Ville<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label><label>Profession<input value={form.profession} onChange={e=>setForm({...form,profession:e.target.value})}/></label><label>Centres d’intérêt<input value={form.interests} onChange={e=>setForm({...form,interests:e.target.value})}/></label><label>Catégorie (pour les événements avec quotas, ex. speed dating)<select value={form.quotaCategory} onChange={e=>setForm({...form,quotaCategory:e.target.value})}><option value="">Non renseignée</option><option value="HOMME">Homme</option><option value="FEMME">Femme</option></select></label><label className="wide">Biographie<textarea value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})}/></label><button className="button">Enregistrer</button></form>;
}

function RestaurantApplication() {
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [submitting,setSubmitting]=useState(false);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({name:r.name??"",managerName:r.managerName??"",siret:r.siret??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
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
    <label>Nom du responsable<input required value={form.managerName} onChange={e=>setForm({...form,managerName:e.target.value})}/></label>
    <label>SIRET (14 chiffres)<input required pattern="\d{14}" title="14 chiffres" value={form.siret} onChange={e=>setForm({...form,siret:e.target.value.replace(/\D/g,"").slice(0,14)})}/></label>
    <label>Téléphone professionnel<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
    <label>Quartier / ville<input value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
    <label>Adresse<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
    <label className="wide">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <p className="fine wide">Le SIRET est déclaratif : Nour ne réalise pas de vérification officielle auprès d’un registre.</p>
    <button className="button" disabled={submitting}>{submitting?"Envoi…":"Envoyer ma demande"}</button>
  </form>;
}

function GlobalInterviewPanel() {
  const {user}=useAuth();
  const [status,setStatus]=useState<any>(undefined);
  const [motivation,setMotivation]=useState("");
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [schedulingId,setSchedulingId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);

  const load=()=>api<any>("/me/global-interview").then(setStatus).catch(()=>setStatus(null));
  useEffect(()=>{load()},[]);

  useEffect(()=>{
    if(!status||status.status!=="PENDING_CALL"||status.call){setSlots([]);return}
    let ignore=false; setLoadingSlots(true);
    api<any[]>("/interview-slots").then(s=>!ignore&&setSlots(s)).catch(()=>!ignore&&setSlots([])).finally(()=>!ignore&&setLoadingSlots(false));
    return ()=>{ignore=true};
  },[status?.status,status?.call]);

  const request=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{await api("/me/global-interview",{method:"POST",body:JSON.stringify({motivation})});setMotivation("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const schedule=async(slotId:string)=>{
    setSchedulingId(slotId);setNotice(null);
    try{const result=await api<any>(`/applications/${status.id}/schedule`,{method:"POST",body:JSON.stringify({slotId})});setStatus({...status,status:"CALL_SCHEDULED",call:result.slot});setNotice({kind:"success",text:"Votre entretien est confirmé."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message});api<any[]>("/interview-slots").then(setSlots).catch(()=>{})}
    finally{setSchedulingId(null)}
  };
  const cancel=async()=>{
    setBusy(true);setNotice(null);
    try{await api(`/me/applications/${status.id}/cancel`,{method:"POST"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  const requestForm=<form onSubmit={request}><label>Votre motivation<textarea required minLength={30} value={motivation} onChange={e=>setMotivation(e.target.value)} placeholder="Expliquez en quelques lignes ce que vous recherchez…"/></label><button className="button" disabled={busy}>{busy?"Envoi…":"Demander mon entretien"}</button></form>;

  if(status===undefined) return <Loading/>;
  return <div className="panel form-grid">
    <div className="panel-title"><h2>Entretien de validation du profil</h2><span>Obligatoire une fois avant de pouvoir vous inscrire à un événement</span></div>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {user?.profile?.validatedAt?<Notice kind="success">Votre profil est validé : vous pouvez vous inscrire directement aux événements.</Notice>
    :!status||status.status==null?requestForm
    :status.status==="REFUSED"?(
      status.retryAvailableAt && new Date(status.retryAvailableAt)>new Date()
        ? <><Notice kind="error">Votre profil n’a pas été validé{status.notes?` : ${status.notes}`:"."}</Notice><p className="fine">Vous pourrez redemander un entretien à partir du {new Date(status.retryAvailableAt).toLocaleDateString("fr-FR")}.</p></>
        : <>{status.notes&&<Notice kind="error">{status.notes}</Notice>}{requestForm}</>
    )
    :status.status==="PENDING_CALL"&&!status.call?<><CallCalendar slots={slots} loading={loadingSlots} onSelect={schedule} schedulingId={schedulingId}/><button type="button" className="button secondary small" disabled={busy} onClick={cancel}>Annuler ma demande</button></>
    :status.call?<div className="call-scheduled"><span className="eyebrow">ENTRETIEN PROGRAMMÉ</span><strong>{dateTime(status.call.startsAt)}</strong><p>Nour Meet vous appellera à cette heure, puis vous serez informé(e) de la décision.</p><button type="button" className="button secondary small" disabled={busy} onClick={cancel}>Annuler</button></div>
    :null}
  </div>;
}

function Dashboard() {
  const {user,refresh}=useAuth(); const [apps,setApps]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[notifications,setNotifications]=useState<any[]>([]),[offers,setOffers]=useState<any[]>([]),[tab,setTab]=useState("reservations"),[payingFor,setPayingFor]=useState<{applicationId:string;eventId:string;amountCents:number}|null>(null),[busyId,setBusyId]=useState<string|null>(null),[message,setMessage]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/me/applications"),api<any[]>("/me/tickets"),api<any[]>("/notifications"),api<any[]>("/me/alternative-offers")]).then(([a,t,n,o])=>{setApps(a);setTickets(t);setNotifications(n);setOffers(o)}); useEffect(()=>{load()},[]);
  const pendingOffers=offers.filter(o=>o.status==="PENDING");
  const cancelApplication=async(appId:string)=>{
    setBusyId(appId);setMessage(null);
    try{
      const result=await api<{refunded:boolean;refundedAmountCents:number|null;eligible:boolean|null}>(`/me/applications/${appId}/cancel`,{method:"POST"});
      const text=result.refunded?`Candidature annulée. ${money(result.refundedAmountCents!)} ont été remboursés intégralement.`
        :result.eligible===false?"Candidature annulée. Conformément à notre politique, aucun remboursement n’est possible pour une annulation à 24 heures ou moins de l’événement."
        :"Candidature annulée.";
      setMessage({kind:"success",text});await load();
    }
    catch(err){setMessage({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const respondOffer=async(offerId:string, accept:boolean)=>{
    setBusyId(offerId);setMessage(null);
    try{await api(`/alternative-offers/${offerId}/respond`,{method:"POST",body:JSON.stringify({accept})});setMessage({kind:"success",text:accept?"Place réservée : réglez votre billet avant expiration.":"Proposition refusée."});await load()}
    catch(err){setMessage({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const eventApps=apps.filter(a=>a.eventId);
  const tabs=[["interview",user?.profile?.validatedAt?"Entretien ✓":"Entretien"],["reservations","Réservations"],["tickets","Billets"],["alternatives",`Propositions${pendingOffers.length?` (${pendingOffers.length})`:""}`],["profile","Profil"],["notifications","Notifications"],["contacts","Contacts et messages"],...(user?.role==="PARTICIPANT"?[["restaurant","Devenir restaurateur"]]:[])];
  const titles:Record<string,string>={interview:"Entretien de validation",reservations:"Mes événements",tickets:"Mes billets",alternatives:"Propositions alternatives",profile:"Mon profil",notifications:"Notifications",contacts:"Contacts et messages",restaurant:"Devenir restaurateur"};
  return <Layout><section className="dashboard-shell"><aside><div className="profile-card"><div className="avatar large">{user?.displayName?.slice(0,2).toUpperCase()}</div><h3>{user?.displayName}</h3><span>{user?.profile?.validatedAt?"Profil validé":"Profil à compléter"}</span></div>{tabs.map(([id,label])=><button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}<span>›</span></button>)}</aside><div className="dashboard-content"><span className="eyebrow">ESPACE PARTICIPANT</span><h1>{titles[tab]}</h1>{message&&<Notice kind={message.kind}>{message.text}</Notice>}{tab==="interview"&&<GlobalInterviewPanel/>}{tab==="reservations"&&<div className="stack">{eventApps.length===0?<div className="empty small"><span>◇</span><p>Aucune inscription pour le moment.</p></div>:eventApps.map(a=><article className="reservation" key={a.id}><div className="date-box"><strong>{new Date(a.event.startsAt).getDate()}</strong><span>{new Date(a.event.startsAt).toLocaleString("fr-FR",{month:"short"}).toUpperCase()}</span></div><div><small>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</small><h3>{a.event.title}</h3><p>{dateTime(a.event.startsAt)} · {a.event.district}</p>{a.call&&a.status==="CALL_SCHEDULED"&&<p className="call-hint">Entretien : {dateTime(a.call.startsAt)}</p>}</div><div className="reservation-actions">{a.status==="PAYMENT_PENDING"&&<button className="button" onClick={()=>setPayingFor({applicationId:a.id,eventId:a.event.id,amountCents:a.event.priceCents})}>Payer par carte · {money(a.event.priceCents)}</button>}{!["REFUSED","CANCELLED"].includes(a.status)&&<button className="button secondary small" disabled={busyId===a.id} onClick={()=>cancelApplication(a.id)}>Annuler</button>}</div></article>)}</div>}{tab==="tickets"&&<div className="ticket-grid">{tickets.map(t=><article className="ticket" key={t.id}><div><span className="eyebrow">{new Date(t.reservation.event.startsAt).toLocaleDateString("fr-FR")}</span><h2>{t.reservation.event.title}</h2><p>{t.reservation.event.district}</p></div><img src={t.qrDataUrl} alt={`QR code du billet ${t.code}`}/><b>{t.code}</b></article>)}</div>}{tab==="alternatives"&&<div className="stack">{offers.length===0?<div className="empty small"><span>◇</span><p>Aucune proposition pour le moment.</p></div>:offers.map(o=><article key={o.id} className="alt-offer"><span className="eyebrow">{o.status==="PENDING"?"EN ATTENTE DE VOTRE RÉPONSE":o.status==="ACCEPTED"?"ACCEPTÉE":o.status==="DECLINED"?"REFUSÉE":"EXPIRÉE"}</span><h3>{o.alternativeEvent.title}</h3><p>À la place de « {o.originalEvent.title} »</p><p>{dateTime(o.alternativeEvent.startsAt)} · {o.alternativeEvent.district}</p><p><b>{money(o.alternativeEvent.priceCents)}</b></p>{o.status==="PENDING"&&<div className="decision-buttons"><button className="button" disabled={busyId===o.id} onClick={()=>respondOffer(o.id,true)}>Accepter</button><button className="button secondary" disabled={busyId===o.id} onClick={()=>respondOffer(o.id,false)}>Refuser</button></div>}</article>)}</div>}{tab==="profile"&&<ProfileEditor onSaved={refresh}/>} {tab==="notifications"&&<div className="stack">{notifications.map(n=><article className="notification" key={n.id}><i/><div><h3>{n.title}</h3><p>{n.body}</p><small>{dateTime(n.createdAt)}</small></div></article>)}</div>}{tab==="contacts"&&<Messages/>}{tab==="restaurant"&&<RestaurantApplication/>}</div></section>
  {payingFor&&<PaymentModal applicationId={payingFor.applicationId} eventId={payingFor.eventId} amountCents={payingFor.amountCents} onClose={()=>setPayingFor(null)} onConfirmed={()=>{setPayingFor(null);load()}} onWaitlisted={()=>{setPayingFor(null);load()}}/>}
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
  const showStats = user?.role==="ADMIN"||user?.role==="ORGANIZER";
  const [stats,setStats]=useState<any>(null); useEffect(()=>{if(showStats)api("/admin/dashboard").then(setStats)},[showStats]);
  if(!showStats) return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">{user?.role==="MODERATOR"?"MODÉRATION":"ACCUEIL"}</span><h1>Bienvenue, {user?.displayName}</h1><p className="fine">{user?.role==="MODERATOR"?"Utilisez le menu pour traiter les signalements.":"Utilisez le menu pour scanner les billets de l’établissement."}</p></div></section></Layout>;
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><div className="admin-heading"><div><span className="eyebrow">{user?.role==="ADMIN"?"SUPER-ADMINISTRATION":"ESPACE RESTAURATEUR"}</span><h1>Tableau de bord {user?.role==="ADMIN"?"général":"de mon établissement"}</h1></div></div>{!stats?<Loading/>:<><div className="stat-grid"><Stat label="Événements actifs" value={stats.events}/><Stat label="Inscriptions" value={stats.applications}/><Stat label="Revenus" value={money(stats.revenueCents)}/>{stats.openReports!=null&&<Stat label="Signalements ouverts" value={stats.openReports}/>}{stats.pendingInterviews!=null&&<Stat label="Entretiens en attente" value={stats.pendingInterviews}/>}</div><div className="admin-grid"><div className="panel chart"><div className="panel-title"><h2>Activité sur 30 jours</h2><span>Données de démonstration</span></div><div className="bars">{[32,50,42,68,60,82,75,94,70,85,97,88].map((n,i)=><i key={i} style={{height:`${n}%`}}/>)}</div></div><div className="panel quick"><h2>Actions rapides</h2>{user?.role==="ADMIN"&&<Link to="/admin/applications">Traiter les entretiens <span>→</span></Link>}<Link to="/admin/attendees">Voir les participants <span>→</span></Link><Link to="/admin/scanner">Scanner un billet <span>→</span></Link>{user?.role==="ADMIN"&&<Link to="/admin/restaurants">Demandes restaurateurs <span>→</span></Link>}<Link to="/events">Voir les événements <span>→</span></Link></div></div></>}</div></section></Layout>;
}
function Stat({label,value}:{label:string;value:string|number}){return <div className="stat"><small>{label.toUpperCase()}</small><strong>{value}</strong><span>Mis à jour maintenant</span></div>}
function AdminNav(){
  const {user}=useAuth(); const role=user?.role;
  const manages = role==="ADMIN"||role==="ORGANIZER";
  return <aside className="admin-nav"><Logo/>
    {manages&&<NavLink end to="/admin">Vue générale</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/applications">Entretiens</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/availability">Agenda</NavLink>}
    {manages&&<NavLink to="/admin/events/new">Créer une soirée</NavLink>}
    {manages&&<NavLink to="/admin/events">Mes événements</NavLink>}
    {manages&&<NavLink to="/admin/attendees">Participants</NavLink>}
    {manages&&<NavLink to="/admin/finance">Finances</NavLink>}
    {manages&&<NavLink to="/admin/staff">Personnel d’accueil</NavLink>}
    <NavLink to="/admin/scanner">Scanner les billets</NavLink>
    {role==="ADMIN"&&<NavLink to="/admin/restaurants">Demandes restaurateurs</NavLink>}
    {(role==="ADMIN"||role==="MODERATOR")&&<NavLink to="/admin/moderation">Modération</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/outbox">Notifications</NavLink>}
    <Link to="/">Voir le site public</Link>
  </aside>;
}

function AdminGlobalInterviews() {
  const [items,setItems]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[message,setMessage]=useState(""); const load=()=>api<any[]>("/admin/global-interviews").then(v=>{setItems(v);if(selected)setSelected(v.find(x=>x.id===selected.id))});useEffect(()=>{load()},[]);
  const decide=async(accept:boolean)=>{await api(`/admin/global-interviews/${selected.id}/decision`,{method:"POST",body:JSON.stringify({accept,notes:accept?undefined:"Profil non retenu pour le moment."})});setMessage(accept?"Profil validé.":"Profil non validé.");await load()};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Entretiens de validation</h1><p className="fine">Un seul entretien global valide le profil d’un participant, indépendamment de tout événement.</p>{message&&<Notice kind="success">{message}</Notice>}<div className="applications-layout"><div className="panel table"><div className="table-row head"><span>Personne</span><span>Statut</span></div>{items.map(a=><button key={a.id} onClick={()=>setSelected(a)} className={`table-row ${selected?.id===a.id?"selected":""}`}><span><b>{a.user.displayName}</b><small>{a.user.phone}</small></span><span>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</span></button>)}</div><aside className="panel candidate-detail">{selected?<><div className="avatar large">{selected.user.displayName.slice(0,2).toUpperCase()}</div><h2>{selected.user.displayName}</h2><p>{selected.user.profile?.profession} · {selected.user.profile?.city}</p><hr/><small>MOTIVATION</small><blockquote>{selected.motivation}</blockquote><small>CENTRES D’INTÉRÊT</small><div className="chips">{selected.user.profile?.interests.map((x:string)=><span key={x}>{x}</span>)}</div><small>ENTRETIEN</small><p>{selected.call?dateTime(selected.call.startsAt):"Aucun créneau réservé pour le moment"}</p>{!["ACCEPTED","REFUSED"].includes(selected.status)&&<div className="decision-buttons"><button className="button" onClick={()=>decide(true)}>Valider le profil</button><button className="button danger" onClick={()=>decide(false)}>Refuser</button></div>}</>:<div className="empty"><h3>Sélectionnez un entretien</h3></div>}</aside></div></div></section></Layout>;
}

function AdminCreateEvent() {
  const {user}=useAuth();
  const navigate=useNavigate();
const [form,setForm]=useState({title:"",slug:"",category:EVENT_CATEGORIES[0].name,flow:"" as ""|"SCREENING"|"DIRECT",description:"",startsAt:"",endsAt:"",district:"",address:"",zone:EVENT_ZONES[0],capacity:20,priceCents:3000,includesDrink:false,includesStarter:false,includesMain:false,includesDessert:false,perksDescription:""});
  const [submitting,setSubmitting]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [commissionRate,setCommissionRate]=useState<number|null>(null);
  useEffect(()=>{if(user?.role==="ORGANIZER")api<any>("/restaurants/me").then(r=>setCommissionRate(r.commissionRate)).catch(()=>{})},[user?.role]);
  const slugify=(t:string)=>t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{
      await api("/admin/events",{method:"POST",body:JSON.stringify({...form,flow:form.flow||undefined,startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString()})});
      setNotice({kind:"success",text:user?.role==="ORGANIZER"?"Brouillon créé. Ajoutez vos photos puis soumettez-le à validation.":"Événement créé."});
      setTimeout(()=>navigate("/admin/events"),1200);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Créer une soirée</h1><p className="fine left">{user?.role==="ORGANIZER"?"Votre soirée démarre en brouillon : ajoutez ensuite vos photos puis soumettez-la à validation.":"Vous publiez directement vos propres événements."}</p>
    {user?.role==="ORGANIZER"&&<Notice kind="info">Nour prélève {commissionRate??30}% du prix des billets. Vous recevez {100-(commissionRate??30)}% des ventes éligibles après l’événement. Les frais Stripe sont pris en charge par Nour.</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={submit}>
      <label>Titre<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value,slug:form.slug?form.slug:slugify(e.target.value)})}/></label>
      <label>Identifiant (slug)<input required pattern="[a-z0-9-]+" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
      {user?.role==="ADMIN"&&<label>Parcours d’inscription<select value={form.flow} onChange={e=>setForm({...form,flow:e.target.value as ""|"SCREENING"|"DIRECT"})}><option value="">Suggéré selon la catégorie</option><option value="SCREENING">Sélection (entretien requis)</option><option value="DIRECT">Accès direct (paiement immédiat)</option></select></label>}
      <label>Zone<select value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}>{EVENT_ZONES.map(z=><option key={z} value={z}>{z}</option>)}</select></label>
      <label className="wide">Description<textarea required minLength={20} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <div className="time-row"><label>Début<input required type="datetime-local" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label><label>Fin<input required type="datetime-local" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label></div>
      <label>Quartier / ville<input required value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
      <label>Adresse<input required value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
      <div className="time-row"><label>Capacité totale<input required type="number" min={5} max={500} value={form.capacity} onChange={e=>setForm({...form,capacity:Number(e.target.value)})}/></label><label>Prix (centimes)<input required type="number" min={0} value={form.priceCents} onChange={e=>setForm({...form,priceCents:Number(e.target.value)})}/></label></div>
      <div className="wide"><small>PRESTATIONS RÉELLEMENT INCLUSES</small><div className="perks-checks">
        <label><input type="checkbox" checked={form.includesDrink} onChange={e=>setForm({...form,includesDrink:e.target.checked})}/> Boisson</label>
        <label><input type="checkbox" checked={form.includesStarter} onChange={e=>setForm({...form,includesStarter:e.target.checked})}/> Entrée</label>
        <label><input type="checkbox" checked={form.includesMain} onChange={e=>setForm({...form,includesMain:e.target.checked})}/> Plat</label>
        <label><input type="checkbox" checked={form.includesDessert} onChange={e=>setForm({...form,includesDessert:e.target.checked})}/> Dessert</label>
      </div></div>
      <label className="wide">Précisions sur les prestations<textarea value={form.perksDescription} onChange={e=>setForm({...form,perksDescription:e.target.value})} placeholder="Ex. : coupe de champagne à l’arrivée, buffet salé…"/></label>
      <p className="fine wide">Les quotas hommes/femmes (Speed dating), les tarifs différenciés et la galerie photo se règlent après création, depuis « Mes événements ».</p>
      <button className="button" disabled={submitting}>{submitting?"Création…":"Créer la soirée"}</button>
    </form>
  </div></section></Layout>;
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
  const [editFor,setEditFor]=useState<string|null>(null);
  const [editForm,setEditForm]=useState({title:"",description:"",capacity:0,startsAt:"",endsAt:"",includesDrink:false,includesStarter:false,includesMain:false,includesDessert:false,perksDescription:""});
  const [pricingFor,setPricingFor]=useState<string|null>(null);
  const [pricingForm,setPricingForm]=useState({mode:"flat" as "flat"|"differentiated",amountCents:0,homme:0,femme:0});
  const [historyFor,setHistoryFor]=useState<string|null>(null);
  const [historyItems,setHistoryItems]=useState<any[]>([]);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/events").then(setEvents);
  useEffect(()=>{load()},[]);

  const toLocalInput=(iso:string)=>new Date(iso).toISOString().slice(0,16);

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
  const uploadGalleryPhoto=async(eventId:string, file:File)=>{
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setNotice({kind:"error",text:"Format non pris en charge (jpeg, png ou webp uniquement)."});return}
    if(file.size>5*1024*1024){setNotice({kind:"error",text:"Image trop volumineuse (5 Mo maximum)."});return}
    setUploadingFor(eventId);setNotice(null);
    try{const form=new FormData();form.append("file",file);await api(`/admin/events/${eventId}/photos`,{method:"POST",body:form});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setUploadingFor(null)}
  };
  const removeGalleryPhoto=async(eventId:string, photoId:string)=>{
    setNotice(null);
    try{await api(`/admin/events/${eventId}/photos/${photoId}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
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

  const openEditor=(ev:any)=>{
    setEditForm({title:ev.title,description:ev.description,capacity:ev.capacity,startsAt:toLocalInput(ev.startsAt),endsAt:toLocalInput(ev.endsAt),includesDrink:ev.includesDrink,includesStarter:ev.includesStarter,includesMain:ev.includesMain,includesDessert:ev.includesDessert,perksDescription:ev.perksDescription??""});
    setEditFor(ev.id);
  };
  const saveEdit=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{
      const res=await api<any>(`/admin/events/${eventId}`,{method:"PATCH",body:JSON.stringify({...editForm,startsAt:new Date(editForm.startsAt).toISOString(),endsAt:new Date(editForm.endsAt).toISOString()})});
      setNotice({kind:"success",text:res.dateChangeRequestedAt?"Modifications enregistrées ; le changement de date attend l’approbation du super-admin.":"Modifications enregistrées."});
      setEditFor(null);await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const decideDateChange=async(eventId:string, accept:boolean)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/date-change/decision`,{method:"POST",body:JSON.stringify({accept})});setNotice({kind:"success",text:accept?"Changement de date approuvé.":"Changement de date refusé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const openPricing=(ev:any)=>{
    const homme=ev.priceTiers?.find((t:any)=>t.category==="HOMME")?.amountCents;
    const femme=ev.priceTiers?.find((t:any)=>t.category==="FEMME")?.amountCents;
    setPricingForm({mode:homme!=null&&femme!=null?"differentiated":"flat",amountCents:ev.priceCents,homme:homme??ev.priceCents,femme:femme??ev.priceCents});
    setPricingFor(ev.id);
  };
  const savePricing=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{
      const body=pricingForm.mode==="flat"?{mode:"flat",amountCents:pricingForm.amountCents}:{mode:"differentiated",homme:pricingForm.homme,femme:pricingForm.femme};
      await api(`/admin/events/${eventId}/pricing`,{method:"POST",body:JSON.stringify(body)});
      setNotice({kind:"success",text:"Tarifs mis à jour."});setPricingFor(null);await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const toggleHistory=async(eventId:string)=>{
    if(historyFor===eventId){setHistoryFor(null);return}
    setHistoryFor(eventId);
    try{setHistoryItems(await api<any[]>(`/admin/events/${eventId}/history`))}catch{setHistoryItems([])}
  };
  const HISTORY_LABEL:Record<string,string>={CREATE_EVENT:"Création",SUBMIT_EVENT_FOR_REVIEW:"Soumis à validation",APPROVE_EVENT:"Publié",REJECT_EVENT:"Renvoyé en brouillon",UPDATE_EVENT:"Modifié",SET_EVENT_PRICING:"Tarifs modifiés",SET_EVENT_QUOTAS:"Quotas modifiés",ADD_EVENT_PHOTO:"Photo ajoutée",CANCEL_EVENT:"Annulé",APPROVE_DATE_CHANGE:"Changement de date approuvé",REJECT_DATE_CHANGE:"Changement de date refusé"};

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Mes événements</h1><p className="fine left">Formats acceptés : JPEG, PNG, WEBP · 5 Mo maximum. Sans photo personnalisée, l’illustration de la catégorie est utilisée.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="event-photo-grid">{events.map(ev=><div key={ev.id} className="panel event-photo-card"><img src={imgUrl(ev.imageUrl)} alt={ev.title}/><div><b>{ev.title}</b><small>{ev.category} · {EVENT_STATUS_LABEL[ev.status]??ev.status}</small>
      <label className="button small secondary">{uploadingFor===ev.id?"Envoi…":"Changer la photo principale"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id} onChange={e=>{const f=e.target.files?.[0];if(f)upload(ev.id,f);e.target.value=""}}/></label>

      <div className="gallery-editor"><small>GALERIE ({ev.photos?.length??0}/5)</small><div className="gallery-thumbs">{(ev.photos??[]).map((p:any)=><div key={p.id} className="gallery-thumb"><img src={imgUrl(p.url)} alt=""/><button type="button" onClick={()=>removeGalleryPhoto(ev.id,p.id)} aria-label="Supprimer la photo">×</button></div>)}</div><label className="button small secondary" style={{opacity:(ev.photos?.length??0)>=5?0.5:1}}>{uploadingFor===ev.id?"Envoi…":"Ajouter une photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id||(ev.photos?.length??0)>=5} onChange={e=>{const f=e.target.files?.[0];if(f)uploadGalleryPhoto(ev.id,f);e.target.value=""}}/></label></div>

      {user?.role==="ORGANIZER"&&ev.status==="DRAFT"&&<button className="button small" disabled={actingOn===ev.id} onClick={()=>submitForReview(ev.id)}>{actingOn===ev.id?"Envoi…":"Soumettre à validation"}</button>}
      {user?.role==="ADMIN"&&ev.status==="PENDING_REVIEW"&&<div className="review-actions">
        <button className="button small" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,true)}>Publier</button>
        {rejectNoteFor===ev.id?<div className="reject-note"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Motif (optionnel)"/><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,false,rejectNote)}>Confirmer le refus</button></div>:<button className="button small danger" onClick={()=>setRejectNoteFor(ev.id)}>Renvoyer en brouillon</button>}
      </div>}

      {user?.role==="ADMIN"&&ev.dateChangeRequestedAt&&<div className="reject-note"><span className="fine left">Changement de date proposé : {dateTime(ev.proposedStartsAt)}</span><div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>decideDateChange(ev.id,true)}>Approuver</button><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>decideDateChange(ev.id,false)}>Refuser</button></div></div>}

      {editFor===ev.id?<div className="event-edit-form">
        <label>Titre<input value={editForm.title} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></label>
        <label>Description<textarea value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></label>
        <div className="time-row"><label>Capacité<input type="number" min={5} value={editForm.capacity} onChange={e=>setEditForm({...editForm,capacity:Number(e.target.value)})}/></label></div>
        <div className="time-row"><label>Début<input type="datetime-local" value={editForm.startsAt} onChange={e=>setEditForm({...editForm,startsAt:e.target.value})}/></label><label>Fin<input type="datetime-local" value={editForm.endsAt} onChange={e=>setEditForm({...editForm,endsAt:e.target.value})}/></label></div>
        <p className="fine left">Si des places sont déjà payées ou bloquées, un changement de date devient une proposition soumise à l’approbation du super-admin.</p>
        <small>PRESTATIONS RÉELLEMENT INCLUSES</small>
        <div className="perks-checks">
          <label><input type="checkbox" checked={editForm.includesDrink} onChange={e=>setEditForm({...editForm,includesDrink:e.target.checked})}/> Boisson</label>
          <label><input type="checkbox" checked={editForm.includesStarter} onChange={e=>setEditForm({...editForm,includesStarter:e.target.checked})}/> Entrée</label>
          <label><input type="checkbox" checked={editForm.includesMain} onChange={e=>setEditForm({...editForm,includesMain:e.target.checked})}/> Plat</label>
          <label><input type="checkbox" checked={editForm.includesDessert} onChange={e=>setEditForm({...editForm,includesDessert:e.target.checked})}/> Dessert</label>
        </div>
        <label>Précisions sur les prestations<textarea value={editForm.perksDescription} onChange={e=>setEditForm({...editForm,perksDescription:e.target.value})} placeholder="Ex. : coupe de champagne à l’arrivée, buffet salé…"/></label>
        <div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveEdit(ev.id)}>Enregistrer</button><button className="button small secondary" onClick={()=>setEditFor(null)}>Annuler</button></div>
      </div>:<button className="button small secondary" onClick={()=>openEditor(ev)}>Modifier les informations</button>}

      {pricingFor===ev.id?<div className="event-edit-form">
        <div className="time-row"><label><input type="radio" checked={pricingForm.mode==="flat"} onChange={()=>setPricingForm({...pricingForm,mode:"flat"})}/> Tarif unique</label><label><input type="radio" checked={pricingForm.mode==="differentiated"} onChange={()=>setPricingForm({...pricingForm,mode:"differentiated"})}/> Tarif différencié homme/femme</label></div>
        {pricingForm.mode==="flat"?<label>Prix (centimes)<input type="number" min={0} value={pricingForm.amountCents} onChange={e=>setPricingForm({...pricingForm,amountCents:Number(e.target.value)})}/></label>
        :<><div className="time-row"><label>Hommes (centimes)<input type="number" min={0} value={pricingForm.homme} onChange={e=>setPricingForm({...pricingForm,homme:Number(e.target.value)})}/></label><label>Femmes (centimes)<input type="number" min={0} value={pricingForm.femme} onChange={e=>setPricingForm({...pricingForm,femme:Number(e.target.value)})}/></label></div><p className="fine left">La conformité juridique d’un tarif différencié selon le sexe doit être vérifiée avant toute mise en production.</p></>}
        <div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>savePricing(ev.id)}>Enregistrer les tarifs</button><button className="button small secondary" onClick={()=>setPricingFor(null)}>Annuler</button></div>
      </div>:<button className="button small secondary" onClick={()=>openPricing(ev)}>{ev.priceTiers?.length?"Modifier les tarifs":"Définir un tarif différencié"}</button>}

      {ev.category==="Speed dating"&&<div className="quota-editor">
        {quotaEditFor===ev.id?<><div className="time-row"><label>Hommes<input type="number" min={0} value={quotaForm.homme} onChange={e=>setQuotaForm({...quotaForm,homme:Number(e.target.value)})}/></label><label>Femmes<input type="number" min={0} value={quotaForm.femme} onChange={e=>setQuotaForm({...quotaForm,femme:Number(e.target.value)})}/></label></div><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveQuotas(ev.id)}>Enregistrer les quotas</button></>
        :<button className="button small secondary" onClick={()=>openQuotaEditor(ev)}>{ev.quotas?.length?"Modifier les quotas":"Définir des quotas"}</button>}
        {ev.quotas?.length>0&&<p className="fine left">{ev.quotas.map((q:any)=>`${q.category==="HOMME"?"Hommes":"Femmes"} : ${q.heldCount}/${q.capacity}`).join(" · ")}</p>}
      </div>}

      <button type="button" className="button small secondary" onClick={()=>toggleHistory(ev.id)}>{historyFor===ev.id?"Masquer l’historique":"Voir l’historique"}</button>
      {historyFor===ev.id&&<div className="stack"><ul className="history-list">{historyItems.map(h=><li key={h.id}><small>{dateTime(h.createdAt)}</small> — {HISTORY_LABEL[h.action]??h.action}</li>)}</ul></div>}

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
  const [rateFor,setRateFor]=useState<string|null>(null);
  const [rate,setRate]=useState(30);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>(`/admin/restaurants?status=${filter}`).then(setItems);
  useEffect(()=>{load()},[filter]);

  const decide=async(id:string, accept:boolean, rejectReason?:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/decision`,{method:"POST",body:JSON.stringify({accept,reason:rejectReason})});setNotice({kind:"success",text:accept?"Restaurateur approuvé.":"Demande refusée."});setReasonFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const saveRate=async(id:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/commission-rate`,{method:"POST",body:JSON.stringify({commissionRate:rate})});setNotice({kind:"success",text:"Taux de commission mis à jour."});setRateFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Demandes restaurateurs</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="filters"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="PENDING">En attente</option><option value="APPROVED">Approuvés</option><option value="REJECTED">Refusés</option><option value="SUSPENDED">Suspendus</option></select></div>
    {items.length===0?<div className="empty"><span>◇</span><h2>Aucune demande</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request"><div><h3>{r.name}</h3><p>{r.owner.displayName} · {r.owner.phone}</p><p className="fine left">Responsable : {r.managerName??"—"} · SIRET {r.siret??"—"}</p>{r.district&&<p className="fine left">{r.address}, {r.district}</p>}{r.description&&<p className="fine left">{r.description}</p>}<small>{RESTAURANT_STATUS_LABEL[r.status]}</small>{r.status==="APPROVED"&&(rateFor===r.id?<div className="time-row"><input type="number" min={0} max={100} value={rate} onChange={e=>setRate(Number(e.target.value))}/><button className="button small" disabled={actingOn===r.id} onClick={()=>saveRate(r.id)}>Enregistrer</button></div>:<p className="fine left">Commission Nour : {r.commissionRate}% <button type="button" className="link-button" onClick={()=>{setRate(r.commissionRate);setRateFor(r.id)}}>modifier</button></p>)}</div>{r.status==="PENDING"&&<div className="decision-buttons">
      <button className="button" disabled={actingOn===r.id} onClick={()=>decide(r.id,true)}>Accepter</button>
      {reasonFor===r.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif (optionnel)"/><button className="button danger" disabled={actingOn===r.id} onClick={()=>decide(r.id,false,reason)}>Confirmer le refus</button></div>:<button className="button danger" onClick={()=>setReasonFor(r.id)}>Refuser</button>}
    </div>}</article>)}</div>}
  </div></section></Layout>;
}

function AdminFinance() {
  const {user}=useAuth();
  const [entries,setEntries]=useState<any[]>([]);
  const [summary,setSummary]=useState<any>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/admin/finance/ledger"),api<any>("/admin/finance/summary")]).then(([l,s])=>{setEntries(l);setSummary(s)});
  useEffect(()=>{load()},[]);

  const markPaid=async(id:string)=>{
    setBusy(id);setNotice(null);
    try{await api(`/admin/finance/ledger/${id}/mark-paid`,{method:"POST",body:JSON.stringify({})});setNotice({kind:"success",text:"Marqué comme reversé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">{user?.role==="ADMIN"?"SUPER-ADMINISTRATION":"ESPACE RESTAURATEUR"}</span><h1>Finances</h1><p className="fine left">Aucun virement n’est jamais déclenché automatiquement par la plateforme : « Marquer comme reversé » n’est qu’un registre, à cocher après un virement fait vous-même.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {summary&&<div className="stat-grid">
      <Stat label="Encaissé" value={money(summary.grossCents)}/>
      <Stat label="Commission Nour" value={money(summary.commissionCents)}/>
      <Stat label="Dû au(x) restaurant(s)" value={money(summary.restaurantDueCents)}/>
      <Stat label="Déjà reversé" value={money(summary.paidOutCents)}/>
      <Stat label="Remboursé" value={money(summary.refundedCents)}/>
    </div>}
    {entries.length===0?<div className="empty"><span>◇</span><h2>Aucune vente pour le moment</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Événement</span><span>Brut</span><span>Commission</span><span>Dû restaurant</span><span>Statut</span></div>
      {entries.map(e=><div key={e.id} className="table-row"><span><b>{e.event.title}</b>{user?.role==="ADMIN"&&<small>{e.restaurant.name}</small>}</span><span>{money(e.grossAmountCents)}</span><span>{money(e.commissionAmountCents)} ({e.commissionRate}%)</span><span>{money(e.restaurantDueCents)}{e.refundedAmountCents>0&&<small className="fine"> · remboursé</small>}</span><span>{e.paidOutAt?<small className="fine">Reversé le {new Date(e.paidOutAt).toLocaleDateString("fr-FR")}</small>:user?.role==="ADMIN"?<button className="button small" disabled={busy===e.id} onClick={()=>markPaid(e.id)}>Marquer comme reversé</button>:<small className="fine">{e.readyToPayOut?"Prêt à reverser":"En attente"}</small>}</span></div>)}
    </div>}
  </div></section></Layout>;
}

function AdminAvailability() {
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [form,setForm]=useState({date:"",startTime:"18:00",endTime:"20:00",durationMinutes:20});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [generating,setGenerating]=useState(false);

  const loadSlots=()=>{setLoadingSlots(true);api<any[]>("/admin/interview-slots").then(setSlots).catch(()=>setSlots([])).finally(()=>setLoadingSlots(false))};
  useEffect(()=>{loadSlots()},[]);

  const generate=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    if(!form.date){setNotice({kind:"error",text:"Choisissez une date"});return}
    setGenerating(true);
    try{
      const res=await api<{created:number;skipped:number}>("/admin/interview-slots/generate",{method:"POST",body:JSON.stringify(form)});
      setNotice({kind:"success",text:`${res.created} créneau(x) ajouté(s)${res.skipped?`, ${res.skipped} déjà existant(s) ignoré(s)`:""}.`});
      loadSlots();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setGenerating(false)}
  };
  const remove=async(slotId:string)=>{
    setNotice(null);
    try{await api(`/admin/interview-slots/${slotId}`,{method:"DELETE"});loadSlots()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const byDay=useMemo(()=>{
    const map=new Map<string,any[]>();
    for(const s of slots){const key=new Date(s.startsAt).toDateString();if(!map.has(key))map.set(key,[]);map.get(key)!.push(s)}
    return map;
  },[slots]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Agenda des entretiens</h1><p className="fine">Un seul agenda pour toute la plateforme : un seul entretien possible à la fois.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="availability-layout">
      <form className="panel availability-form" onSubmit={generate}>
        <div className="panel-title"><h2>Ajouter des créneaux</h2></div>
        <label>Date<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
        <div className="time-row"><label>Début<input type="time" required value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>Fin<input type="time" required value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label></div>
        <label>Durée par entretien (minutes)<input type="number" min={5} max={180} required value={form.durationMinutes} onChange={e=>setForm({...form,durationMinutes:Number(e.target.value)})}/></label>
        <button className="button full" disabled={generating}>{generating?"Génération…":"Générer les créneaux"}</button>
      </form>
      <div className="panel availability-list">
        <div className="panel-title"><h2>Créneaux existants</h2><span>{slots.length} créneau(x)</span></div>
        {loadingSlots?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
        :slots.length===0?<div className="empty small"><span>◇</span><p>Aucun créneau créé.</p></div>
        :<div className="stack">{[...byDay.entries()].map(([day,daySlots])=><div key={day} className="availability-day"><small>{new Date(day).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}</small><div className="slot-chip-grid">{daySlots.map(s=><div key={s.id} className={`slot-chip ${s.application?"booked":""}`}><span>{timeLabel(s.startsAt)}</span>{s.application?<small>{s.application.user.displayName}</small>:<button type="button" onClick={()=>remove(s.id)} aria-label="Supprimer le créneau">×</button>}</div>)}</div></div>)}</div>}
      </div>
    </div>
  </div></section></Layout>;
}

function AdminAttendees() {
  const [events,setEvents]=useState<any[]>([]);
  const [eventId,setEventId]=useState("");
  const [reservations,setReservations]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [requestingFor,setRequestingFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);

  useEffect(()=>{api<any[]>("/admin/events").then(evts=>{setEvents(evts);if(evts[0])setEventId(evts[0].id)})},[]);
  const load=()=>{
    if(!eventId)return;
    setLoading(true);
    api<any[]>(`/admin/events/${eventId}/reservations`).then(setReservations).catch(()=>setReservations([])).finally(()=>setLoading(false));
  };
  useEffect(()=>{load()},[eventId]);

  const requestRefund=async(paymentId:string)=>{
    setBusy(paymentId);setNotice(null);
    try{await api(`/admin/payments/${paymentId}/refund-request`,{method:"POST",body:JSON.stringify({reason})});setNotice({kind:"success",text:"Demande envoyée au super-admin."});setRequestingFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  const STATUS_LABEL:Record<string,string>={PENDING:"En attente",SUCCEEDED:"Payé",FAILED:"Échoué",REFUNDED:"Remboursé"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Participants</h1><p className="fine">Informations nécessaires à l’organisation de votre événement uniquement.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="filters"><select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(ev=><option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></div>
    {loading?<Loading/>:reservations.length===0?<div className="empty"><span>◇</span><h2>Aucun participant pour le moment</h2></div>:<div className="panel table"><div className="table-row head"><span>Participant</span><span>Catégorie</span><span>Paiement</span><span>Billet</span></div>{reservations.map(r=><div key={r.id} className="table-row"><span><b>{r.user.displayName}</b><small>{r.user.phone}</small></span><span>{r.quotaCategory??"—"}</span><span>{r.payment?STATUS_LABEL[r.payment.status]??r.payment.status:"—"}{r.payment?.status==="SUCCEEDED"&&!r.payment.refundRequestedAt&&(requestingFor===r.payment.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif du remboursement"/><button className="button small danger" disabled={busy===r.payment.id||!reason} onClick={()=>requestRefund(r.payment.id)}>Envoyer la demande</button></div>:<button type="button" className="button small secondary" onClick={()=>setRequestingFor(r.payment.id)}>Demander un remboursement</button>)}{r.payment?.refundRequestedAt&&<small className="fine">Remboursement demandé</small>}</span><span>{r.ticket?.status==="USED"?"Utilisé":r.ticket?.status==="VALID"?"Valide":r.cancelledAt?"Annulé":"En attente"}</span></div>)}</div>}
  </div></section></Layout>;
}

function AdminStaff() {
  const [items,setItems]=useState<any[]>([]);
  const [form,setForm]=useState({phone:"",displayName:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const load=()=>api<any[]>("/admin/staff").then(setItems).catch(()=>setItems([]));
  useEffect(()=>{load()},[]);
  const add=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{await api("/admin/staff",{method:"POST",body:JSON.stringify(form)});setForm({phone:"",displayName:""});setNotice({kind:"success",text:"Accès accueil activé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const revoke=async(id:string)=>{
    setBusy(true);setNotice(null);
    try{await api(`/admin/staff/${id}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Personnel d’accueil</h1><p className="fine">Ces comptes peuvent uniquement scanner les billets de votre établissement. Ils n’ont accès à aucune candidature, aucun client ni aucune donnée financière.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={add}>
      <label>Téléphone<input required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+33612345678"/></label>
      <label>Nom<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="Prénom Nom"/></label>
      <button className="button" disabled={busy}>{busy?"…":"Donner l’accès accueil"}</button>
    </form>
    {items.length===0?<div className="empty small"><span>◇</span><p>Aucun personnel d’accueil pour le moment.</p></div>:<div className="stack">{items.map(s=><article key={s.id} className="panel restaurant-request"><div><h3>{s.displayName}</h3><p>{s.phone}</p></div><button className="button danger" disabled={busy} onClick={()=>revoke(s.id)}>Retirer l’accès</button></article>)}</div>}
  </div></section></Layout>;
}

function AdminOutbox() {
  const [items,setItems]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{api<any[]>("/admin/outbox").then(setItems).finally(()=>setLoading(false))},[]);
  const STATUS_LABEL:Record<string,string>={QUEUED:"En file d’attente",SENT:"Envoyé",FAILED:"Échec d’envoi"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Notifications SMS / e-mail</h1><p className="fine left">« Envoyé » signifie accepté par le fournisseur réel (Resend pour l’e-mail). Le SMS hors connexion reste simulé pour l’instant : il n’est jamais présenté comme envoyé.</p>
    {loading?<Loading/>:items.length===0?<div className="empty"><span>◇</span><h2>Aucun message pour le moment</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Destinataire</span><span>Message</span><span>Statut</span></div>
      {items.map(m=><div key={m.id} className="table-row"><span><b>{m.channel}</b><small>{m.recipient}</small></span><span>{m.subject&&<b>{m.subject} — </b>}{m.body}</span><span>{STATUS_LABEL[m.status]??m.status}{m.error&&<small className="fine left">{m.error}</small>}</span></div>)}
    </div>}
  </div></section></Layout>;
}

function AdminModeration() {
  const {user}=useAuth();
  const [items,setItems]=useState<any[]>([]);
  const [mods,setMods]=useState<any[]>([]);
  const [modForm,setModForm]=useState({phone:"",displayName:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [busyId,setBusyId]=useState<string|null>(null);
  const load=()=>api<any[]>("/admin/reports").then(setItems);
  const loadMods=()=>api<any[]>("/admin/moderators").then(setMods);
  useEffect(()=>{load();if(user?.role==="ADMIN")loadMods()},[user?.role]);
  const decide=async(id:string,status:string)=>{
    setBusyId(id);setNotice(null);
    try{await api(`/admin/reports/${id}/decision`,{method:"POST",body:JSON.stringify({status})});setNotice({kind:"success",text:"Signalement mis à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const addMod=async(e:FormEvent)=>{
    e.preventDefault();setBusyId("mod");setNotice(null);
    try{await api("/admin/moderators",{method:"POST",body:JSON.stringify(modForm)});setModForm({phone:"",displayName:""});await loadMods()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const revokeMod=async(id:string)=>{
    setBusyId(id);setNotice(null);
    try{await api(`/admin/moderators/${id}`,{method:"DELETE"});await loadMods()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const STATUS_LABEL:Record<string,string>={OPEN:"Ouvert",REVIEWING:"En cours d’examen",RESOLVED:"Résolu",DISMISSED:"Classé sans suite"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">MODÉRATION</span><h1>Signalements</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {user?.role==="ADMIN"&&<div className="panel form-grid"><div className="panel-title"><h2>Modérateurs</h2><span>Personnes autorisées à traiter les signalements</span></div>
      {mods.length>0&&<div className="stack">{mods.map(m=><div key={m.id} className="table-row"><span><b>{m.displayName}</b> · {m.phone}</span><button type="button" className="button danger small" disabled={busyId===m.id} onClick={()=>revokeMod(m.id)}>Retirer</button></div>)}</div>}
      <form className="time-row wide" onSubmit={addMod}><input required placeholder="+33612345678" value={modForm.phone} onChange={e=>setModForm({...modForm,phone:e.target.value})}/><input placeholder="Nom" value={modForm.displayName} onChange={e=>setModForm({...modForm,displayName:e.target.value})}/><button className="button" disabled={busyId==="mod"}>Nommer modérateur</button></form>
    </div>}
    {items.length===0?<div className="empty"><span>◇</span><h2>Aucun signalement</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request"><div><h3>{r.reporter.displayName} → {r.reported.displayName}</h3><p>{r.reason}</p>{r.details&&<p className="fine left">{r.details}</p>}<small>{STATUS_LABEL[r.status]??r.status} · {dateTime(r.createdAt)}</small></div>{!["RESOLVED","DISMISSED"].includes(r.status)&&<div className="decision-buttons"><button className="button" disabled={busyId===r.id} onClick={()=>decide(r.id,"REVIEWING")}>Mettre en examen</button><button className="button" disabled={busyId===r.id} onClick={()=>decide(r.id,"RESOLVED")}>Résoudre</button><button className="button danger" disabled={busyId===r.id} onClick={()=>decide(r.id,"DISMISSED")}>Classer</button></div>}</article>)}</div>}
  </div></section></Layout>;
}

function Scanner() {
  const [code,setCode]=useState("");
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState("");
  const [cameraError,setCameraError]=useState("");
  const [scanning,setScanning]=useState(false);
  const videoRef=useRef<HTMLVideoElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const rafRef=useRef<number|null>(null);
  const lastScanRef=useRef<{code:string;at:number}>({code:"",at:0});
  const busyRef=useRef(false);

  const runScan=async(scannedCode:string)=>{
    if(!scannedCode||busyRef.current)return;
    busyRef.current=true;setResult(null);setError("");
    try{setResult(await api("/admin/tickets/scan",{method:"POST",body:JSON.stringify({code:scannedCode})}))}
    catch(err){setError((err as Error).message)}
    finally{busyRef.current=false}
  };
  const submitManual=(e:FormEvent)=>{e.preventDefault();runScan(code)};

  useEffect(()=>{
    let cancelled=false;
    if(!window.isSecureContext){setCameraError("La caméra nécessite une connexion sécurisée (HTTPS). Utilisez la saisie manuelle ci-dessous.");return}
    if(!navigator.mediaDevices?.getUserMedia){setCameraError("Caméra non prise en charge par ce navigateur. Utilisez la saisie manuelle ci-dessous.");return}
    const tick=()=>{
      const video=videoRef.current,canvas=canvasRef.current;
      if(video&&canvas&&video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        const ctx=canvas.getContext("2d");
        if(ctx){
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
          const found=jsQR(imageData.data,imageData.width,imageData.height);
          if(found?.data){
            const now=Date.now();
            if(found.data!==lastScanRef.current.code||now-lastScanRef.current.at>3000){
              lastScanRef.current={code:found.data,at:now};
              runScan(found.data);
            }
          }
        }
      }
      rafRef.current=requestAnimationFrame(tick);
    };
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
      .then(stream=>{
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return}
        streamRef.current=stream;
        if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{})}
        setScanning(true);
        rafRef.current=requestAnimationFrame(tick);
      })
      .catch(()=>setCameraError("Accès à la caméra refusé ou indisponible. Utilisez la saisie manuelle ci-dessous."));
    return ()=>{
      cancelled=true;
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ACCUEIL</span><h1>Scanner un billet</h1><div className="scanner-layout"><div className="scanner panel">
    <div className="scan-frame">
      {cameraError?<div className="camera-fallback"><span>QR</span><p>{cameraError}</p></div>
      :<video ref={videoRef} muted playsInline/>}
      {scanning&&<span className="camera-live">● Caméra active</span>}
    </div>
    <canvas ref={canvasRef} style={{display:"none"}}/>
    <form className="manual-fallback" onSubmit={submitManual}><label>Saisie manuelle (secours)<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Code du billet"/></label><button className="button full">Vérifier et valider l’entrée</button></form>
  </div><aside className={`scan-result panel ${result?"success":error?"error":""}`}>{result?<><b>✓</b><h2>Entrée autorisée</h2><p>{result.participant}</p><span>{result.event}</span></>:error?<><b>×</b><h2>Entrée refusée</h2><p>{error}</p></>:<><b>⌗</b><h2>En attente d’un billet</h2><p>Présentez le QR code du billet devant la caméra, ou saisissez le code manuellement.</p></>}</aside></div></div></section></Layout>;
}

export function App(){return <AuthProvider><Routes><Route path="/" element={<Home/>}/><Route path="/events" element={<Events/>}/><Route path="/events/:id" element={<EventDetail/>}/><Route path="/login" element={<Login/>}/><Route path="/dashboard" element={<Protected roles={["PARTICIPANT"]}><Dashboard/></Protected>}/><Route path="/admin" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION","MODERATOR"]}><Admin/></Protected>}/><Route path="/admin/applications" element={<Protected roles={["ADMIN"]}><AdminGlobalInterviews/></Protected>}/><Route path="/admin/availability" element={<Protected roles={["ADMIN"]}><AdminAvailability/></Protected>}/><Route path="/admin/events/new" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminCreateEvent/></Protected>}/><Route path="/admin/events" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminEventPhotos/></Protected>}/><Route path="/admin/attendees" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminAttendees/></Protected>}/><Route path="/admin/finance" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminFinance/></Protected>}/><Route path="/admin/staff" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminStaff/></Protected>}/><Route path="/admin/moderation" element={<Protected roles={["ADMIN","MODERATOR"]}><AdminModeration/></Protected>}/><Route path="/admin/outbox" element={<Protected roles={["ADMIN"]}><AdminOutbox/></Protected>}/><Route path="/admin/restaurants" element={<Protected roles={["ADMIN"]}><AdminRestaurants/></Protected>}/><Route path="/admin/scanner" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION"]}><Scanner/></Protected>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AuthProvider>}
