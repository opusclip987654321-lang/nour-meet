import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { AdminNav } from "./admin/AdminNav";
import { Layout } from "../components/Layout";
import { Loading, Notice } from "../components/ui";
import { dateTime, imgUrl } from "../lib/format";
import { spacePath } from "../lib/spaces";
import { RESTAURANT_VALIDATION, SUBSCRIPTION_STATUS_LABEL, eventValidation } from "../lib/labels";
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

// Photos de l'établissement (v3 §6.2) : vignette dès la sélection, suppression et réordonnancement avant
// l'envoi ; la première est la photo principale, et c'est écrit dessus.
function PhotoOrderList({items,onMove,onRemove,busy}:{items:{key:string;src:string}[];onMove:(from:number,to:number)=>void;onRemove:(index:number)=>void;busy?:boolean}){
  if(items.length===0)return null;
  return <ol className="photo-order">{items.map((item,i)=><li key={item.key}>
    <img src={item.src} alt={`Photo ${i+1}`}/>
    {i===0&&<span className="photo-main-tag">Photo principale</span>}
    <div className="photo-order-actions">
      <button type="button" className="icon-button" disabled={busy||i===0} onClick={()=>onMove(i,i-1)} aria-label={`Avancer la photo ${i+1}`}><ArrowLeft size={16} aria-hidden="true"/></button>
      <button type="button" className="icon-button" disabled={busy||i===items.length-1} onClick={()=>onMove(i,i+1)} aria-label={`Reculer la photo ${i+1}`}><ArrowRight size={16} aria-hidden="true"/></button>
      <button type="button" className="icon-button" disabled={busy} onClick={()=>onRemove(i)} aria-label={`Retirer la photo ${i+1}`}><X size={16} aria-hidden="true"/></button>
    </div>
  </li>)}</ol>;
}
const moved=<T,>(list:T[],from:number,to:number)=>{const next=[...list];const [item]=next.splice(from,1);next.splice(to,0,item);return next};

// Nom de l'établissement avec suggestions (v3 §6.1) : recherche après 3 caractères, 350 ms après la
// dernière frappe ; choisir une suggestion préremplit nom, SIRET, adresse et quartier, qui restent tous
// modifiables. Sans réponse du service, le champ reste un simple champ texte.
type RestaurantSuggestion={name:string;legalName:string;siret:string;address:string;district:string};
function RestaurantNameField({value,onChange,onPick}:{value:string;onChange:(v:string)=>void;onPick:(r:RestaurantSuggestion)=>void}){
  const [suggestions,setSuggestions]=useState<RestaurantSuggestion[]>([]);
  const [open,setOpen]=useState(false),[active,setActive]=useState(-1),[picked,setPicked]=useState(false);
  useEffect(()=>{
    const q=value.trim();
    if(picked||q.length<3){setSuggestions([]);return}
    let cancelled=false;
    const timer=setTimeout(()=>{api<{results:RestaurantSuggestion[]}>(`/restaurants/search?q=${encodeURIComponent(q)}`).then(r=>{if(!cancelled){setSuggestions(r.results);setOpen(true);setActive(-1)}}).catch(()=>{})},350);
    return ()=>{cancelled=true;clearTimeout(timer)};
  },[value,picked]);
  const choose=(r:RestaurantSuggestion)=>{onPick(r);setPicked(true);setOpen(false)};
  const listId="restaurant-suggestions";
  return <label>Nom de l’établissement
    <span className="autocomplete"><input required value={value} role="combobox" aria-expanded={open&&suggestions.length>0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active>=0?`${listId}-${active}`:undefined} autoComplete="off"
      onChange={e=>{onChange(e.target.value);setPicked(false)}} onBlur={()=>setTimeout(()=>setOpen(false),150)} onFocus={()=>suggestions.length&&setOpen(true)}
      onKeyDown={e=>{if(!open||!suggestions.length)return;if(e.key==="ArrowDown"){e.preventDefault();setActive(a=>Math.min(a+1,suggestions.length-1))}else if(e.key==="ArrowUp"){e.preventDefault();setActive(a=>Math.max(a-1,0))}else if(e.key==="Enter"&&active>=0){e.preventDefault();choose(suggestions[active])}else if(e.key==="Escape")setOpen(false)}}/>
    {open&&suggestions.length>0&&<ul className="autocomplete-list" id={listId} role="listbox">{suggestions.map((r,i)=><li key={r.siret} id={`${listId}-${i}`} role="option" aria-selected={i===active} className={i===active?"active":undefined} onMouseDown={e=>{e.preventDefault();choose(r)}}><b>{r.name}</b><small>{r.address}</small></li>)}</ul>}</span>
    <span className="fine left">Commencez à taper : nous proposons les établissements déclarés, pour préremplir la fiche.</span>
  </label>;
}

