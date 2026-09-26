import { ExternalLink, Inbox, Search, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { CategoryBadge, Notice } from "../../components/ui";
import { dateTime, imgUrl } from "../../lib/format";
import { QUOTA_CATEGORY_LABEL, eventValidation } from "../../lib/labels";
import { DataTable, FilterTabs, type Column } from "../../components/DataTable";
import { spacePath } from "../../lib/spaces";
import { AdminNav, Stat } from "./AdminNav";
import { EuroInput, EventForm, emptyEventForm, eventFormPayload, type EventFormState } from "../../components/EventForm";

export function AdminCreateEvent() {
  const {user}=useAuth();
  const navigate=useNavigate();
const [form,setForm]=useState<EventFormState>(emptyEventForm);
  const [submitting,setSubmitting]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [restaurantInfo,setRestaurantInfo]=useState<any>(null);
  useEffect(()=>{if(user?.role==="ORGANIZER")api<any>("/restaurants/me").then(setRestaurantInfo).catch(()=>{})},[user?.role]);
  // Espace super-admin (v3) : un événement Nūr Meet se tient chez un restaurant partenaire ou dans un
  // autre lieu, et se publie immédiatement ou reste en brouillon.
  const isAdmin=user?.role==="ADMIN";
  const [venues,setVenues]=useState<any[]>([]);
  const [venueId,setVenueId]=useState("");
  const [publishNow,setPublishNow]=useState(true);
  useEffect(()=>{if(isAdmin)api<any[]>("/admin/restaurants?status=APPROVED").then(setVenues).catch(()=>{})},[isAdmin]);
  const pickVenue=(id:string)=>{setVenueId(id);const v=venues.find(r=>r.id===id);if(v)setForm({...form,district:v.district??form.district,address:v.address??form.address})};
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{
      const created=await api<any>("/admin/events",{method:"POST",body:JSON.stringify({...eventFormPayload(form),...(isAdmin?{publish:publishNow,venueRestaurantId:venueId||undefined}:{})})});
      setNotice({kind:"success",text:user?.role==="ORGANIZER"?"Brouillon créé. Ajoutez vos photos puis soumettez-le à validation.":created.status==="PUBLISHED"?"Événement publié. Ajoutez maintenant sa photo principale.":"Brouillon enregistré. Vous pourrez le publier depuis « Événements »."});
      setTimeout(()=>navigate(isAdmin?`/admin/events?manage=${created.id}`:spacePath(user?.role,"events")),1200);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>{isAdmin?"Créer un événement Nūr Meet":"Créer une soirée"}</h1><p className="fine left">{user?.role==="ORGANIZER"?"Votre soirée démarre en brouillon : ajoutez ensuite ses photos puis soumettez-la à validation (au moins une photo de votre établissement est obligatoire).":"Événement organisé par Nūr Meet : vous le publiez directement, sans passer par la validation réservée aux restaurateurs."}</p>
    {user?.role==="ORGANIZER"&&restaurantInfo&&!(restaurantInfo.photos?.length>0)&&<Notice kind="error">Ajoutez d’abord au moins une photo de votre établissement : sans elle, la soirée ne pourra pas être soumise à validation. <Link className="text-link" to="/restaurant">Ajouter une photo</Link></Notice>}
    {user?.role==="ORGANIZER"&&restaurantInfo&&!["ACTIVE","TRIALING"].includes(restaurantInfo.subscription?.status)&&<Notice kind="info">Aucun abonnement actif : vous pouvez préparer et soumettre votre soirée, mais elle ne sera publiée qu’avec une formule active. <Link className="text-link" to="/restaurant?tab=subscription">Choisir une formule</Link></Notice>}
    {user?.role==="ORGANIZER"&&restaurantInfo?.subscription&&<Notice kind="info">Abonnement « {restaurantInfo.subscription.plan.name} » ({(restaurantInfo.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois) — {restaurantInfo.currentMonthEventsPublished}{restaurantInfo.subscription.plan.monthlyEventQuota==null?" événements publiés ce mois-ci (illimité)":`/${restaurantInfo.subscription.plan.monthlyEventQuota} événements publiés ce mois-ci`}. Un brouillon ne consomme le quota qu’à sa première publication.</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <EventForm form={form} setForm={setForm} showFlow={isAdmin} submitting={submitting} submitLabel={isAdmin?(publishNow?"Créer et publier":"Enregistrer en brouillon"):"Créer la soirée"} onSubmit={submit}
      locationField={isAdmin?<label className="wide">Lieu<select value={venueId} onChange={e=>pickVenue(e.target.value)}><option value="">Autre lieu (quartier et adresse saisis ci-dessous)</option>{venues.map(v=><option key={v.id} value={v.id}>{v.name}{v.district?` · ${v.district}`:""}</option>)}</select><span className="fine left">Un restaurant partenaire préremplit le quartier et l’adresse.</span></label>:undefined}>
      {isAdmin?<>
        <div className="wide perks-checks"><label><input type="checkbox" checked={publishNow} onChange={e=>setPublishNow(e.target.checked)}/> Publier immédiatement (sinon, l’événement reste en brouillon)</label></div>
        <p className="fine left wide">Les quotas hommes/femmes, les tarifs différenciés et les photos se règlent ensuite, depuis la fiche de gestion de l’événement.</p>
      </>:undefined}
    </EventForm>
  </div></section></Layout>;
}

export function AdminEventPhotos() {
  const {user}=useAuth();
  const [searchParams,setSearchParams]=useSearchParams();
  const highlightId=searchParams.get("highlight");
  // Super-admin : vue d'ensemble en tableau ; « Gérer » (ou un lien de notification) ouvre la fiche de
  // gestion d'une seule soirée. Le restaurateur garde la liste de ses propres soirées.
  const manageId=user?.role==="ADMIN"?searchParams.get("manage")??highlightId:null;
  const [events,setEvents]=useState<any[]|null>(null);
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
  const allEvents=events??[];
  useEffect(()=>{load()},[]);
  // C14 (ordre correctif 2026-09-20) : une notification "soirée approuvée/à valider/..." doit ouvrir
  // CETTE soirée, pas seulement la liste — /admin/events?highlight=<id> défile jusqu'à sa carte et
  // la met en évidence brièvement plutôt que de forcer le restaurateur à la rechercher lui-même.
  useEffect(()=>{
    if(!highlightId||!events||events.length===0)return;
    const el=document.getElementById(`event-${highlightId}`);
    if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.add("highlighted");setTimeout(()=>el.classList.remove("highlighted"),3000)}
  },[highlightId,events]);

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
    try{const res=await api<any>(`/admin/events/${eventId}/cancel`,{method:"POST"});setNotice({kind:"success",text:`Événement annulé.${res.refundedCount?` ${res.refundedCount} billet(s) remboursé(s) intégralement.`:""}`});setCancelConfirmFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const decideMinParticipants=async(eventId:string, action:"MAINTAIN"|"CANCEL")=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/min-participants-decision`,{method:"POST",body:JSON.stringify({action})});setNotice({kind:"success",text:action==="MAINTAIN"?"Événement maintenu.":"Événement annulé, billets remboursés."});await load()}
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
  const publishOwn=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/publish`,{method:"POST"});setNotice({kind:"success",text:"Événement publié."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const reviewDecision=async(eventId:string, accept:boolean, note?:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/review-decision`,{method:"POST",body:JSON.stringify({accept,note})});setNotice({kind:"success",text:accept?"Événement validé et publié.":"Événement renvoyé « À modifier » avec votre commentaire."});setRejectNoteFor(null);setRejectNote("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const openEditor=(ev:any)=>{
    setEditForm({title:ev.title,description:ev.description,capacity:ev.capacity,startsAt:toLocalInput(ev.startsAt),endsAt:toLocalInput(ev.endsAt),includesDrink:ev.includesDrink,includesStarter:ev.includesStarter,includesMain:ev.includesMain,includesDessert:ev.includesDessert,perksDescription:ev.perksDescription??""});
    setEditFor(ev.id);
  };
  // Cahier des charges consolidé final (2026-09-20) : une soirée publiée ne peut plus être déplacée
  // — le serveur refuse désormais la requête (409) plutôt que de créer une proposition à approuver.
  const saveEdit=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{
      await api<any>(`/admin/events/${eventId}`,{method:"PATCH",body:JSON.stringify({...editForm,startsAt:new Date(editForm.startsAt).toISOString(),endsAt:new Date(editForm.endsAt).toISOString()})});
      setNotice({kind:"success",text:"Modifications enregistrées."});
      setEditFor(null);await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const openPricing=(ev:any)=>{
    const homme=ev.priceTiers?.find((t:any)=>t.category==="HOMME")?.amountCents;
    const femme=ev.priceTiers?.find((t:any)=>t.category==="FEMME")?.amountCents;
    setPricingForm({mode:ev.genderPricingEnabled&&homme!=null&&femme!=null?"differentiated":"flat",amountCents:ev.priceCents,homme:homme??ev.priceCents,femme:femme??ev.priceCents});
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
  const HISTORY_LABEL:Record<string,string>={CREATE_EVENT:"Création",SUBMIT_EVENT_FOR_REVIEW:"Soumis à validation",APPROVE_EVENT:"Publié",REJECT_EVENT:"Renvoyé « À modifier »",UPDATE_EVENT:"Modifié",SET_EVENT_PRICING:"Tarifs modifiés",SET_EVENT_QUOTAS:"Quotas modifiés",ADD_EVENT_PHOTO:"Photo ajoutée",CANCEL_EVENT:"Annulé",APPROVE_DATE_CHANGE:"Changement de date approuvé",REJECT_DATE_CHANGE:"Changement de date refusé"};

  if(user?.role==="ADMIN"&&!manageId)return <Layout><section className="admin-page"><AdminNav/><div className="admin-main">{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}<AdminEventsOverview events={events} actingOn={actingOn} onManage={id=>setSearchParams({manage:id})} onPublish={publishOwn}/></div></section></Layout>;
  const shown=manageId?allEvents.filter(ev=>ev.id===manageId):allEvents;
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main">{manageId?<><Link className="text-link back-link" to="/admin/events">← Tous les événements</Link><h1>Gérer la soirée</h1></>:<h1>Mes soirées</h1>}<p className="fine left">Formats acceptés : JPEG, PNG, WEBP · 5 Mo maximum. Sans photo personnalisée, l’illustration de la catégorie est utilisée.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="event-photo-grid">{events===null?<div className="panel skeleton-panel" aria-hidden="true"/>:shown.length===0?<div className="empty"><Inbox size={24} aria-hidden="true"/><p>{manageId?"Cette soirée est introuvable.":"Aucune soirée pour le moment."}</p></div>:shown.map(ev=><div key={ev.id} id={`event-${ev.id}`} className="panel event-photo-card"><img src={imgUrl(ev.imageUrl)} alt={ev.title}/><div><b>{ev.title}</b><div className="admin-event-meta"><CategoryBadge category={ev.category} className="inline"/><span className={`badge ${eventValidation(ev).tone}`}>{eventValidation(ev).label}</span>{ev.controllerRestaurant?<small>{ev.controllerRestaurant.name}</small>:<small>Nūr Meet</small>}</div>
      {eventValidation(ev).label==="À modifier"&&<p className="validation-note"><b>À corriger :</b> {ev.reviewNote}</p>}
      <label className="button small secondary">{uploadingFor===ev.id?"Envoi…":"Changer la photo principale"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id} onChange={e=>{const f=e.target.files?.[0];if(f)upload(ev.id,f);e.target.value=""}}/></label>

      <div className="gallery-editor"><small>GALERIE ({ev.photos?.length??0}/5)</small><div className="gallery-thumbs">{(ev.photos??[]).map((p:any)=><div key={p.id} className="gallery-thumb"><img src={imgUrl(p.url)} alt=""/><button type="button" onClick={()=>removeGalleryPhoto(ev.id,p.id)} aria-label="Supprimer la photo"><X size={16} aria-hidden="true"/></button></div>)}</div><label className="button small secondary" style={{opacity:(ev.photos?.length??0)>=5?0.5:1}}>{uploadingFor===ev.id?"Envoi…":"Ajouter une photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id||(ev.photos?.length??0)>=5} onChange={e=>{const f=e.target.files?.[0];if(f)uploadGalleryPhoto(ev.id,f);e.target.value=""}}/></label></div>

      {user?.role==="ORGANIZER"&&ev.status==="DRAFT"&&<button className="button small" disabled={actingOn===ev.id} onClick={()=>submitForReview(ev.id)}>{actingOn===ev.id?"Envoi…":eventValidation(ev).label==="À modifier"?"Renvoyer pour validation":"Soumettre à validation"}</button>}
      {user?.role==="ADMIN"&&!ev.controllerRestaurantId&&ev.status==="DRAFT"&&<button className="button small" disabled={actingOn===ev.id} onClick={()=>publishOwn(ev.id)}>{actingOn===ev.id?"Publication…":"Publier"}</button>}
      {user?.role==="ADMIN"&&ev.status==="PENDING_REVIEW"&&<div className="review-actions">
        <button className="button small" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,true)}>Valider et publier</button>
        {rejectNoteFor===ev.id?<form className="reject-note" onSubmit={e=>{e.preventDefault();reviewDecision(ev.id,false,rejectNote)}}><label>Ce que le restaurateur doit modifier<textarea required minLength={10} value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Ex. : ajoutez une photo de la salle, précisez ce qui est inclus dans le prix…"/></label><div className="decision-buttons"><button className="button small danger" disabled={actingOn===ev.id}>Renvoyer « À modifier »</button><button type="button" className="button small secondary" onClick={()=>{setRejectNoteFor(null);setRejectNote("")}}>Annuler</button></div></form>:<button className="button small secondary" onClick={()=>setRejectNoteFor(ev.id)}>Demander des modifications</button>}
      </div>}


      {editFor===ev.id?<div className="event-edit-form">
        <label>Titre<input value={editForm.title} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></label>
        <label>Description<textarea value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></label>
        <div className="time-row"><label>Capacité<input type="number" min={5} value={editForm.capacity} onChange={e=>setEditForm({...editForm,capacity:Number(e.target.value)})}/></label></div>
        <div className="time-row"><label>Début<input type="datetime-local" disabled={ev.status==="PUBLISHED"||ev.status==="FULL"} value={editForm.startsAt} onChange={e=>setEditForm({...editForm,startsAt:e.target.value})}/></label><label>Fin<input type="datetime-local" disabled={ev.status==="PUBLISHED"||ev.status==="FULL"} value={editForm.endsAt} onChange={e=>setEditForm({...editForm,endsAt:e.target.value})}/></label></div>
        {(ev.status==="PUBLISHED"||ev.status==="FULL")&&<p className="fine left">Une soirée publiée ne peut plus être déplacée : annulez-la puis créez-en une nouvelle à la date souhaitée.</p>}
        <small>Prestations réellement incluses</small>
        <div className="perks-checks">
          <label><input type="checkbox" checked={editForm.includesDrink} onChange={e=>setEditForm({...editForm,includesDrink:e.target.checked})}/> Boisson</label>
          <label><input type="checkbox" checked={editForm.includesStarter} onChange={e=>setEditForm({...editForm,includesStarter:e.target.checked})}/> Entrée</label>
          <label><input type="checkbox" checked={editForm.includesMain} onChange={e=>setEditForm({...editForm,includesMain:e.target.checked})}/> Plat</label>
          <label><input type="checkbox" checked={editForm.includesDessert} onChange={e=>setEditForm({...editForm,includesDessert:e.target.checked})}/> Dessert</label>
        </div>
        <label>Précisions sur les prestations<textarea value={editForm.perksDescription} onChange={e=>setEditForm({...editForm,perksDescription:e.target.value})} placeholder="Ex. : cocktail sans alcool à l’arrivée, buffet salé…"/></label>
        <div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveEdit(ev.id)}>Enregistrer</button><button className="button small secondary" onClick={()=>setEditFor(null)}>Annuler</button></div>
      </div>:<button className="button small secondary" onClick={()=>openEditor(ev)}>Modifier les informations</button>}

      {pricingFor===ev.id?<div className="event-edit-form">
        {ev.genderPricingEnabled&&<div className="time-row"><label><input type="radio" checked={pricingForm.mode==="flat"} onChange={()=>setPricingForm({...pricingForm,mode:"flat"})}/> Tarif unique</label><label><input type="radio" checked={pricingForm.mode==="differentiated"} onChange={()=>setPricingForm({...pricingForm,mode:"differentiated"})}/> Tarif différencié homme/femme</label></div>}
        {pricingForm.mode==="flat"?<label>Prix (€, TTC)<EuroInput cents={pricingForm.amountCents} onChange={c=>setPricingForm({...pricingForm,amountCents:c})}/></label>
        :<><div className="time-row"><label>Hommes (€, TTC)<EuroInput cents={pricingForm.homme} onChange={c=>setPricingForm({...pricingForm,homme:c})}/></label><label>Femmes (€, TTC)<EuroInput cents={pricingForm.femme} onChange={c=>setPricingForm({...pricingForm,femme:c})}/></label></div><p className="fine left">La conformité juridique d’un tarif différencié selon le sexe doit être vérifiée avant toute mise en production. Tant que « Tarification homme/femme » reste désactivée dans Réglages, ces montants sont enregistrés mais n’ont aucun effet : tout le monde paie le tarif unique.</p></>}
        <div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>savePricing(ev.id)}>Enregistrer les tarifs</button><button className="button small secondary" onClick={()=>setPricingFor(null)}>Annuler</button></div>
      </div>:<button className="button small secondary" onClick={()=>openPricing(ev)}>{!ev.genderPricingEnabled?"Modifier le prix":ev.priceTiers?.length?"Modifier les tarifs":"Définir un tarif différencié"}</button>}

      {ev.category==="Speed dating"&&<div className="quota-editor">
        {quotaEditFor===ev.id?<><div className="time-row"><label>Hommes<input type="number" min={0} value={quotaForm.homme} onChange={e=>setQuotaForm({...quotaForm,homme:Number(e.target.value)})}/></label><label>Femmes<input type="number" min={0} value={quotaForm.femme} onChange={e=>setQuotaForm({...quotaForm,femme:Number(e.target.value)})}/></label></div><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveQuotas(ev.id)}>Enregistrer les quotas</button></>
        :<button className="button small secondary" onClick={()=>openQuotaEditor(ev)}>{ev.quotas?.length?"Modifier les quotas":"Définir des quotas"}</button>}
        {ev.quotas?.length>0&&<p className="fine left">{ev.quotas.map((q:any)=>`${q.category==="HOMME"?"Hommes":"Femmes"} : ${q.heldCount}/${q.capacity}`).join(" · ")}</p>}
      </div>}

      <button type="button" className="button small secondary" onClick={()=>toggleHistory(ev.id)}>{historyFor===ev.id?"Masquer l’historique":"Voir l’historique"}</button>
      {historyFor===ev.id&&<div className="stack"><ul className="history-list">{historyItems.map(h=><li key={h.id}><small>{dateTime(h.createdAt)}</small> — {HISTORY_LABEL[h.action]??h.action}</li>)}</ul></div>}

      {ev.minParticipantsNotifiedAt&&!ev.minParticipantsOutcome&&<div className="reject-note"><span className="fine left">Minimum de {ev.minParticipants} participants non atteint : maintenir ou annuler ?</span><button className="button small" disabled={actingOn===ev.id} onClick={()=>decideMinParticipants(ev.id,"MAINTAIN")}>Maintenir</button><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>decideMinParticipants(ev.id,"CANCEL")}>Annuler (remboursement intégral)</button></div>}
      {ev.status!=="CANCELLED"&&(cancelConfirmFor===ev.id?<div className="reject-note"><span className="fine left">Confirmer l’annulation de cet événement ?</span><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>cancelEvent(ev.id)}>Confirmer l’annulation</button></div>:<button className="button small danger" onClick={()=>setCancelConfirmFor(ev.id)}>Annuler l’événement</button>)}
    </div></div>)}</div>
  </div></section></Layout>;
}

export function AdminAttendees() {
  const {user}=useAuth();
  const isAdmin=user?.role==="ADMIN";
  const [events,setEvents]=useState<any[]>([]);
  const [eventId,setEventId]=useState("");
  const [reservations,setReservations]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [requestingFor,setRequestingFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);

  useEffect(()=>{api<any[]>("/admin/events").then(evts=>{setEvents(evts);if(evts[0])setEventId(evts[0].id)})},[]);
  const load=useCallback(()=>{
    if(!eventId)return;
    setLoading(true);
    api<any[]>(`/admin/events/${eventId}/reservations`).then(setReservations).catch(()=>setReservations([])).finally(()=>setLoading(false));
  },[eventId]);
  useEffect(()=>{load()},[load]);

  // Corrections web 2026-09-24 (§6.1) : seul le super-admin rembourse (le restaurateur n'a plus aucun
  // bouton de remboursement) ; un motif est exigé par l'API pour une exception à 24h ou moins.
  const refund=async(paymentId:string)=>{
    setBusy(paymentId);setNotice(null);
    try{await api(`/admin/payments/${paymentId}/refund`,{method:"POST",body:JSON.stringify(reason?{reason}:{})});setNotice({kind:"success",text:"Remboursement effectué."});setRequestingFor(null);setReason("");load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  const STATUS_LABEL:Record<string,string>={PENDING:"En attente",SUCCEEDED:"Payé",FAILED:"Échoué",REFUNDED:"Remboursé"};
  const PAYMENT_TONE:Record<string,string>={PENDING:"neutral",SUCCEEDED:"success",FAILED:"danger",REFUNDED:"warning"};
  const [q,setQ]=useState("");
  const ticketState=(r:any)=>r.ticket?.status==="USED"?{label:"Présent",tone:"success"}:r.ticket?.status==="VALID"?{label:"Billet valide",tone:"info"}:r.cancelledAt?{label:"Annulé",tone:"danger"}:{label:"En attente",tone:"neutral"};
  // Événements à venir d'abord (du plus proche au plus lointain), puis les passés.
  const sortedEvents=[...events].sort((x,y)=>{const px=new Date(x.endsAt)<new Date(),py=new Date(y.endsAt)<new Date();return px===py?(px?+new Date(y.startsAt)-+new Date(x.startsAt):+new Date(x.startsAt)-+new Date(y.startsAt)):px?1:-1});
  const query=q.trim().toLowerCase();
  const rows=loading?null:reservations.filter(r=>!query||[r.user.displayName,r.user.phone].some((t:string|undefined)=>t?.toLowerCase().includes(query)));
  const paid=reservations.filter(r=>r.payment?.status==="SUCCEEDED"||r.confirmedAt).length;
  const present=reservations.filter(r=>r.ticket?.status==="USED").length;
  const refunding=reservations.find(r=>r.payment?.id===requestingFor);
  const columns:Column<any>[]=[
    {key:"name",header:"Participant",primary:true,render:r=><span className="cell-main"><b>{r.user.displayName}</b>{r.user.phone&&<small>{r.user.phone}</small>}</span>},
    {key:"category",header:"Catégorie",render:r=>r.quotaCategory?QUOTA_CATEGORY_LABEL[r.quotaCategory]??r.quotaCategory:"—"},
    {key:"payment",header:"Paiement",render:r=>r.payment?<span className={`badge ${PAYMENT_TONE[r.payment.status]??"neutral"}`}>{STATUS_LABEL[r.payment.status]??r.payment.status}</span>:<span className="badge neutral">Gratuit ou sans paiement</span>},
    {key:"ticket",header:"Billet",render:r=>{const t=ticketState(r);return <span className={`badge ${t.tone}`}>{t.label}</span>}},
    ...(isAdmin?[{key:"actions",header:"Actions",render:(r:any)=><span className="cell-actions">{r.payment?.status==="SUCCEEDED"&&<button type="button" className="button small secondary" onClick={()=>{setRequestingFor(r.payment.id);setReason("")}}>Rembourser</button>}{r.payment?.refundRequestedAt&&r.payment.status==="SUCCEEDED"&&<small className="fine">Demande : {r.payment.refundRequestReason}</small>}</span>}]:[])
  ];
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Participants</h1><p className="fine left">Informations nécessaires à l’organisation de l’événement uniquement.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="table-toolbar">
      <label className="visually-hidden" htmlFor="attendees-event">Événement</label>
      <select id="attendees-event" className="event-select" value={eventId} onChange={e=>{setEventId(e.target.value);setRequestingFor(null)}}>{sortedEvents.map(ev=><option key={ev.id} value={ev.id}>{tableDate(ev.startsAt)} — {ev.title}</option>)}</select>
      <label className="search-field"><span className="visually-hidden">Rechercher un participant</span><Search size={18} aria-hidden="true"/><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher : nom, téléphone…"/></label>
    </div>
    <div className="stat-grid kpi-row"><Stat label="Inscrits" value={loading?"…":reservations.length}/><Stat label="Places confirmées" value={loading?"…":paid}/><Stat label="Présents (billet scanné)" value={loading?"…":present}/></div>
    <DataTable caption="Participants de l’événement" rows={rows} columns={columns} rowKey={r=>r.id} empty={query?`Aucun participant ne correspond à « ${q} ».`:"Aucun participant pour le moment."}/>
    {isAdmin&&refunding&&<div className="panel refund-panel"><div className="panel-title"><h2>Rembourser {refunding.user.displayName}</h2></div><label>Motif (obligatoire à 24 h ou moins de l’événement)<input value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="decision-buttons"><button className="button small danger" disabled={busy===refunding.payment.id} onClick={()=>refund(refunding.payment.id)}>{busy===refunding.payment.id?"Remboursement…":"Confirmer le remboursement"}</button><button type="button" className="button small secondary" onClick={()=>setRequestingFor(null)}>Annuler</button></div></div>}
  </div></section></Layout>;
}


// Date compacte pour les tableaux : « mer. 30 sept. · 19h30 ».
const tableDate = (value: string) => { const d = new Date(value); return `${new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(d)} · ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(d).replace(":", "h")}`; };
type EventView = "review" | "upcoming" | "drafts" | "past";
const isPast = (ev: any) => ["CANCELLED", "COMPLETED"].includes(ev.status) || new Date(ev.endsAt) < new Date();
const EVENT_VIEWS: { value: EventView; label: string; match: (ev: any) => boolean }[] = [
  { value: "review", label: "À valider", match: ev => ev.status === "PENDING_REVIEW" },
  { value: "upcoming", label: "À venir", match: ev => ["PUBLISHED", "FULL"].includes(ev.status) && !isPast(ev) },
  { value: "drafts", label: "Brouillons", match: ev => ev.status === "DRAFT" && !isPast(ev) },
  { value: "past", label: "Passés et annulés", match: isPast }
];

// Espace événements du super-admin (v3) : ses propres événements Nūr Meet et ceux des restaurateurs, dans
// un tableau filtrable ; la file « À valider » s'ouvre d'office quand des soirées attendent une décision.
function AdminEventsOverview({ events, actingOn, onManage, onPublish }: { events: any[] | null; actingOn: string | null; onManage: (id: string) => void; onPublish: (id: string) => void }) {
  const toReview = (events ?? []).filter(EVENT_VIEWS[0].match).length;
  const [view, setView] = useState<EventView | null>(null);
  const [organizer, setOrganizer] = useState<"all" | "nour" | "restaurants">("all");
  const [q, setQ] = useState("");
  const current: EventView = view ?? (toReview > 0 ? "review" : "upcoming");
  const byOrganizer = (events ?? []).filter(ev => organizer === "all" || (organizer === "nour" ? !ev.controllerRestaurantId : !!ev.controllerRestaurantId));
  const query = q.trim().toLowerCase();
  const rows = events === null ? null : byOrganizer
    .filter(EVENT_VIEWS.find(v => v.value === current)!.match)
    .filter(ev => !query || [ev.title, ev.district, ev.controllerRestaurant?.name, ev.venueRestaurant?.name].some(t => t?.toLowerCase().includes(query)))
    .sort((a, b) => current === "past" ? +new Date(b.startsAt) - +new Date(a.startsAt) : +new Date(a.startsAt) - +new Date(b.startsAt));
  const columns: Column<any>[] = [
    { key: "date", header: "Date", render: ev => <span className="cell-main"><b>{tableDate(ev.startsAt)}</b></span> },
    { key: "title", header: "Événement", primary: true, render: ev => <span className="cell-main"><b>{ev.title}</b><small><CategoryBadge category={ev.category} className="inline"/></small></span> },
    { key: "organizer", header: "Organisateur", render: ev => ev.controllerRestaurant?.name ?? "Nūr Meet" },
    { key: "venue", header: "Lieu", render: ev => ev.venueRestaurant ? `${ev.venueRestaurant.name} · ${ev.district}` : ev.district },
    { key: "seats", header: "Places vendues", numeric: true, render: ev => `${ev.soldCount ?? 0} / ${ev.capacity}` },
    { key: "status", header: "Statut", render: ev => { const v = eventValidation(ev.status === "PUBLISHED" && (ev.soldCount ?? 0) >= ev.capacity ? { ...ev, status: "FULL" } : ev); return <span className={`badge ${v.tone}`}>{v.label}</span>; } },
    { key: "actions", header: "Actions", render: ev => <span className="cell-actions" onClick={e => e.stopPropagation()}>
      {!ev.controllerRestaurantId && ev.status === "DRAFT" && !isPast(ev) && <button type="button" className="button small" disabled={actingOn === ev.id} onClick={() => onPublish(ev.id)}>{actingOn === ev.id ? "…" : "Publier"}</button>}
      <button type="button" className="button small secondary" onClick={() => onManage(ev.id)}>{ev.status === "PENDING_REVIEW" ? "Examiner" : "Gérer"}</button>
      {["PUBLISHED", "FULL", "COMPLETED"].includes(ev.status) && <a className="icon-button" href={`/events/${ev.slug}`} target="_blank" rel="noreferrer" aria-label={`Voir la fiche publique de « ${ev.title} »`} title="Voir la fiche publique"><ExternalLink size={18} aria-hidden="true"/></a>}
    </span> }
  ];
  return <>
    <div className="page-head"><div><h1>Événements</h1><p className="fine left">Vos événements Nūr Meet et les soirées proposées par les restaurateurs.</p></div><Link className="button" to="/admin/events/new">Créer un événement Nūr Meet</Link></div>
    <FilterTabs label="Filtrer les événements" value={current} onChange={setView} options={EVENT_VIEWS.map(v => ({ value: v.value, label: v.label, count: events === null ? undefined : byOrganizer.filter(v.match).length }))}/>
    <div className="table-toolbar">
      <label className="search-field"><span className="visually-hidden">Rechercher un événement</span><Search size={18} aria-hidden="true"/><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher : titre, lieu, restaurant…"/></label>
      <label className="visually-hidden" htmlFor="organizer-filter">Organisateur</label>
      <select id="organizer-filter" value={organizer} onChange={e => setOrganizer(e.target.value as typeof organizer)}><option value="all">Tous les organisateurs</option><option value="nour">Nūr Meet</option><option value="restaurants">Restaurateurs</option></select>
    </div>
    <DataTable caption="Événements" rows={rows} columns={columns} rowKey={ev => ev.id} onRowClick={ev => onManage(ev.id)}
      empty={current === "review" ? "Aucune soirée n’attend votre validation." : query ? `Aucun événement ne correspond à « ${q} ».` : "Aucun événement dans cette vue."}/>
  </>;
}
