import { NETWORKING_QUESTIONS, SCREENING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import type { PublicEvent } from "@nour/shared";
import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, Clock, Info, MapPin, ShieldCheck, Store, Ticket, Users, UserCheck } from "lucide-react";
import { ProgressiveBlur } from "../components/brand";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { PaymentModal } from "../components/payment";
import { CategoryBadge, Loading, Notice, ShareButton, availabilityLabel } from "../components/ui";
import { dateTime, imgUrl, money } from "../lib/format";
import { APPLICATION_STATUS_LABEL } from "../lib/labels";

// Arbitrage 12/E3 (cahier des charges consolidé 2026-09-20) : proposé uniquement une fois la place
// confirmée, jamais avant ou pendant le paiement, et entièrement facultatif — "Plus tard" ne bloque
// rien et ne réapparaît que lors d'une prochaine visite de cette page.
function NetworkingFollowUp({ applicationId }: { applicationId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (dismissed || done) return done ? <Notice kind="success">Merci, vos informations professionnelles ont été enregistrées.</Notice> : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    try { await api(`/applications/${applicationId}/networking-answers`, { method: "POST", body: JSON.stringify(answers) }); setDone(true); }
    catch { setDismissed(true); }
    finally { setSubmitting(false); }
  };
  return <form className="questionnaire" onSubmit={submit}>
    <p className="fine">Facultatif : quelques informations professionnelles pour mieux organiser la soirée.</p>
    {NETWORKING_QUESTIONS.map(q => <label key={q.key}>{q.label}<textarea value={answers[q.key] ?? ""} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })}/></label>)}
    <div className="decision-buttons">
      <button className="button" disabled={submitting}>{submitting ? "Envoi…" : "Envoyer"}</button>
      <button type="button" className="button secondary" onClick={() => setDismissed(true)}>Plus tard</button>
    </div>
  </form>;
}

