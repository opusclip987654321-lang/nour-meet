import { NETWORKING_QUESTIONS, SCREENING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import type { PublicEvent } from "@nour/shared";
import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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

export function EventDetail() {
  const {id}=useParams(); const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const [event,setEvent]=useState<PublicEvent|null>(null);
  const [application,setApplication]=useState<any>(null);
  const [loadingApplication,setLoadingApplication]=useState(true);
  const [notice,setNotice]=useState<{kind:"error"|"success"|"info";text:string}|null>(null);
  const [waitlistEntry,setWaitlistEntry]=useState<any>(null);
  const [altOffer,setAltOffer]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [showQuestionnaire,setShowQuestionnaire]=useState(false);

  useEffect(()=>{api<PublicEvent>(`/events/${id}`).then(setEvent)},[id]);

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
  return <Layout><section className="event-hero" style={{backgroundImage:`linear-gradient(180deg,#0b0b0cb0,#0b0b0ce6),url(${imgUrl(event.imageUrl)})`}}><CategoryBadge category={event.category} className="inline"/> <span className={`flow-badge ${requiresScreening?"screening":"direct"}`}>{requiresScreening?"◆ Sélection":"● Accès direct"}</span><h1>{event.title}</h1><p>{event.description}</p></section>{event.photos.length>0&&<section className="event-gallery">{event.photos.map((url,i)=><img key={i} src={imgUrl(url)} alt=""/>)}</section>}<section className="event-layout"><article><div className="facts"><div><small>DATE</small><b>{dateTime(event.startsAt)}</b></div><div><small>LIEU</small><b>{event.district}</b></div>{(event.minAge||event.maxAge)&&<div><small>TRANCHE D’ÂGE</small><b>{event.minAge&&event.maxAge?`${event.minAge}-${event.maxAge} ans`:event.minAge?`${event.minAge} ans et plus`:`Jusqu’à ${event.maxAge} ans`}</b></div>}<div><small>ORGANISATEUR</small><b>{event.organizer.name}</b></div></div><h2>Une expérience pensée pour de vraies rencontres</h2><p>Accueil personnalisé, animation légère, temps libres et respect de la confidentialité.</p>{(perkLabels.length>0||event.perks.description)&&<div className="event-perks">{perkLabels.map(l=><span key={l}>{l}</span>)}{event.perks.description&&<span>{event.perks.description}</span>}</div>}<ul><li>{requiresScreening?"Profils sélectionnés":"Inscription directe"}</li><li>QR code d’entrée unique</li><li>Code de contact privé</li><li>Équipe présente sur place</li></ul><div className="cancellation-policy"><small>POLITIQUE D’ANNULATION</small><p>Annulation gratuite jusqu’à 24 heures avant l’événement : remboursement intégral automatique. Passé ce délai, aucun remboursement n’est possible de plein droit.</p></div></article><aside className="booking"><ShareButton event={event}/><small>{event.priceTiers.length>0?"TARIFS":"À PARTIR DE"}</small>{event.priceTiers.length>0?<div className="quota-rows">{event.priceTiers.map(t=><div key={t.category} className="quota-row"><span>{t.category==="HOMME"?"Hommes":"Femmes"}</span><b>{money(t.amountCents)}</b></div>)}</div>:<strong>{money(event.priceCents)}</strong>}<div><span>Disponibilité</span><b>{availabilityLabel(event.availability)}</b></div>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}{application&&<p className="fine status-line">Statut : <b>{APPLICATION_STATUS_LABEL[application.status]??application.status}</b></p>}
    {altOffer&&<div className="alt-offer"><span className="eyebrow">ÉVÉNEMENT ALTERNATIF PROPOSÉ</span><h3>{altOffer.alternativeEvent.title}</h3><p>{dateTime(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</p><p><b>{money(altOffer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busy} onClick={()=>respondAltOffer(true)}>Accepter</button><button className="button secondary" disabled={busy} onClick={()=>respondAltOffer(false)}>Refuser</button></div></div>}
    {!user?<Link className="button full" to="/login">Se connecter pour vous inscrire</Link>
    :loadingApplication?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
    :application?<>
      <ApplicationStatusPanel application={application} event={event} onPaid={refreshApplication} onWaitlisted={markWaitlisted}/>
      {waitlistEntry?<div className="waitlist-status"><span className="eyebrow">LISTE D’ATTENTE</span><p>Position {waitlistEntry.rank??waitlistEntry.position}{waitlistEntry.offeredAt?" — une place vous a été proposée, consultez votre espace personnel":""}</p><button className="button secondary small" disabled={busy} onClick={leaveWaitlist}>Quitter la liste d’attente</button></div>
      :(categoryUnknown?<Notice kind="error">Complétez votre catégorie dans votre profil pour rejoindre la liste d’attente.</Notice>:(bucketFull&&canCancel&&<button className="button secondary full" disabled={busy} onClick={joinWaitlist}>Rejoindre la liste d’attente</button>))}
      {canCancel&&<button className="button danger full" disabled={busy} onClick={cancelApplication}>Annuler mon inscription</button>}
    </>
    :user.hasRestaurant?<Notice kind="info">Votre compte restaurateur vous permet de découvrir les événements proposés, mais ne permet pas d’y participer.</Notice>
    :requiresScreening&&!profileValidated?<Notice kind="error">Votre profil doit d’abord être validé lors d’un entretien avec Nour Meet avant de vous inscrire à un speed dating. <Link to="/dashboard">Demander mon entretien →</Link></Notice>
    :categoryUnknown?<Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement.</Notice>
    :requiresScreening&&showQuestionnaire?<QuestionnaireForm requiresScreening={requiresScreening} submitting={busy} onSubmit={apply}/>
    :<>{bucketFull&&<Notice kind="info">Cet événement est complet pour votre catégorie, mais vous pouvez tout de même candidater : une liste d’attente et une éventuelle proposition alternative vous seront proposées au moment de payer.</Notice>}<button className="button full" disabled={busy} onClick={()=>requiresScreening?setShowQuestionnaire(true):apply()}>{requiresScreening?"Candidater":busy?"…":"S’inscrire"}</button></>}
    <p className="fine">{requiresScreening?"Le paiement est proposé immédiatement après le questionnaire ; la place n’est acquise qu’une fois le paiement confirmé.":"Le paiement est proposé immédiatement après l’inscription ; la place n’est acquise qu’une fois le paiement confirmé."}</p></aside></section></Layout>;
}
