import { CheckCircle2, ChevronRight, Hourglass, Inbox } from "lucide-react";
import { MINIMUM_AGE, isAdult } from "@nour/shared";
import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { CallCalendar } from "../components/CallCalendar";
import { Layout } from "../components/Layout";
import { Avatar, CategoryBadge, Loading, Notice } from "../components/ui";
import { dateTime, imgUrl, money } from "../lib/format";
import { APPLICATION_STATUS_LABEL } from "../lib/labels";
import { ContactsPanel } from "./ContactsPanel";

// Stripe (≈ 90 ko) ne se charge qu'à l'ouverture du paiement, jamais avec la page (corrections web 2026-09-24, §11).
const PaymentModal = lazy(() => import("../components/payment").then(m => ({ default: m.PaymentModal })));

function ProfileEditor({onSaved}:{onSaved:()=>void}) {
  const {user}=useAuth(); const [form,setForm]=useState({displayName:user?.displayName??"",email:user?.email??"",birthDate:user?.profile?.birthDate?String(user.profile.birthDate).slice(0,10):"",city:user?.profile?.city??"",profession:user?.profile?.profession??"",interests:(user?.profile?.interests??[]).join(", "),bio:user?.profile?.bio??"",quotaCategory:user?.profile?.quotaCategory??""});const [message,setMessage]=useState("");const [error,setError]=useState("");
  const [photoBusy,setPhotoBusy]=useState(false);
  // CGU §2 : date de naissance obligatoire (personne majeure) et acceptation des CGU en vigueur, une
  // seule fois par version — la case disparaît dès que l'API confirme l'acceptation (user.cguAccepted).
  const [acceptCgu,setAcceptCgu]=useState(false);
  const maxBirthDate=useMemo(()=>{const d=new Date();d.setFullYear(d.getFullYear()-MINIMUM_AGE);return d.toISOString().slice(0,10)},[]);
  const save=async(e:FormEvent)=>{
    e.preventDefault();setMessage("");setError("");
    if(!isAdult(form.birthDate)){setError(`Nūr Meet est réservé aux personnes de ${MINIMUM_AGE} ans et plus.`);return}
    if(!user?.cguAccepted&&!acceptCgu){setError("Vous devez accepter les conditions générales d’utilisation pour continuer.");return}
    try{await api("/me/profile",{method:"PATCH",body:JSON.stringify({...form,email:form.email||null,quotaCategory:form.quotaCategory||null,interests:form.interests.split(",").map((x:string)=>x.trim()).filter(Boolean),...(acceptCgu?{acceptCgu:true}:{})})});setMessage("Profil enregistré.");onSaved()}
    catch(err){setError((err as Error).message)}
  };
  const uploadPhoto=async(file:File)=>{
    setPhotoBusy(true);setMessage("");
    try{const body=new FormData();body.append("file",file);await api("/me/profile-photo",{method:"POST",body});onSaved()}
    catch(err){setMessage((err as Error).message)}
    finally{setPhotoBusy(false)}
  };
  const removePhoto=async()=>{
    setPhotoBusy(true);setMessage("");
    try{await api("/me/profile-photo",{method:"DELETE"});onSaved()}
    catch(err){setMessage((err as Error).message)}
    finally{setPhotoBusy(false)}
  };
  return <form className="panel form-grid" onSubmit={save}><div className="panel-title"><h2>Mon profil</h2><span>Informations privées</span></div>{message&&<Notice kind="success">{message}</Notice>}{error&&<Notice kind="error">{error}</Notice>}
    <div className="wide profile-photo-editor"><Avatar name={user?.displayName} photoUrl={user?.profile?.photoUrl} size="large" verified={!!user?.profile?.validatedAt}/><div>
      <label className="button small secondary">{photoBusy?"Envoi…":user?.profile?.photoUrl?"Changer la photo":"Ajouter une photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={photoBusy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadPhoto(f);e.target.value=""}}/></label>
      {user?.profile?.photoUrl&&<button type="button" className="link-button" disabled={photoBusy} onClick={removePhoto}>Retirer</button>}
      <p className="fine left">JPEG, PNG ou WEBP · 5 Mo maximum. Visible par les personnes avec qui vous échangez.</p>
    </div></div>
    <label>Prénom ou pseudonyme<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label><label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Date de naissance<input type="date" required max={maxBirthDate} value={form.birthDate} onChange={e=>setForm({...form,birthDate:e.target.value})}/></label><label>Ville<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label><label>Profession<input value={form.profession} onChange={e=>setForm({...form,profession:e.target.value})}/></label><label>Centres d’intérêt<input value={form.interests} onChange={e=>setForm({...form,interests:e.target.value})}/></label><label>Sexe<div className="chip-toggle">{([["","Non renseigné"],["HOMME","Homme"],["FEMME","Femme"]] as const).map(([value,label])=><button key={value} type="button" className={"chip"+(form.quotaCategory===value?" active":"")} onClick={()=>setForm({...form,quotaCategory:value})}>{label}</button>)}</div></label><label className="wide">Biographie<textarea value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})}/></label>{!user?.cguAccepted&&<label className="wide consent-check"><input type="checkbox" checked={acceptCgu} onChange={e=>setAcceptCgu(e.target.checked)}/> <span>Je certifie avoir {MINIMUM_AGE} ans ou plus et j’accepte les <Link to="/legal/cgu" target="_blank">conditions générales d’utilisation</Link>. Mes données sont traitées conformément à la <Link to="/legal/confidentialite" target="_blank">politique de confidentialité</Link>.</span></label>}<button className="button">Enregistrer</button></form>;
}