function ApplicationStatusPanel({ application, event, onPaid, onWaitlisted }: { application: any; event: PublicEvent; onPaid: () => void; onWaitlisted: () => void }) {
  const [showPayment, setShowPayment] = useState(false);
  if (application.status === "REFUSED") return <Notice kind="error">Votre candidature n’a pas été retenue pour cet événement.</Notice>;
  if (application.status === "CANCELLED") return <Notice kind="error">Cette candidature a été annulée.</Notice>;
  if (application.status === "CONFIRMED") return <>
    <Notice kind="success">Votre place est confirmée. Retrouvez votre billet dans votre espace personnel.</Notice>
    {!eventRequiresScreening(event) && !application.networkingAnswer && <NetworkingFollowUp applicationId={application.id}/>}
  </>;
  // La candidature autorise à tenter le paiement, elle ne garantit jamais de place à elle seule
  // (§5) : le clic sur "Payer" est ce qui pose réellement le verrou, via PaymentModal.
  if (application.status === "PAYMENT_PENDING") return <div className="payment-block">
    <Notice kind="success">{application.reservation ? `Votre place est retenue quelques minutes (jusqu’au ${dateTime(application.reservation.expiresAt)}) : finalisez votre paiement.` : "Vous pouvez régler votre billet dès maintenant."}</Notice>
    <button className="button full" onClick={() => setShowPayment(true)}>{event.priceCents === 0 ? "Confirmer ma place (gratuit)" : `Payer par carte · ${money(event.priceCents)}`}</button>
    {showPayment && <PaymentModal applicationId={application.id} eventId={event.id} amountCents={event.priceCents} onClose={() => setShowPayment(false)} onConfirmed={() => { setShowPayment(false); onPaid(); }} onWaitlisted={onWaitlisted}/>}
  </div>;
  if (application.call) return <div className="call-scheduled"><span className="eyebrow">Entretien programmé</span><strong>{dateTime(application.call.startsAt)}</strong><p>L’organisateur vous appellera à cette heure, puis vous serez informé(e) de sa décision.</p></div>;
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

export function EventDetail() {
  const {id}=useParams(); const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const [event,setEvent]=useState<PublicEvent|null>(null);
  const [notFound,setNotFound]=useState(false);
  const [application,setApplication]=useState<any>(null);
  const [loadingApplication,setLoadingApplication]=useState(true);
  const [notice,setNotice]=useState<{kind:"error"|"success"|"info";text:string}|null>(null);
  const [waitlistEntry,setWaitlistEntry]=useState<any>(null);
  const [altOffer,setAltOffer]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [showQuestionnaire,setShowQuestionnaire]=useState(false);

  // Un lien périmé ou mal copié ne doit jamais laisser la page bloquée sur « Chargement… ».
  useEffect(()=>{setNotFound(false);api<PublicEvent>(`/events/${id}`).then(setEvent).catch(()=>setNotFound(true))},[id]);

  // Partage attribué (§12) : le code de la personne qui a partagé le lien est capturé une seule
  // fois, dès la visite, puis conservé pour la candidature — jamais recalculé après coup.
  const shareCode=searchParams.get("ref");
  useEffect(()=>{
    if(!shareCode)return;
    sessionStorage.setItem(`nour_ref_${id}`,shareCode);
    api(`/share-links/${shareCode}/click`,{method:"POST"}).catch(()=>{});
  },[shareCode,id]);

  useEffect(()=>{
    if(!user||!event){setLoadingApplication(false);return}
    let ignore=false; setLoadingApplication(true);
    api<any>(`/events/${event.id}/my-application`).then(a=>!ignore&&setApplication(a)).catch(()=>!ignore&&setApplication(null)).finally(()=>!ignore&&setLoadingApplication(false));
    api<any>(`/events/${event.id}/waitlist/me`).then(w=>!ignore&&setWaitlistEntry(w)).catch(()=>!ignore&&setWaitlistEntry(null));
    api<any[]>("/me/alternative-offers").then(list=>{if(ignore)return;setAltOffer(list.find(o=>o.originalEventId===event.id&&o.status==="PENDING")??null)}).catch(()=>{});
    return ()=>{ignore=true};
  },[user,event?.id]);

  if(notFound)return <Layout><div className="state-page"><h2>Cette soirée est introuvable</h2><p className="page-lead" style={{margin:0}}>Elle a peut-être été retirée ou le lien est incomplet.</p><Link className="button" to="/events">Voir les prochaines soirées</Link></div></Layout>;
  if(!event)return <Layout><Loading/></Layout>;

  const requiresScreening = eventRequiresScreening(event);
  const profileValidated = !!user?.profile?.validatedAt;
  // C24 : plus de lecture directe de quotas bruts — la disponibilité déjà calculée côté serveur
  // pour ce visiteur (event.availability) porte toute l'information nécessaire à l'écran.
  const categoryUnknown = event.availability.kind==="unknown";
  const bucketFull = event.availability.kind!=="unknown" && event.availability.full;
  const canCancel = application && !["REFUSED","CANCELLED"].includes(application.status);

  const refreshApplication=()=>api<any>(`/events/${event.id}/my-application`).then(setApplication).catch(()=>{});
  const markWaitlisted=()=>{api<any>(`/events/${event.id}/waitlist/me`).then(setWaitlistEntry).catch(()=>{});setNotice({kind:"info",text:"Cet événement est complet pour votre catégorie : vous avez été placé(e) sur liste d’attente."})};

  // La candidature ne garantit jamais de place (§5) : elle enregistre le questionnaire (spéciale
  // dating uniquement) et autorise seulement à tenter le paiement ensuite (voir
  // ApplicationStatusPanel → PaymentModal). Arbitrage 12/E3 : un événement networking ne pose plus
  // aucune question professionnelle à ce stade — voir le formulaire facultatif post-paiement dans
  // ApplicationStatusPanel.
  const apply=async(answers?:Record<string,string>)=>{
    setBusy(true);setNotice(null);
    try{
      // Bug historique (cahier des charges consolidé 2026-09-20) : le clic est enregistré sous la
      // clé de l'URL (slug), mais la candidature relisait sous l'id réel de l'événement — deux
      // valeurs différentes qui ne coïncident jamais, donc l'attribution était silencieusement
      // perdue. On relit désormais sous la même clé que celle utilisée à l'écriture (id ci-dessus).
      const storedRef=sessionStorage.getItem(`nour_ref_${id}`)??undefined;
      const body=requiresScreening?{screeningAnswers:answers,shareCode:storedRef}:{shareCode:storedRef};
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
  const priceText=event.priceTiers.length>0?`dès ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:event.priceCents===0?"Gratuit":money(event.priceCents);
  const ageText=event.minAge&&event.maxAge?`${event.minAge} à ${event.maxAge} ans`:event.minAge?`${event.minAge} ans et plus`:event.maxAge?`Jusqu’à ${event.maxAge} ans`:null;
  const time=new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(new Date(event.startsAt)).replace(":","h");
  const day=new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long"}).format(new Date(event.startsAt));
  return <Layout><div className="event-page">
    <section className="event-hero">
      <img src={imgUrl(event.imageUrl)} alt="" width={1600} height={1000} fetchPriority="high"/>
      <ProgressiveBlur position="bottom" height="70%"/>
      <div className="event-hero-shade" aria-hidden="true"/>
      <div className="event-hero-copy">
        <div className="event-hero-badges"><CategoryBadge category={event.category} className="inline"/><span className={`flow-badge ${requiresScreening?"screening":"direct"}`}>{requiresScreening?<><UserCheck size={14} aria-hidden="true"/>Sur sélection</>:<><Ticket size={14} aria-hidden="true"/>Accès direct</>}</span></div>
        <h1>{event.title}</h1>
        <p className="event-hero-meta"><span><CalendarDays size={18} aria-hidden="true"/>{day} · {time}</span><span><MapPin size={18} aria-hidden="true"/>{event.district}</span></p>
      </div>
    </section>
    <div className="event-layout">
      <article className="event-main">
        <p className="event-lead">{event.description}</p>
        <section aria-labelledby="infos" className="event-block">
          <h2 id="infos">Infos pratiques</h2>
          <dl className="facts">
            <div><dt><CalendarDays size={18} aria-hidden="true"/>Date</dt><dd>{day}</dd></div>
            <div><dt><Clock size={18} aria-hidden="true"/>Heure</dt><dd>{time}</dd></div>
            <div><dt><MapPin size={18} aria-hidden="true"/>Lieu</dt><dd>{event.district}<small>L’adresse exacte figure sur votre billet, une fois la place confirmée.</small></dd></div>
            <div><dt><Store size={18} aria-hidden="true"/>Organisateur</dt><dd>{event.organizer.name}</dd></div>
            {ageText&&<div><dt><Users size={18} aria-hidden="true"/>Âge</dt><dd>{ageText}</dd></div>}
            <div><dt><ShieldCheck size={18} aria-hidden="true"/>Participation</dt><dd>{requiresScreening?"Profil validé lors d’un court entretien":"Inscription directe, sans entretien"}</dd></div>
          </dl>
        </section>
        {(perkLabels.length>0||event.perks.description)&&<section aria-labelledby="inclus" className="event-block"><h2 id="inclus">Compris dans le prix</h2><div className="event-perks">{perkLabels.map(l=><span key={l}>{l}</span>)}{event.perks.description&&<span>{event.perks.description}</span>}</div></section>}
        <section aria-labelledby="deroulement" className="event-block">
          <h2 id="deroulement">Comment ça se passe</h2>
          <ol className="steps compact">
            {requiresScreening?<li><b>Votre profil est validé</b><span>Un court entretien avec l’équipe, une seule fois, avant votre première soirée de rencontre.</span></li>:<li><b>Vous vous inscrivez</b><span>Aucune étape préalable : la place est à vous dès le paiement confirmé.</span></li>}
            <li><b>Vous réservez votre place</b><span>Paiement sécurisé par Stripe ; votre billet avec QR code arrive aussitôt.</span></li>
            <li><b>Le jour J</b><span>L’équipe vous accueille sur place et anime la soirée{event.hasQuotas?", avec des places équilibrées entre femmes et hommes":""}.</span></li>
            <li><b>Après la soirée</b><span>Vous pouvez demander à revoir quelqu’un ; l’échange ne s’ouvre que si l’intérêt est réciproque.</span></li>
          </ol>
        </section>
        {event.photos.length>0&&<section aria-labelledby="photos" className="event-block"><h2 id="photos">Le lieu</h2><div className="event-gallery">{event.photos.map((url,i)=><img key={i} src={imgUrl(url)} alt={`Photo ${i+1} du lieu`} loading="lazy" width={480} height={360}/>)}</div></section>}
        <section aria-labelledby="annulation" className="event-block cancellation-policy">
          <h2 id="annulation"><Info size={20} aria-hidden="true"/>Annulation</h2>
          <p>Annulation gratuite jusqu’à 24 heures avant le début de la soirée : remboursement intégral automatique. Passé ce délai, ou en cas d’absence, aucun remboursement n’est dû. Si la soirée est annulée par l’organisateur, vous êtes intégralement remboursé. <Link className="text-link" to="/legal/cgv">Conditions de vente</Link></p>
        </section>
      </article>
      <aside className="booking" id="reserver" aria-labelledby="booking-title">
        <h2 id="booking-title" className="visually-hidden">Réserver</h2>
        <div className="booking-price">{event.priceTiers.length>0?<div className="quota-rows">{event.priceTiers.map(t=><div key={t.category} className="quota-row"><span>{t.category==="HOMME"?"Hommes":"Femmes"}</span><b>{money(t.amountCents)}</b></div>)}</div>:<><strong>{priceText}</strong><span>par personne, TTC</span></>}</div>
        <div className="booking-row"><span>Disponibilité</span><b>{availabilityLabel(event.availability)}</b></div>
        {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}{application&&<p className="fine status-line">Statut : <b>{APPLICATION_STATUS_LABEL[application.status]??application.status}</b></p>}
    {altOffer&&<div className="alt-offer"><span className="eyebrow">Événement alternatif proposé</span><h3>{altOffer.alternativeEvent.title}</h3><p>{dateTime(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</p><p><b>{money(altOffer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busy} onClick={()=>respondAltOffer(true)}>Accepter</button><button className="button secondary" disabled={busy} onClick={()=>respondAltOffer(false)}>Refuser</button></div></div>}
    {!user?<Link className="button full" to="/login">Se connecter pour vous inscrire</Link>
    :loadingApplication?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
    :application?<>
      <ApplicationStatusPanel application={application} event={event} onPaid={refreshApplication} onWaitlisted={markWaitlisted}/>
      {waitlistEntry?<div className="waitlist-status"><span className="eyebrow">Liste d’attente</span><p>Position {waitlistEntry.rank??waitlistEntry.position}{waitlistEntry.offeredAt?" — une place vous a été proposée, consultez votre espace personnel":""}</p><button className="button secondary small" disabled={busy} onClick={leaveWaitlist}>Quitter la liste d’attente</button></div>
      :(categoryUnknown?<Notice kind="error">Complétez votre catégorie dans votre profil pour rejoindre la liste d’attente.</Notice>:(bucketFull&&canCancel&&<button className="button secondary full" disabled={busy} onClick={joinWaitlist}>Rejoindre la liste d’attente</button>))}
      {canCancel&&<button className="button danger full" disabled={busy} onClick={cancelApplication}>Annuler mon inscription</button>}
    </>
    :user.hasRestaurant?<Notice kind="info">Votre compte restaurateur vous permet de découvrir les événements proposés, mais ne permet pas d’y participer.</Notice>
    :requiresScreening&&!profileValidated?<Notice kind="error">Votre profil doit d’abord être validé lors d’un entretien avec Nour Meet avant de vous inscrire à un speed dating. <Link to="/dashboard">Demander mon entretien →</Link></Notice>
    :categoryUnknown?<Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement.</Notice>
    :requiresScreening&&showQuestionnaire?<QuestionnaireForm requiresScreening={requiresScreening} submitting={busy} onSubmit={apply}/>
    :<>{bucketFull&&<Notice kind="info">Cet événement est complet pour votre catégorie, mais vous pouvez tout de même candidater : une liste d’attente et une éventuelle proposition alternative vous seront proposées au moment de payer.</Notice>}<button className="button full" disabled={busy} onClick={()=>requiresScreening?setShowQuestionnaire(true):apply()}>{requiresScreening?"Candidater":busy?"…":"S’inscrire"}</button></>}
    <p className="fine">{requiresScreening?"Le paiement est proposé immédiatement après le questionnaire ; la place n’est acquise qu’une fois le paiement confirmé.":"Le paiement est proposé immédiatement après l’inscription ; la place n’est acquise qu’une fois le paiement confirmé."}</p>
        <ShareButton event={event}/>
      </aside>
    </div>
    <div className="mobile-book-bar"><div><strong>{priceText}</strong><span>{availabilityLabel(event.availability)}</span></div><a className="button" href="#reserver">Réserver</a></div>
  </div></Layout>;
}
