import { NETWORKING_QUESTIONS, SCREENING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import type { PublicEvent } from "@nour/shared";
import { FormEvent, Suspense, lazy, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, Clock, Info, MapPin, ShieldCheck, Store, Ticket, Users, UserCheck } from "lucide-react";
import { ProgressiveBlur } from "../components/brand";
import { PhoneVerification } from "../components/PhoneVerification";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { CategoryBadge, Loading, Notice, ShareButton, ViewerStatusBadge, availabilityLabel } from "../components/ui";
import { absoluteUrl, breadcrumbJsonLd, useSeo } from "../lib/seo";
import { NotFound } from "./NotFound";
import { dateTime, imgUrl, money } from "../lib/format";
import { APPLICATION_STATUS_LABEL } from "../lib/labels";

// Stripe (≈ 90 ko) ne se charge qu'à l'ouverture du paiement, jamais avec la page (corrections web 2026-09-24, §11).
const PaymentModal = lazy(() => import("../components/payment").then(m => ({ default: m.PaymentModal })));

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
  // Montant résolu par le serveur (tarif différencié compris) : jamais le prix de base de la fiche.
  const amountCents: number = application.amountCents ?? event.priceCents;
  if (application.status === "REFUSED") return <Notice kind="error">Votre candidature n’a pas été retenue pour cet événement.</Notice>;
  if (application.status === "CANCELLED") return <Notice kind="error">Cette candidature a été annulée.</Notice>;
  if (application.status === "CONFIRMED") return <>
    <Notice kind="success">Votre place est confirmée. Retrouvez votre billet dans votre espace personnel.</Notice>
    {!eventRequiresScreening(event) && !application.networkingAnswer && <NetworkingFollowUp applicationId={application.id}/>}
  </>;
  // La candidature autorise à tenter le paiement, elle ne garantit jamais de place à elle seule
  // (§5) : le clic sur "Payer" est ce qui pose réellement le verrou, via PaymentModal.
  if (application.status === "PAYMENT_PENDING") return <div className="payment-block">
    {event.viewerStatus === "WAITLIST" ? <Notice kind="info">Vous êtes sur la liste d’attente. Dès qu’une place se libère, vous êtes prévenu(e) : elle revient à la première personne qui finalise son paiement.</Notice> : <Notice kind="success">{application.reservation ? `Votre place est retenue quelques minutes (jusqu’au ${dateTime(application.reservation.expiresAt)}) : finalisez votre paiement.` : "Vous pouvez régler votre billet dès maintenant."}</Notice>}
    <button className="button full" onClick={() => setShowPayment(true)}>{amountCents === 0 ? "Confirmer ma place (gratuit)" : `Payer par carte · ${money(amountCents)}`}</button>
    {showPayment && <Suspense fallback={null}><PaymentModal applicationId={application.id} eventId={event.id} amountCents={amountCents} onClose={() => setShowPayment(false)} onConfirmed={() => { setShowPayment(false); onPaid(); }} onWaitlisted={onWaitlisted}/></Suspense>}
  </div>;
  if (application.call) return <div className="call-scheduled"><span className="eyebrow">Entretien programmé</span><strong>{dateTime(application.call.startsAt)}</strong><p>L’équipe Nūr Meet vous appellera à cette heure, puis vous serez informé(e) de sa décision.</p></div>;
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
  const [altOffers,setAltOffers]=useState<any[]>([]);
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

  const eventId=event?.id;
  useEffect(()=>{
    if(!user||!eventId){setLoadingApplication(false);return}
    let ignore=false; setLoadingApplication(true);
    api<any>(`/events/${eventId}/my-application`).then(a=>!ignore&&setApplication(a)).catch(()=>!ignore&&setApplication(null)).finally(()=>!ignore&&setLoadingApplication(false));
    api<any>(`/events/${eventId}/waitlist/me`).then(w=>!ignore&&setWaitlistEntry(w)).catch(()=>!ignore&&setWaitlistEntry(null));
    api<any[]>("/me/alternative-offers").then(list=>{if(ignore)return;setAltOffers(list.filter(o=>o.originalEventId===eventId&&o.status==="PENDING"))}).catch(()=>{});
    return ()=>{ignore=true};
  },[user,eventId]);

  // §19/§20 (corrections web 2026-09-24) : données structurées Event fidèles à la fiche affichée ; un
  // événement non réservable (données de démonstration) n'est ni indexé ni déclaré aux moteurs.
  useSeo(event?{
    title:`${event.title} · ${event.category} à ${event.district}`,
    description:event.description.slice(0,155),
    path:`/events/${event.slug}`,
    image:imgUrl(event.imageUrl),
    noindex:!event.bookable,
    jsonLd:event.bookable?[{
      "@context":"https://schema.org","@type":"Event",name:event.title,description:event.description,
      startDate:event.startsAt,endDate:event.endsAt,eventStatus:event.status==="CANCELLED"?"https://schema.org/EventCancelled":"https://schema.org/EventScheduled",
      eventAttendanceMode:"https://schema.org/OfflineEventAttendanceMode",image:[imgUrl(event.imageUrl)],
      location:{"@type":event.venue?"Restaurant":"Place",name:event.venue?.name??event.district,address:{"@type":"PostalAddress",addressLocality:event.district,addressRegion:"Île-de-France",addressCountry:"FR"}},
      organizer:{"@type":"Organization",name:event.organizer.name},
      offers:{"@type":"Offer",url:absoluteUrl(`/events/${event.slug}`),price:(event.priceCents/100).toFixed(2),priceCurrency:"EUR",availability:event.availability.kind!=="unknown"&&event.availability.full?"https://schema.org/SoldOut":"https://schema.org/InStock"},
      ...(event.minAge?{typicalAgeRange:event.maxAge?`${event.minAge}-${event.maxAge}`:`${event.minAge}-`}:{})
    },breadcrumbJsonLd([{name:"Accueil",path:"/"},{name:"Soirées",path:"/events"},{name:event.title,path:`/events/${event.slug}`}])]:null
  }:null);
  if(notFound)return <NotFound title="Cette soirée est introuvable" message="Elle a peut-être été retirée, ou le lien est incomplet."/>;
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
  // Toutes les propositions en attente, comme dans l'espace personnel — jamais seulement la première.
  const respondAltOffer=async(offerId:string,accept:boolean)=>{
    setBusy(true);setNotice(null);
    try{await api(`/alternative-offers/${offerId}/respond`,{method:"POST",body:JSON.stringify({accept})});setAltOffers(prev=>prev.filter(o=>o.id!==offerId));setNotice({kind:"success",text:accept?"Place réservée sur l’événement alternatif : consultez votre espace personnel pour payer.":"Proposition refusée."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  const perkLabels=[event.perks.drink&&"Boisson incluse",event.perks.starter&&"Entrée incluse",event.perks.main&&"Plat inclus",event.perks.dessert&&"Dessert inclus"].filter(Boolean) as string[];
  const free=event.priceTiers.length===0&&event.priceCents===0;
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
        <div className="event-hero-badges"><CategoryBadge category={event.category} className="inline"/><ViewerStatusBadge status={event.viewerStatus}/><span className={`flow-badge ${requiresScreening?"screening":"direct"}`}>{requiresScreening?<><UserCheck size={14} aria-hidden="true"/>Sur sélection</>:<><Ticket size={14} aria-hidden="true"/>Accès direct</>}</span></div>
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
            {requiresScreening?<li><b>Votre profil est validé</b><span>Un court appel avec l’équipe, une seule fois, avant votre première soirée de rencontre. <Link className="text-link" to="/concept#entretien">En savoir plus</Link></span></li>:<li><b>Vous vous inscrivez</b><span>Aucune étape préalable : la place est à vous dès {free?"votre confirmation":"le paiement confirmé"}.</span></li>}
            <li><b>Vous réservez votre place</b><span>{free?"Soirée gratuite : une simple confirmation, et votre billet avec QR code arrive aussitôt.":"Paiement sécurisé par Stripe ; votre billet avec QR code arrive aussitôt."}</span></li>
            <li><b>Le jour J</b><span>L’équipe vous accueille sur place et anime la soirée{event.hasQuotas?", avec des places équilibrées entre femmes et hommes":""}.</span></li>
            <li><b>Après la soirée</b><span>Échangez vos codes sur place ; la conversation ne s’ouvre que si l’intérêt est réciproque. <Link className="text-link" to="/concept#garder-contact">Voir comment</Link></span></li>
          </ol>
        </section>
        {event.photos.length>0&&<section aria-labelledby="photos" className="event-block"><h2 id="photos">Le lieu</h2><div className="event-gallery">{event.photos.map((url,i)=><img key={i} src={imgUrl(url)} alt={`Photo ${i+1} du lieu`} loading="lazy" width={480} height={360}/>)}</div></section>}
        <section aria-labelledby="annulation" className="event-block cancellation-policy">
          <h2 id="annulation"><Info size={20} aria-hidden="true"/>Annulation</h2>
          <p>Annulation gratuite jusqu’à 24 heures avant le début de la soirée : remboursement intégral automatique. Passé ce délai, ou en cas d’absence, aucun remboursement n’est dû. Si la soirée est annulée par l’organisateur, vous êtes intégralement remboursé(e). <Link className="text-link" to="/legal/cgv">Conditions de vente</Link></p>
        </section>
      </article>
      <aside className="booking" id="reserver" aria-labelledby="booking-title">
        <h2 id="booking-title" className="visually-hidden">Réserver</h2>
        <div className="booking-price">{event.priceTiers.length>0?<div className="quota-rows">{event.priceTiers.map(t=><div key={t.category} className="quota-row"><span>{t.category==="HOMME"?"Hommes":"Femmes"}</span><b>{money(t.amountCents)}</b></div>)}</div>:<><strong>{priceText}</strong>{!free&&<span>par personne, TTC</span>}</>}</div>
        <div className="booking-row"><span>Disponibilité</span><b>{availabilityLabel(event.availability)}</b></div>
        {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}{application&&<p className="fine status-line">Statut : <b>{APPLICATION_STATUS_LABEL[application.status]??application.status}</b></p>}
    {altOffers.map(altOffer=><div key={altOffer.id} className="alt-offer"><span className="eyebrow">Événement alternatif proposé</span><h3>{altOffer.alternativeEvent.title}</h3><p>{dateTime(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</p><p><b>{altOffer.alternativeEvent.priceCents===0?"Gratuit":money(altOffer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busy} onClick={()=>respondAltOffer(altOffer.id,true)}>Accepter</button><button className="button secondary" disabled={busy} onClick={()=>respondAltOffer(altOffer.id,false)}>Refuser</button></div></div>)}
    {!user?<Link className="button full" to="/login">Se connecter pour vous inscrire</Link>
    :loadingApplication?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
    :application?<>
      <ApplicationStatusPanel application={application} event={event} onPaid={refreshApplication} onWaitlisted={markWaitlisted}/>
      {waitlistEntry?<div className="waitlist-status"><span className="eyebrow">Liste d’attente</span><p>Position {waitlistEntry.rank??waitlistEntry.position}{waitlistEntry.offeredAt?" — une place vous a été proposée, consultez votre espace personnel":""}</p><button className="button secondary small" disabled={busy} onClick={leaveWaitlist}>Quitter la liste d’attente</button></div>
      :(categoryUnknown?<Notice kind="error">Complétez votre catégorie dans votre profil pour rejoindre la liste d’attente.</Notice>:(bucketFull&&canCancel&&<button className="button secondary full" disabled={busy} onClick={joinWaitlist}>Rejoindre la liste d’attente</button>))}
      {canCancel&&<button className="button danger full" disabled={busy} onClick={cancelApplication}>Annuler mon inscription</button>}
    </>
    :user.hasRestaurant?<Notice kind="info">Votre compte restaurateur vous permet de découvrir les événements proposés, mais ne permet pas d’y participer.</Notice>
    :!user.phoneVerified?<PhoneVerification compact/>
    :requiresScreening&&!profileValidated?<Notice kind="info"><span>Première soirée de rencontre ? Validez d’abord votre profil : un court appel avec l’équipe, une seule fois. <Link className="text-link" to="/dashboard?tab=interview">Demander mon entretien</Link> · <Link className="text-link" to="/concept#entretien">Comment ça se passe</Link></span></Notice>
    :categoryUnknown?<Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement.</Notice>
    :requiresScreening&&showQuestionnaire?<QuestionnaireForm requiresScreening={requiresScreening} submitting={busy} onSubmit={apply}/>
    :<>{bucketFull&&<Notice kind="info">Cet événement est complet pour votre catégorie, mais vous pouvez tout de même vous inscrire : au moment de payer, vous serez placé(e) sur liste d’attente et, si possible, une soirée comparable vous sera proposée.</Notice>}<button className="button full" disabled={busy} onClick={()=>requiresScreening?setShowQuestionnaire(true):apply()}>{requiresScreening?"Candidater":busy?"…":"S’inscrire"}</button></>}
    <p className="fine">{free?`La confirmation est proposée immédiatement après ${requiresScreening?"le questionnaire":"l’inscription"} ; la place n’est acquise qu’une fois confirmée.`:`Le paiement est proposé immédiatement après ${requiresScreening?"le questionnaire":"l’inscription"} ; la place n’est acquise qu’une fois le paiement confirmé.`}</p>
        <ShareButton event={event}/>
      </aside>
    </div>
    <div className="mobile-book-bar"><div><strong>{priceText}</strong><span>{availabilityLabel(event.availability)}</span></div><a className="button" href="#reserver">Réserver</a></div>
  </div></Layout>;
}