// Droits RGPD (§20) : export en un clic, et suppression en deux étapes (jamais un seul clic pour
// une action irréversible) qui déconnecte immédiatement puisque le compte n'est plus utilisable.
function PrivacyPanel() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const download = async () => {
    setBusy(true); setNotice(null);
    try {
      const data = await api<object>("/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `nour-meet-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setNotice({ kind: "error", text: (err as Error).message }) }
    finally { setBusy(false) }
  };

  const confirmDeletion = async () => {
    setBusy(true); setNotice(null);
    try { await api("/me/request-deletion", { method: "POST" }); logout() }
    catch (err) { setNotice({ kind: "error", text: (err as Error).message }); setBusy(false) }
  };

  return <div className="panel">
    <div className="panel-title"><h2>Mes données</h2><span>RGPD</span></div>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <p className="fine left">Téléchargez une copie de tout ce que nous détenons sur votre compte (profil, candidatures, réservations, paiements), ou demandez la suppression de votre compte.</p>
    <div className="decision-buttons">
      <button type="button" className="button secondary" disabled={busy} onClick={download}>Télécharger mes données</button>
      {!confirming
        ? <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(true)}>Supprimer mon compte</button>
        : <button type="button" className="button danger" disabled={busy} onClick={confirmDeletion}>Confirmer la suppression définitive</button>}
    </div>
    {confirming && <p className="fine left">Vos coordonnées et informations personnelles seront anonymisées ; les paiements déjà effectués restent conservés à des fins comptables et légales. Cette action est irréversible. Si vous avez une réservation active pour un événement à venir, annulez-la d’abord.</p>}
  </div>;
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
    :status.call?<div className="call-scheduled"><span className="eyebrow">Entretien programmé</span><strong>{dateTime(status.call.startsAt)}</strong><p>Nour Meet vous appellera à cette heure, puis vous serez informé(e) de la décision.</p><button type="button" className="button secondary small" disabled={busy} onClick={cancel}>Annuler</button></div>
    :null}
  </div>;
}