const emptyRestaurantForm={name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:"",desiredCapacity:"",desiredSchedule:"",averagePricePerPersonCents:"",defaultMinParticipants:"",priceIncludesDrink:false,priceIncludesStarter:false,priceIncludesMain:false,priceIncludesDessert:false,priceNotes:"",proposesCategoryPricing:false,allowsPrivatization:false,specialConditions:""};
function RestaurantApplication() {
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState(emptyRestaurantForm);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const [files,setFiles]=useState<File[]>([]);
  const previews=useMemo(()=>files.map(f=>({key:`${f.name}-${f.size}-${f.lastModified}`,src:URL.createObjectURL(f)})),[files]);
  useEffect(()=>()=>previews.forEach(p=>URL.revokeObjectURL(p.src)),[previews]);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({...emptyRestaurantForm,name:r.name??"",managerName:r.managerName??"",siret:r.siret??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??"",desiredCapacity:r.desiredCapacity??"",desiredSchedule:r.desiredSchedule??"",averagePricePerPersonCents:r.averagePricePerPersonCents!=null?String(r.averagePricePerPersonCents/100):"",defaultMinParticipants:r.defaultMinParticipants??"",priceIncludesDrink:!!r.priceIncludesDrink,priceIncludesStarter:!!r.priceIncludesStarter,priceIncludesMain:!!r.priceIncludesMain,priceIncludesDessert:!!r.priceIncludesDessert,priceNotes:r.priceNotes??"",proposesCategoryPricing:!!r.proposesCategoryPricing,allowsPrivatization:!!r.allowsPrivatization,specialConditions:r.specialConditions??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
  useEffect(()=>{load()},[]);

  const payload=()=>({...form,desiredCapacity:form.desiredCapacity?Number(form.desiredCapacity):undefined,defaultMinParticipants:form.defaultMinParticipants?Number(form.defaultMinParticipants):undefined,averagePricePerPersonCents:form.averagePricePerPersonCents?Math.round(Number(form.averagePricePerPersonCents)*100):undefined});

  const submit=async(e:FormEvent)=>{
    e.preventDefault();
    if(files.length===0){setNotice({kind:"error",text:"Ajoutez au moins une photo de votre établissement."});return}
    setSubmitting(true);setNotice(null);
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
  const [reordering,setReordering]=useState(false);
  const reorderPhotos=async(ids:string[])=>{setReordering(true);try{await api("/restaurants/me/photos/order",{method:"PUT",body:JSON.stringify({ids})});await load()}catch(err){setNotice({kind:"error",text:(err as Error).message})}finally{setReordering(false)}};
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
      <PhotoOrderList busy={reordering} items={(restaurant?.photos??[]).map((p:any)=>({key:p.id,src:imgUrl(p.url)}))} onMove={(from,to)=>reorderPhotos(moved(restaurant.photos.map((p:any)=>p.id),from,to))} onRemove={i=>removePhoto(restaurant.photos[i].id)}/>
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
    <RestaurantNameField value={form.name} onChange={name=>setForm({...form,name})} onPick={r=>setForm({...form,name:r.name,siret:r.siret,address:r.address,district:r.district})}/>
    <label>Nom du responsable<input required value={form.managerName} onChange={e=>setForm({...form,managerName:e.target.value})}/></label>
    <label>SIRET (14 chiffres)<input required pattern="\d{14}" title="14 chiffres" value={form.siret} onChange={e=>setForm({...form,siret:e.target.value.replace(/\D/g,"").slice(0,14)})}/></label>
    <label>Téléphone professionnel<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
    <label>Quartier / ville<input value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
    <label>Adresse<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
    <label className="wide">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    {priceFields(form,setForm)}
    <div className="wide photo-picker">
      <b className="photo-picker-title">Photos de l’établissement (au moins une, 8 au maximum)</b>
      <label className="button secondary small photo-picker-add">{files.length?"Ajouter d’autres photos":"Ajouter des photos"}<input type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{const picked=Array.from(e.target.files??[]);setFiles(f=>[...f,...picked].slice(0,8));e.target.value=""}}/></label>
      <span className="fine left">Façade, salle ou tables : de vraies photos du lieu. JPEG, PNG ou WEBP · 5 Mo maximum chacune. La première est la photo principale : réordonnez-les avec les flèches.</span>
      <PhotoOrderList items={previews} onMove={(from,to)=>setFiles(f=>moved(f,from,to))} onRemove={i=>setFiles(f=>f.filter((_,j)=>j!==i))}/>
    </div>
    <p className="fine wide">Le SIRET est déclaratif : Nūr Meet ne réalise pas de vérification officielle auprès d’un registre.</p>
    <button className="button" disabled={submitting}>{submitting?"Envoi…":"Envoyer ma demande"}</button>
  </form>;
}

// Onglet « Validations » (v3 §6.4) : où en sont l'établissement et chacune de ses soirées. Une soirée
// « À modifier » montre le commentaire de l'équipe et se corrige puis se renvoie sans être recréée (§6.5).
function RestaurantValidations() {
  const {user}=useAuth();
  const [data,setData]=useState<{restaurant:any;events:any[]}|null|undefined>(undefined);
  const [busyId,setBusyId]=useState<string|null>(null),[notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<{restaurant:any;events:any[]}>("/restaurants/me/validations").then(setData).catch(()=>setData(null));
  useEffect(()=>{load()},[]);
  const resubmit=async(id:string)=>{setBusyId(id);setNotice(null);try{await api(`/admin/events/${id}/submit-for-review`,{method:"POST"});setNotice({kind:"success",text:"Soirée renvoyée pour validation."});await load()}catch(err){setNotice({kind:"error",text:(err as Error).message})}finally{setBusyId(null)}};
  if(data===undefined)return <div className="panel skeleton-panel" aria-hidden="true"/>;
  if(data===null)return <Notice kind="error">Impossible de charger vos validations pour le moment.</Notice>;
  const r=RESTAURANT_VALIDATION[data.restaurant.status]??{label:data.restaurant.status,tone:"neutral"};
  const organizer=user?.role==="ORGANIZER";
  return <div className="stack">
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <section className="panel" aria-labelledby="validation-restaurant">
      <div className="panel-title"><h2 id="validation-restaurant">Mon établissement</h2><span className={`badge ${r.tone}`}>{r.label}</span></div>
      <p className="fine left">{data.restaurant.status==="PENDING"?"L’équipe Nūr Meet examine votre fiche. Vous pouvez déjà préparer votre premier événement.":data.restaurant.status==="APPROVED"?`« ${data.restaurant.name} » est validé : vos soirées peuvent être soumises à validation.`:data.restaurant.status==="REJECTED"?`Votre demande n’a pas été retenue${data.restaurant.rejectionReason?` : ${data.restaurant.rejectionReason}`:"."}`:"Votre établissement est suspendu : contactez l’équipe Nūr Meet."}</p>
    </section>
    <section className="panel" aria-labelledby="validation-events">
      <div className="panel-title"><h2 id="validation-events">Mes événements</h2><span>{data.events.length} soirée{data.events.length>1?"s":""}</span></div>
      {data.events.length===0?<div className="empty small"><p>Aucune soirée pour le moment.</p>{organizer?<Link className="button small" to={spacePath("ORGANIZER","newEvent")}>Créer une soirée</Link>:data.restaurant.status==="PENDING"&&<Link className="button small" to="/restaurant/premier-evenement">Créer mon premier événement</Link>}</div>
      :<ul className="validation-list">{data.events.map(ev=>{const v=eventValidation(ev);return <li key={ev.id} className="validation-item">
        <div><b>{ev.title}</b><small>{dateTime(ev.startsAt)}{ev.submittedForReviewAt&&ev.status==="PENDING_REVIEW"?` · soumise le ${dateTime(ev.submittedForReviewAt)}`:""}</small></div>
        <span className={`badge ${v.tone}`}>{v.label}</span>
        {v.label==="À modifier"&&<p className="validation-note"><b>À corriger :</b> {ev.reviewNote}</p>}
        {organizer&&ev.status==="DRAFT"&&<div className="validation-actions"><Link className="button small secondary" to={`${spacePath("ORGANIZER","events")}?highlight=${ev.id}`}>Modifier la soirée</Link><button type="button" className="button small" disabled={busyId===ev.id} onClick={()=>resubmit(ev.id)}>{busyId===ev.id?"Envoi…":v.label==="À modifier"?"Renvoyer pour validation":"Soumettre à validation"}</button></div>}
        {!organizer&&ev.status==="DRAFT"&&data.restaurant.status==="PENDING"&&<div className="validation-actions"><Link className="button small secondary" to="/restaurant/premier-evenement?etape=evenement">Modifier mon événement</Link></div>}
      </li>})}</ul>}
    </section>
  </div>;
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
      <button type="button" role="tab" aria-selected={tab==="validations"} className={tab==="validations"?"active":undefined} onClick={()=>setTab("validations")}>Validations</button>
      <button type="button" role="tab" aria-selected={tab==="subscription"} className={tab==="subscription"?"active":undefined} onClick={()=>setTab("subscription")}>Abonnement</button>
    </div>}
    {hasTabs&&tab==="validations"&&<RestaurantValidations/>}
    {(!hasTabs||(tab!=="subscription"&&tab!=="validations"))&&<RestaurantApplication/>}
    {hasTabs&&tab==="subscription"&&<RestaurantSubscriptionPanel onChanged={loadRestaurant}/>}
  </>;
  // Restaurateur approuvé : même barre latérale que le reste de son espace (tableau de bord, soirées…).
  if(user?.role==="ORGANIZER")return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Mon établissement</h1>{content}</div></section></Layout>;
  return <Layout><section className="page"><h1>Mon établissement</h1>{content}</section></Layout>;
}
