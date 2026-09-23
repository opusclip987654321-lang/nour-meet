import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { Loading, Notice, NotificationList } from "../components/ui";
import { imgUrl, money } from "../lib/format";
import { SUBSCRIPTION_STATUS_LABEL } from "../lib/labels";

const emptyRestaurantForm={name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:"",desiredCapacity:"",desiredSchedule:"",averagePricePerPersonCents:"",defaultMinParticipants:"",priceIncludesDrink:false,priceIncludesStarter:false,priceIncludesMain:false,priceIncludesDessert:false,priceNotes:"",proposesCategoryPricing:false,allowsPrivatization:false,specialConditions:""};
function RestaurantApplication() {
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState(emptyRestaurantForm);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [submitting,setSubmitting]=useState(false);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({...emptyRestaurantForm,name:r.name??"",managerName:r.managerName??"",siret:r.siret??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??"",desiredCapacity:r.desiredCapacity??"",desiredSchedule:r.desiredSchedule??"",averagePricePerPersonCents:r.averagePricePerPersonCents!=null?String(r.averagePricePerPersonCents/100):"",defaultMinParticipants:r.defaultMinParticipants??"",priceIncludesDrink:!!r.priceIncludesDrink,priceIncludesStarter:!!r.priceIncludesStarter,priceIncludesMain:!!r.priceIncludesMain,priceIncludesDessert:!!r.priceIncludesDessert,priceNotes:r.priceNotes??"",proposesCategoryPricing:!!r.proposesCategoryPricing,allowsPrivatization:!!r.allowsPrivatization,specialConditions:r.specialConditions??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
  useEffect(()=>{load()},[]);

  const payload=()=>({...form,desiredCapacity:form.desiredCapacity?Number(form.desiredCapacity):undefined,defaultMinParticipants:form.defaultMinParticipants?Number(form.defaultMinParticipants):undefined,averagePricePerPersonCents:form.averagePricePerPersonCents?Math.round(Number(form.averagePricePerPersonCents)*100):undefined});

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{await api("/restaurants/apply",{method:"POST",body:JSON.stringify(payload())});setNotice({kind:"success",text:"Votre demande a été envoyée."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };
  const saveProfile=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{await api("/restaurants/me",{method:"PATCH",body:JSON.stringify(payload())});setNotice({kind:"success",text:"Fiche mise à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };
  const uploadPhoto=async(file:File)=>{
    const body=new FormData();body.append("file",file);
    try{await api("/restaurants/me/photos",{method:"POST",body});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const removePhoto=async(photoId:string)=>{try{await api(`/restaurants/me/photos/${photoId}`,{method:"DELETE"});await load()}catch(err){setNotice({kind:"error",text:(err as Error).message})}};

  const priceFields=(f:typeof form,set:(f:typeof form)=>void)=><>
    <label>Places pour la soirée<input type="number" min={1} value={f.desiredCapacity} onChange={e=>set({...f,desiredCapacity:e.target.value})}/></label>
    <label>Jours et horaires souhaités<input value={f.desiredSchedule} onChange={e=>set({...f,desiredSchedule:e.target.value})} placeholder="Vendredi et samedi soir"/></label>
    <label>Prix moyen par personne (€)<input type="number" min={0} step="0.01" value={f.averagePricePerPersonCents} onChange={e=>set({...f,averagePricePerPersonCents:e.target.value})}/></label>
    <label>Minimum de participants habituel<input type="number" min={1} value={f.defaultMinParticipants} onChange={e=>set({...f,defaultMinParticipants:e.target.value})}/></label>
    <label className="wide">Le prix comprend habituellement<div className="chips-input"><label><input type="checkbox" checked={f.priceIncludesDrink} onChange={e=>set({...f,priceIncludesDrink:e.target.checked})}/> Boisson</label><label><input type="checkbox" checked={f.priceIncludesStarter} onChange={e=>set({...f,priceIncludesStarter:e.target.checked})}/> Entrée</label><label><input type="checkbox" checked={f.priceIncludesMain} onChange={e=>set({...f,priceIncludesMain:e.target.checked})}/> Plat</label><label><input type="checkbox" checked={f.priceIncludesDessert} onChange={e=>set({...f,priceIncludesDessert:e.target.checked})}/> Dessert</label></div></label>
    <label className="wide">Précisions sur le contenu du prix<textarea value={f.priceNotes} onChange={e=>set({...f,priceNotes:e.target.value})}/></label>
    <label><input type="checkbox" checked={f.proposesCategoryPricing} onChange={e=>set({...f,proposesCategoryPricing:e.target.checked})}/> Je propose des tarifs par catégorie (homme/femme)</label>
    <label><input type="checkbox" checked={f.allowsPrivatization} onChange={e=>set({...f,allowsPrivatization:e.target.checked})}/> Privatisation possible</label>
    <label className="wide">Conditions particulières<textarea value={f.specialConditions} onChange={e=>set({...f,specialConditions:e.target.value})}/></label>
  </>;

  if(loading) return <Loading/>;
  if(restaurant?.status==="PENDING") return <div className="panel"><Notice kind="info">Votre demande pour « {restaurant.name} » est en cours d’examen.</Notice></div>;
  if(restaurant?.status==="APPROVED") return <div className="stack">
    <div className="panel"><Notice kind="success">Votre établissement « {restaurant.name} » est approuvé. <Link to="/admin">Accéder à mon espace restaurateur →</Link></Notice>
      {restaurant.subscription&&<p className="fine">Abonnement « {restaurant.subscription.plan.name} » — {(restaurant.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois — statut : <b>{restaurant.subscription.status}</b> — {restaurant.currentMonthEventsPublished}{restaurant.subscription.plan.monthlyEventQuota==null?" événements publiés ce mois-ci (illimité)":`/${restaurant.subscription.plan.monthlyEventQuota} événements publiés ce mois-ci`}.</p>}
    </div>
    <form className="panel form-grid" onSubmit={saveProfile}>
      <div className="panel-title"><h2>Fiche établissement</h2><span>Visible par l’administration</span></div>
      {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
      {priceFields(form,setForm)}
      <button className="button" disabled={submitting}>{submitting?"Enregistrement…":"Enregistrer"}</button>
    </form>
    <div className="panel">
      <div className="panel-title"><h2>Galerie</h2><span>{(restaurant.photos??[]).length}/8 photos</span></div>
      <div className="event-photo-grid">{(restaurant.photos??[]).map((p:any)=><div key={p.id} className="event-photo"><img src={imgUrl(p.url)} alt=""/><button type="button" className="link-button" onClick={()=>removePhoto(p.id)}>Retirer</button></div>)}</div>
      <label className="fine">Ajouter une photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>e.target.files?.[0]&&uploadPhoto(e.target.files[0])}/></label>
    </div>
  </div>;

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
    {priceFields(form,setForm)}
    <p className="fine wide">Le SIRET est déclaratif : Nour ne réalise pas de vérification officielle auprès d’un registre. La galerie de photos se complète après approbation.</p>
    <button className="button" disabled={submitting}>{submitting?"Envoi…":"Envoyer ma demande"}</button>
  </form>;
}

// Espace dédié aux comptes restaurateurs (candidature en cours ou déjà approuvée) : plus un onglet
// du dashboard participant (§5), car un restaurateur n'a plus le droit d'y accéder aux fonctions de
// participation. Un compte en attente d'approbation garde par ailleurs un accès normal au reste du
// site public (événements, concept, blog) ; seule la participation elle-même est bloquée côté serveur.
// C01/C13 (ordre correctif 2026-09-20) : cette page reste accessible AUSSI après approbation (rôle
// ORGANIZER) — jusqu'ici /restaurant n'acceptait que PARTICIPANT et redirigeait tout restaurateur
// déjà approuvé vers /admin, le laissant sans aucun moyen d'atteindre son abonnement ou ses
// notifications propres. Onglets Abonnement/Notifications pilotables par ?tab= (ex. depuis une
// notification cliquable) une fois qu'un dossier restaurateur existe (en attente ou approuvé).
export function RestaurantSpace() {
  const [searchParams]=useSearchParams();
  const [restaurant,setRestaurant]=useState<any>(undefined);
  const [tab,setTab]=useState(searchParams.get("tab")??"establishment");
  const [unread,setUnread]=useState(0);
  const loadRestaurant=()=>api<any>("/restaurants/me").then(setRestaurant).catch(()=>setRestaurant(null));
  useEffect(()=>{loadRestaurant()},[]);
  // C14 : une notification cliquée navigue vers /restaurant?tab=X sans démonter ce composant (même
  // route) — sans cette synchronisation, l'onglet affiché resterait celui d'avant le clic.
  useEffect(()=>{const t=searchParams.get("tab");if(t)setTab(t)},[searchParams]);
  useEffect(()=>{if(restaurant)api<{count:number}>("/notifications/unread-count").then(r=>setUnread(r.count)).catch(()=>{})},[restaurant,tab]);
  if(restaurant===undefined)return <Layout><Loading/></Layout>;
  const hasTabs=restaurant&&(restaurant.status==="PENDING"||restaurant.status==="APPROVED");
  return <Layout><section className="page"><h1>Mon établissement</h1>
    {hasTabs&&<div className="tabs" role="tablist" aria-label="Sections de l’espace restaurateur">
      <button type="button" role="tab" aria-selected={tab==="establishment"} className={tab==="establishment"?"active":undefined} onClick={()=>setTab("establishment")}>Mon établissement</button>
      <button type="button" role="tab" aria-selected={tab==="subscription"} className={tab==="subscription"?"active":undefined} onClick={()=>setTab("subscription")}>Abonnement</button>
      <button type="button" role="tab" aria-selected={tab==="notifications"} className={tab==="notifications"?"active":undefined} onClick={()=>setTab("notifications")}>Notifications{unread>0&&<span className="nav-count" aria-label={`${unread} non lues`}>{unread}</span>}</button>
    </div>}
    {(!hasTabs||tab==="establishment")&&<RestaurantApplication/>}
    {hasTabs&&tab==="subscription"&&<RestaurantSubscriptionPanel restaurant={restaurant} onChanged={loadRestaurant}/>}
    {hasTabs&&tab==="notifications"&&<RestaurantNotificationsPanel onUnreadChange={setUnread}/>}
  </section></Layout>;
}
// C01-C09 (instructions définitives 2026-09-20) : vraie page abonnement — deux formules, bascule
// mensuel/annuel, tunnel Stripe Checkout réel (carte obligatoire, essai 7 jours géré par Stripe),
// résiliation programmée en fin de période, portail de facturation. Accessible dès PENDING.
function RestaurantSubscriptionPanel({restaurant,onChanged}:{restaurant:any;onChanged:()=>void}){
  const [searchParams]=useSearchParams();
  const [plans,setPlans]=useState<any[]>([]);
  const [period,setPeriod]=useState<"MONTHLY"|"ANNUAL">("MONTHLY");
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(
    searchParams.get("checkout")==="success"?{kind:"success",text:"Moyen de paiement enregistré. Votre essai de 7 jours a commencé."}:
    searchParams.get("checkout")==="cancel"?{kind:"error",text:"Souscription annulée avant la fin du paiement."}:null
  );
  useEffect(()=>{api<any[]>("/plans").then(setPlans).catch(()=>{})},[]);
  const subscription=restaurant.subscription;
  const checkout=async(planId:string)=>{
    setBusy(planId);setNotice(null);
    try{const {url}=await api<{url:string}>("/restaurants/me/subscription/checkout",{method:"POST",body:JSON.stringify({planId,billingPeriod:period})});window.location.href=url}
    catch(err){setNotice({kind:"error",text:(err as Error).message});setBusy(null)}
  };
  const cancel=async()=>{
    setBusy("cancel");setNotice(null);
    try{await api("/restaurants/me/subscription/cancel",{method:"POST"});setNotice({kind:"success",text:"Résiliation programmée : vos avantages restent actifs jusqu’à la fin de la période déjà payée."});onChanged()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const openPortal=async()=>{
    setBusy("portal");setNotice(null);
    try{const {url}=await api<{url:string}>("/restaurants/me/subscription/portal",{method:"POST"});window.location.href=url}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  return <div className="stack">
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {subscription?<div className="panel">
      <div className="panel-title"><h2>Mon abonnement</h2><span>{SUBSCRIPTION_STATUS_LABEL[subscription.status]??subscription.status}</span></div>
      <p className="fine left">Formule <b>{subscription.plan.name}</b> ({subscription.billingPeriod==="ANNUAL"?"annuel":"mensuel"}) — {subscription.cancelAtPeriodEnd?"résiliation programmée, ":""}
        {subscription.status==="CANCELLED"?"résilié":`échéance le ${new Date(subscription.currentPeriodEnd).toLocaleDateString("fr-FR")}`}.</p>
      <p className="fine left">Quota ce mois-ci : {restaurant.currentMonthEventsPublished}{subscription.plan.monthlyEventQuota==null?" événements publiés (illimité)":`/${subscription.plan.monthlyEventQuota} événements publiés`}.</p>
      <div className="decision-buttons">
        {subscription.stripeCustomerId&&<button type="button" className="button secondary" disabled={!!busy} onClick={openPortal}>Gérer mon moyen de paiement</button>}
        {!subscription.cancelAtPeriodEnd&&subscription.status!=="CANCELLED"&&<button type="button" className="button danger" disabled={!!busy} onClick={cancel}>Résilier</button>}
      </div>
    </div>:<>
      <div className="filters"><button type="button" className={period==="MONTHLY"?"button small":"button small secondary"} onClick={()=>setPeriod("MONTHLY")}>Mensuel</button><button type="button" className={period==="ANNUAL"?"button small":"button small secondary"} onClick={()=>setPeriod("ANNUAL")}>Annuel (2 mois offerts)</button></div>
      <div className="feature-grid">{plans.map(p=><div key={p.id}>
        <b style={{color:"var(--gold)"}}>{p.name}</b>
        <h3>{money(period==="ANNUAL"?p.annualPriceCents:p.monthlyPriceCents)}{period==="ANNUAL"?"/an":"/mois"}</h3>
        <p>{p.monthlyEventQuota==null?"Événements illimités":`${p.monthlyEventQuota} événements publiés par mois`}</p>
        <p>{p.highlightTier==="priority"?"Mise en avant prioritaire des soirées et de l’établissement":p.highlightTier==="simple"?"Mise en avant simple des soirées et de l’établissement":""}</p>
        <p className="fine">Essai gratuit de 7 jours, carte requise, résiliable avant l’échéance.</p>
        <button type="button" className="button full" disabled={!!busy} onClick={()=>checkout(p.id)}>{busy===p.id?"…":"Choisir cette formule"}</button>
      </div>)}</div>
      <p className="fine">Le choix de la formule est indépendant de la publication de vos soirées, qui reste soumise à validation admin.</p>
    </>}
  </div>;
}

function RestaurantNotificationsPanel({onUnreadChange}:{onUnreadChange:(n:number)=>void}){
  const [items,setItems]=useState<any[]>([]);
  const load=()=>api<any[]>("/notifications").then(setItems);
  useEffect(()=>{load()},[]);
  return <div className="panel"><div className="panel-title"><h2>Notifications</h2></div>
    <NotificationList items={items} onRead={id=>{setItems(items.map(n=>n.id===id?{...n,readAt:new Date().toISOString()}:n));onUnreadChange(items.filter(n=>!n.readAt&&n.id!==id).length)}}/>
  </div>;
}
