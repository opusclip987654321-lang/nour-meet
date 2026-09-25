import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AdminNav } from "./admin/AdminNav";
import { Layout } from "../components/Layout";
import { Loading, Notice } from "../components/ui";
import { imgUrl } from "../lib/format";
import { spacePath } from "../lib/spaces";
import { SUBSCRIPTION_STATUS_LABEL } from "../lib/labels";
import { RestaurantSubscriptionPanel } from "./RestaurantSubscription";

// Onboarding (v2 §5) : pendant l'examen de la demande, le restaurateur peut déjà préparer son premier
// événement (brouillon), puis choisir son abonnement. Le texte reste prudent : c'est l'équipe qui valide,
// jamais le paiement qui « garantit » une validation.
function PendingNextStep() {
  const [state,setState]=useState<{draft:any|null}|null|undefined>(undefined);
  useEffect(()=>{api<{draft:any|null}>("/restaurants/me/onboarding").then(setState).catch(()=>setState(null))},[]);
  if(state===undefined)return <div className="panel skeleton-panel" aria-hidden="true"/>;
  if(state===null)return null;
  return <div className="panel onboarding-next">
    {state.draft?<>
      <h2>Votre premier événement est prêt.</h2>
      <p>Choisissez votre abonnement pour pouvoir le soumettre et le mettre en ligne.</p>
      <div className="onboarding-actions"><Link className="button" to="/restaurant/premier-evenement">Choisir mon abonnement</Link><Link className="button secondary" to="/restaurant/premier-evenement?etape=evenement">Modifier mon événement</Link></div>
    </>:<>
      <h2>Votre restaurant est en attente de validation.</h2>
      <p>Souhaitez-vous créer votre premier événement dès maintenant ?</p>
      <div className="onboarding-actions"><Link className="button" to="/restaurant/premier-evenement">Créer mon premier événement</Link></div>
    </>}
  </div>;
}