// Signalement (CGU §8) : une personne rencontrée via Nour Meet — demande de contact envoyée ou
// reçue, ou conversation — peut être signalée à l'équipe de modération. Le blocage (activé par
// défaut) ferme aussi toute conversation commune, dans les deux sens.
const REPORT_REASONS=["Comportement irrespectueux ou harcèlement","Propos ou contenus déplacés","Faux profil ou usurpation d’identité","Demande d’argent ou arnaque","Comportement inapproprié lors d’une soirée","Autre"];
function ReportPanel() {
  const {user}=useAuth();
  const [people,setPeople]=useState<{id:string;name:string}[]|null>(null);
  const [form,setForm]=useState({reportedId:"",reason:"",details:"",block:true});
  const [sending,setSending]=useState(false);
  const [notice,setNotice]=useState<{kind:"success"|"error";text:string}|null>(null);
  useEffect(()=>{
    Promise.all([api<any[]>("/me/contact-requests").catch(()=>[]),api<any[]>("/conversations").catch(()=>[])]).then(([requests,convos])=>{
      const map=new Map<string,string>();
      for(const r of requests){const other=r.requesterId===user?.id?r.recipient:r.requester;if(other)map.set(other.id,other.displayName)}
      for(const c of convos)for(const m of c.members??[])if(m.userId!==user?.id&&m.user)map.set(m.userId,m.user.displayName);
      setPeople([...map].map(([id,name])=>({id,name})));
    });
  },[user?.id]);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    if(!form.reportedId||!form.reason){setNotice({kind:"error",text:"Choisissez la personne concernée et le motif du signalement."});return}
    setSending(true);
    try{await api("/reports",{method:"POST",body:JSON.stringify({reportedId:form.reportedId,reason:form.reason,details:form.details||undefined,block:form.block})});setNotice({kind:"success",text:"Merci. Votre signalement a été transmis à l’équipe de modération, qui l’examinera rapidement."});setForm({reportedId:"",reason:"",details:"",block:true})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSending(false)}
  };
  return <form className="panel form-grid" onSubmit={submit} noValidate>
    <div className="panel-title"><h2>Signaler une personne</h2><span>Confidentiel</span></div>
    <p className="fine left wide">La personne n’est pas informée de votre signalement. En cas d’urgence ou de danger, contactez le 17. Vous pouvez aussi écrire à <a className="text-link" href="mailto:contact@nourmeet.com">contact@nourmeet.com</a>.</p>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {people===null?<div className="skeleton wide" style={{height:48}}/>:people.length===0
      ?<p className="wide" style={{margin:0,color:"var(--ink-2)"}}>Vous n’avez encore été en contact avec personne via Nour Meet. Pour un problème survenu lors d’une soirée, écrivez-nous à contact@nourmeet.com.</p>
      :<>
        <label>Personne concernée<select value={form.reportedId} onChange={e=>setForm({...form,reportedId:e.target.value})} required><option value="">Choisir…</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Motif<select value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} required><option value="">Choisir…</option>{REPORT_REASONS.map(r=><option key={r}>{r}</option>)}</select></label>
        <label className="wide">Précisions (facultatif)<textarea maxLength={1000} value={form.details} onChange={e=>setForm({...form,details:e.target.value})} placeholder="Ce qui s’est passé, quand, et tout élément utile à l’équipe."/></label>
        <label className="consent-check wide"><input type="checkbox" checked={form.block} onChange={e=>setForm({...form,block:e.target.checked})}/><span>Bloquer aussi cette personne : plus aucun message ni demande de contact entre vous.</span></label>
        <button className="button danger" disabled={sending}>{sending?"Envoi…":"Envoyer le signalement"}</button>
      </>}
  </form>;
}