const emptyRestaurantForm={name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:"",desiredCapacity:"",desiredSchedule:"",averagePricePerPersonCents:"",defaultMinParticipants:"",priceIncludesDrink:false,priceIncludesStarter:false,priceIncludesMain:false,priceIncludesDessert:false,priceNotes:"",proposesCategoryPricing:false,allowsPrivatization:false,specialConditions:""};
function RestaurantApplication() {
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState(emptyRestaurantForm);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const [files,setFiles]=useState<File[]>([]);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({...emptyRestaurantForm,name:r.name??"",managerName:r.managerName??"",siret:r.siret??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??"",desiredCapacity:r.desiredCapacity??"",desiredSchedule:r.desiredSchedule??"",averagePricePerPersonCents:r.averagePricePerPersonCents!=null?String(r.averagePricePerPersonCents/100):"",defaultMinParticipants:r.defaultMinParticipants??"",priceIncludesDrink:!!r.priceIncludesDrink,priceIncludesStarter:!!r.priceIncludesStarter,priceIncludesMain:!!r.priceIncludesMain,priceIncludesDessert:!!r.priceIncludesDessert,priceNotes:r.priceNotes??"",proposesCategoryPricing:!!r.proposesCategoryPricing,allowsPrivatization:!!r.allowsPrivatization,specialConditions:r.specialConditions??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
  useEffect(()=>{load()},[]);

  const payload=()=>({...form,desiredCapacity:form.desiredCapacity?Number(form.desiredCapacity):undefined,defaultMinParticipants:form.defaultMinParticipants?Number(form.defaultMinParticipants):undefined,averagePricePerPersonCents:form.averagePricePerPersonCents?Math.round(Number(form.averagePricePerPersonCents)*100):undefined});

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    // Au moins une photo de l'établissement accompagne la demande : sans elle, l'approbation est refusée côté serveur.
    try{
      await api("/restaurants/apply",{method:"POST",body:JSON.stringify(payload())});
      let failed=0;
      for(const file of files){const body=new FormData();body.append("file",file);await api("/restaurants/me/photos",{method:"POST",body}).catch(()=>{failed++})}
      setNotice(failed?{kind:"error",text:`Votre demande a été envoyée, mais ${failed} photo(s) n’ont pas pu être ajoutées : ajoutez-en au moins une ci-dessous.`}:{kind:"success",text:"Votre demande a été envoyée."});
      await load()
    }
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
  const photoCount=(restaurant?.photos??[]).length;
  const gallery=<div className="panel">
      <div className="panel-title"><h2>Galerie</h2><span>{photoCount}/8 photos</span></div>
      {photoCount===0&&<Notice kind="error">Ajoutez au moins une photo de votre établissement : elle est obligatoire pour l’approbation de votre compte et pour soumettre une soirée.</Notice>}
      <div className="event-photo-grid">{(restaurant?.photos??[]).map((p:any)=><div key={p.id} className="event-photo"><img src={imgUrl(p.url)} alt=""/><button type="button" className="link-button" onClick={()=>removePhoto(p.id)}>Retirer</button></div>)}</div>
      {photoCount<8&&<label className="fine">Ajouter une photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>e.target.files?.[0]&&uploadPhoto(e.target.files[0])}/></label>}
    </div>;
  if(restaurant?.status==="PENDING") return <div className="stack"><div className="panel"><Notice kind="info">Votre demande pour « {restaurant.name} » est en cours d’examen.</Notice>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}</div><PendingNextStep/>{gallery}</div>;
  if(restaurant?.status==="APPROVED") return <div className="stack">
    <div className="panel"><Notice kind="success">Votre établissement « {restaurant.name} » est approuvé. <Link className="text-link" to={spacePath("ORGANIZER","overview")}>Tableau de bord de mes soirées</Link></Notice>
      {restaurant.subscription&&<p className="fine">Formule « {restaurant.subscription.plan.name} » — {SUBSCRIPTION_STATUS_LABEL[restaurant.subscription.status]??restaurant.subscription.status} — {restaurant.currentMonthEventsPublished}{restaurant.subscription.plan.monthlyEventQuota==null?" soirée(s) publiée(s) ce mois-ci (illimité)":`/${restaurant.subscription.plan.monthlyEventQuota} soirées publiées ce mois-ci`}. <Link to="/restaurant?tab=subscription">Voir mon abonnement</Link></p>}
    </div>
    <form className="panel form-grid" onSubmit={saveProfile}>
      <div className="panel-title"><h2>Fiche établissement</h2><span>Visible par l’administration</span></div>
      {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
      {priceFields(form,setForm)}
      <button className="button" disabled={submitting}>{submitting?"Enregistrement…":"Enregistrer"}</button>
    </form>
    {gallery}
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
    <label className="wide">Photos de l’établissement (au moins une, 8 au maximum)<input required type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>setFiles(Array.from(e.target.files??[]).slice(0,8))}/><span className="fine">Façade, salle ou tables : de vraies photos du lieu. JPEG, PNG ou WEBP · 5 Mo maximum chacune.</span></label>
    <p className="fine wide">Le SIRET est déclaratif : Nūr Meet ne réalise pas de vérification officielle auprès d’un registre.</p>
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
  const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const [restaurant,setRestaurant]=useState<any>(undefined);
  const [tab,setTab]=useState(searchParams.get("tab")??"establishment");
  const loadRestaurant=()=>api<any>("/restaurants/me").then(setRestaurant).catch(()=>setRestaurant(null));
  useEffect(()=>{loadRestaurant()},[]);
  // C14 : une notification cliquée navigue vers /restaurant?tab=X sans démonter ce composant (même
  // route) — sans cette synchronisation, l'onglet affiché resterait celui d'avant le clic.
  useEffect(()=>{const t=searchParams.get("tab");if(t)setTab(t)},[searchParams]);
  if(restaurant===undefined)return <Layout><Loading/></Layout>;
  // Corrections web 2026-09-24 (§4.1) : les notifications vivent dans la cloche de l'en-tête et sur
  // /notifications, plus dans un onglet de cet espace — un ancien lien ?tab=notifications y renvoie.
  if(tab==="notifications")return <Navigate to="/notifications" replace/>;
  const hasTabs=restaurant&&(restaurant.status==="PENDING"||restaurant.status==="APPROVED");
  const content=<>    {hasTabs&&<div className="tabs" role="tablist" aria-label="Sections de l’espace restaurateur">
      <button type="button" role="tab" aria-selected={tab==="establishment"} className={tab==="establishment"?"active":undefined} onClick={()=>setTab("establishment")}>Mon établissement</button>
      <button type="button" role="tab" aria-selected={tab==="subscription"} className={tab==="subscription"?"active":undefined} onClick={()=>setTab("subscription")}>Abonnement</button>
    </div>}
    {(!hasTabs||tab!=="subscription")&&<RestaurantApplication/>}
    {hasTabs&&tab==="subscription"&&<RestaurantSubscriptionPanel restaurant={restaurant} onChanged={loadRestaurant}/>}
  </>;
  // Restaurateur approuvé : même barre latérale que le reste de son espace (tableau de bord, soirées…).
  if(user?.role==="ORGANIZER")return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Mon établissement</h1>{content}</div></section></Layout>;
  return <Layout><section className="page"><h1>Mon établissement</h1>{content}</section></Layout>;
}