export function Dashboard() {
  const {user,refresh}=useAuth(); const [searchParams]=useSearchParams();
  // C14 (ordre correctif 2026-09-20) : permet aux notifications de renvoyer vers un onglet précis,
  // ex. /dashboard?tab=tickets, plutôt qu'un lien générique vers l'espace participant.
  const [apps,setApps]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[offers,setOffers]=useState<any[]>([]),[tab,setTab]=useState(searchParams.get("tab")??"reservations"),[payingFor,setPayingFor]=useState<{applicationId:string;eventId:string;amountCents:number}|null>(null),[busyId,setBusyId]=useState<string|null>(null),[message,setMessage]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/me/applications"),api<any[]>("/me/tickets"),api<any[]>("/me/alternative-offers")]).then(([a,t,o])=>{setApps(a);setTickets(t);setOffers(o);setLoaded(true)}); useEffect(()=>{load()},[]);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{const t=searchParams.get("tab");if(t)setTab(t)},[searchParams]);
  // §4.3 (corrections web 2026-09-24) : une notification mène à l'inscription ou au billet précis
  // (?application=… ou ?reservation=…) — la carte correspondante est amenée à l'écran et mise en évidence.
  const focusId=searchParams.get("application")??searchParams.get("reservation");
  const focusRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{if(loaded&&focusId&&focusRef.current){focusRef.current.scrollIntoView({behavior:"smooth",block:"center"});focusRef.current.focus({preventScroll:true})}},[loaded,focusId,tab]);
  // Un compte restaurateur n'a rien à faire dans l'espace participant (§5) : on le renvoie vers sa
  // propre fiche établissement plutôt que de lui laisser voir un tableau de bord vide. Ce contrôle
  // vient après tous les hooks du composant : jamais avant, pour ne pas en varier le nombre au fil des
  // rendus (règle des Hooks).
  if(user?.hasRestaurant)return <Navigate to="/restaurant" replace/>;
  // §4.1 : les notifications ont quitté les onglets de l'espace pour la cloche et /notifications.
  if(tab==="notifications")return <Navigate to="/notifications" replace/>;
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
  const ticketsLabel=tickets.length===1?"Mon billet":"Mes billets";
  const tabs=[["interview","Entretien"],["reservations","Réservations"],["tickets",ticketsLabel],["contacts","Contacts"],["profile","Profil"],["report","Signaler"]];
  const titles:Record<string,string>={interview:"Entretien de validation",reservations:"Mes événements",tickets:ticketsLabel,contacts:"Mes contacts",profile:"Mon profil",report:"Signaler un problème"};
  return <Layout><section className="dashboard-shell"><aside><div className="profile-card"><Avatar name={user?.displayName} photoUrl={user?.profile?.photoUrl} size="large" verified={!!user?.profile?.validatedAt}/><h3>{user?.displayName}</h3><span>{user?.profile?.validatedAt?"Profil validé":"Profil à compléter"}</span></div>{tabs.map(([id,label])=><button className={tab===id?"active":""} aria-current={tab===id?"page":undefined} onClick={()=>setTab(id)} key={id}>{label}{id==="interview"&&user?.profile?.validatedAt&&<CheckCircle2 size={16} aria-label="validé" className="tab-done"/>}<ChevronRight size={16} aria-hidden="true"/></button>)}</aside><div className="dashboard-content"><h1>{titles[tab]}</h1>{message&&<Notice kind={message.kind}>{message.text}</Notice>}{tab==="interview"&&<GlobalInterviewPanel/>}{tab==="reservations"&&<div className="stack">{eventApps.length===0?<div className="empty small"><Inbox size={24} aria-hidden="true"/><p>Aucune inscription pour le moment.</p></div>:eventApps.map(a=>{const offersForEvent=pendingOffers.filter(o=>o.originalEventId===a.eventId);const focused=focusId===a.id;const waitlisted=!!a.waitlistEntry&&a.status==="PAYMENT_PENDING";return <article className={`reservation${focused?" focused":""}`} key={a.id} id={`inscription-${a.id}`} tabIndex={focused?-1:undefined} ref={focused?el=>{focusRef.current=el}:undefined}><img className="reservation-photo" src={imgUrl(a.event.imageUrl)} alt=""/><div><div className="admin-event-meta"><CategoryBadge category={a.event.category} className="inline"/>{waitlisted?<span className="viewer-badge waitlist"><Hourglass size={14} aria-hidden="true"/>Liste d’attente</span>:<small>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</small>}</div><h3>{a.event.title}</h3><p>{dateTime(a.event.startsAt)} · {a.event.district}</p>{a.call&&a.status==="CALL_SCHEDULED"&&<p className="call-hint">Entretien : {dateTime(a.call.startsAt)}</p>}{waitlisted&&<p className="fine left">Soirée complète pour le moment : dès qu’une place se libère, vous êtes prévenu(e) et elle revient à la première personne qui finalise son paiement.</p>}</div><div className="reservation-actions">{a.status==="PAYMENT_PENDING"&&(waitlisted?<Link className="button secondary small" to={`/events/${a.event.slug}`}>Voir la soirée</Link>:a.event.priceCents===0?<button className="button" onClick={()=>setPayingFor({applicationId:a.id,eventId:a.event.id,amountCents:0})}>Confirmer ma place (gratuit)</button>:<button className="button" onClick={()=>setPayingFor({applicationId:a.id,eventId:a.event.id,amountCents:a.event.priceCents})}>Payer par carte · {money(a.event.priceCents)}</button>)}{!["REFUSED","CANCELLED"].includes(a.status)&&<button className="button secondary small" disabled={busyId===a.id} onClick={()=>cancelApplication(a.id)}>Annuler ma participation</button>}</div>{offersForEvent.length>0&&<div className="alt-offers"><p className="alt-offers-title">Soirées similaires proposées pour vous</p>{offersForEvent.map(offer=><article className="alt-offer" key={offer.id}><span className="eyebrow">Événement alternatif proposé</span><h3>{offer.alternativeEvent.title}</h3><p>{dateTime(offer.alternativeEvent.startsAt)} · {offer.alternativeEvent.district}</p><p><b>{money(offer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busyId===offer.id} onClick={()=>respondOffer(offer.id,true)}>Accepter</button><button className="button secondary" disabled={busyId===offer.id} onClick={()=>respondOffer(offer.id,false)}>Refuser</button></div></article>)}</div>}</article>;})}</div>}{tab==="tickets"&&<div className="ticket-grid">{tickets.length===0&&<div className="empty small"><Inbox size={24} aria-hidden="true"/><p>Aucun billet pour le moment : il apparaît ici dès que votre place est confirmée.</p></div>}{tickets.map(t=>{const focused=focusId===t.reservationId;return <article className={`ticket${focused?" focused":""}`} key={t.id} tabIndex={focused?-1:undefined} ref={focused?el=>{focusRef.current=el}:undefined}><div><div className="admin-event-meta"><CategoryBadge category={t.reservation.event.category} className="inline"/></div><span className="eyebrow">{dateTime(t.reservation.event.startsAt)}</span><h2>{t.reservation.event.title}</h2>{t.reservation.event.controllerRestaurant&&<p>{t.reservation.event.controllerRestaurant.name}</p>}<p>{t.reservation.event.address?`${t.reservation.event.address} · ${t.reservation.event.district}`:t.reservation.event.district}</p></div><img src={t.qrDataUrl} alt={`QR code du billet ${t.code}`}/><b>{t.code}</b></article>})}</div>}{tab==="profile"&&<div className="stack"><ProfileEditor onSaved={refresh}/><PrivacyPanel/></div>}{tab==="contacts"&&<ContactsPanel/>}{tab==="report"&&<ReportPanel/>}</div></section>
  {payingFor&&<Suspense fallback={null}><PaymentModal applicationId={payingFor.applicationId} eventId={payingFor.eventId} amountCents={payingFor.amountCents} onClose={()=>setPayingFor(null)} onConfirmed={()=>{setPayingFor(null);load()}} onWaitlisted={()=>{setPayingFor(null);load()}}/></Suspense>}
  </Layout>;
}
