import { Inbox, X } from "lucide-react";
import { EVENT_CATEGORIES, EVENT_ZONES } from "@nour/shared";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { CategoryBadge, Loading, Notice } from "../../components/ui";
import { dateTime, imgUrl } from "../../lib/format";
import { EVENT_STATUS_LABEL, QUOTA_CATEGORY_LABEL } from "../../lib/labels";
import { spacePath } from "../../lib/spaces";
import { AdminNav } from "./AdminNav";

// Prix saisis en euros (« 35 » ou « 29,50 »), comme dans l'application mobile — stockés en centimes.
// Le texte tapé est gardé tel quel pendant la frappe (« 29, » ne doit pas redevenir « 29 »).
function EuroInput({ cents, onChange, required }: { cents: number; onChange: (cents: number) => void; required?: boolean }) {
  const format = (c: number) => (c / 100).toFixed(2).replace(".", ",").replace(",00", "");
  const [text, setText] = useState(format(cents));
  useEffect(() => { setText(prev => { const n = Number(prev.replace(",", ".")); return Number.isFinite(n) && Math.round(n * 100) === cents ? prev : format(cents); }); }, [cents]);
  return <input required={required} inputMode="decimal" pattern="[0-9]+([,.][0-9]{1,2})?" value={text} onChange={e => { setText(e.target.value); const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100)); }}/>;
}

export function AdminCreateEvent() {
  const {user}=useAuth();
  const navigate=useNavigate();
const [form,setForm]=useState({title:"",slug:"",category:EVENT_CATEGORIES[0].name,flow:"" as ""|"SCREENING"|"DIRECT",description:"",startsAt:"",endsAt:"",district:"",address:"",zone:EVENT_ZONES[0],minAge:"",maxAge:"",capacity:20,priceCents:3000,includesDrink:false,includesStarter:false,includesMain:false,includesDessert:false,perksDescription:"",minParticipants:"",minParticipantsDeadline:""});
  const [submitting,setSubmitting]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [restaurantInfo,setRestaurantInfo]=useState<any>(null);
  useEffect(()=>{if(user?.role==="ORGANIZER")api<any>("/restaurants/me").then(setRestaurantInfo).catch(()=>{})},[user?.role]);
  const slugify=(t:string)=>t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{
      await api("/admin/events",{method:"POST",body:JSON.stringify({...form,flow:form.flow||undefined,minAge:form.minAge?Number(form.minAge):undefined,maxAge:form.maxAge?Number(form.maxAge):undefined,minParticipants:form.minParticipants?Number(form.minParticipants):undefined,minParticipantsDeadline:form.minParticipantsDeadline?new Date(form.minParticipantsDeadline).toISOString():undefined,startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString()})});
      setNotice({kind:"success",text:user?.role==="ORGANIZER"?"Brouillon créé. Ajoutez vos photos puis soumettez-le à validation.":"Événement créé."});
      setTimeout(()=>navigate(spacePath(user?.role,"events")),1200);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Créer une soirée</h1><p className="fine left">{user?.role==="ORGANIZER"?"Votre soirée démarre en brouillon : ajoutez ensuite ses photos puis soumettez-la à validation (au moins une photo de votre établissement est obligatoire).":"Vous publiez directement vos propres événements."}</p>
    {user?.role==="ORGANIZER"&&restaurantInfo&&!(restaurantInfo.photos?.length>0)&&<Notice kind="error">Ajoutez d’abord au moins une photo de votre établissement : sans elle, la soirée ne pourra pas être soumise à validation. <Link className="text-link" to="/restaurant">Ajouter une photo</Link></Notice>}
    {user?.role==="ORGANIZER"&&restaurantInfo&&!["ACTIVE","TRIALING"].includes(restaurantInfo.subscription?.status)&&<Notice kind="info">Aucun abonnement actif : vous pouvez préparer et soumettre votre soirée, mais elle ne sera publiée qu’avec une formule active. <Link className="text-link" to="/restaurant?tab=subscription">Choisir une formule</Link></Notice>}
    {user?.role==="ORGANIZER"&&restaurantInfo?.subscription&&<Notice kind="info">Abonnement « {restaurantInfo.subscription.plan.name} » ({(restaurantInfo.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois) — {restaurantInfo.currentMonthEventsPublished}{restaurantInfo.subscription.plan.monthlyEventQuota==null?" événements publiés ce mois-ci (illimité)":`/${restaurantInfo.subscription.plan.monthlyEventQuota} événements publiés ce mois-ci`}. Un brouillon ne consomme le quota qu’à sa première publication.</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={submit}>
      <label>Titre<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value,slug:form.slug?form.slug:slugify(e.target.value)})}/></label>
      <label>Identifiant (slug)<input required pattern="[a-z0-9-]+" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
      {user?.role==="ADMIN"&&<label>Parcours d’inscription<select value={form.flow} onChange={e=>setForm({...form,flow:e.target.value as ""|"SCREENING"|"DIRECT"})}><option value="">Suggéré selon la catégorie</option><option value="SCREENING">Sélection (entretien requis)</option><option value="DIRECT">Accès direct (paiement immédiat)</option></select></label>}
      <label>Zone<select value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}>{EVENT_ZONES.map(z=><option key={z} value={z}>{z}</option>)}</select></label>
      <div className="time-row"><label>Âge minimum (facultatif)<input type="number" min={18} max={99} value={form.minAge} onChange={e=>setForm({...form,minAge:e.target.value})}/></label><label>Âge maximum (facultatif)<input type="number" min={18} max={99} value={form.maxAge} onChange={e=>setForm({...form,maxAge:e.target.value})}/></label></div>
      <label className="wide">Description<textarea required minLength={20} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <div className="time-row"><label>Début<input required type="datetime-local" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label><label>Fin<input required type="datetime-local" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label></div>
      <label>Quartier / ville<input required value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
      <label>Adresse<input required value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
      <div className="time-row"><label>Capacité totale<input required type="number" min={5} max={500} value={form.capacity} onChange={e=>setForm({...form,capacity:Number(e.target.value)})}/></label><label>Prix (€, TTC)<EuroInput required cents={form.priceCents} onChange={c=>setForm({...form,priceCents:c})}/></label></div>
      <div className="wide"><small>Prestations réellement incluses</small><div className="perks-checks">
        <label><input type="checkbox" checked={form.includesDrink} onChange={e=>setForm({...form,includesDrink:e.target.checked})}/> Boisson</label>
        <label><input type="checkbox" checked={form.includesStarter} onChange={e=>setForm({...form,includesStarter:e.target.checked})}/> Entrée</label>
        <label><input type="checkbox" checked={form.includesMain} onChange={e=>setForm({...form,includesMain:e.target.checked})}/> Plat</label>
        <label><input type="checkbox" checked={form.includesDessert} onChange={e=>setForm({...form,includesDessert:e.target.checked})}/> Dessert</label>
      </div></div>
      <label className="wide">Précisions sur les prestations<textarea value={form.perksDescription} onChange={e=>setForm({...form,perksDescription:e.target.value})} placeholder="Ex. : cocktail sans alcool à l’arrivée, buffet salé…"/></label>
      <div className="time-row"><label>Minimum de participants (facultatif)<input type="number" min={1} value={form.minParticipants} onChange={e=>setForm({...form,minParticipants:e.target.value})}/></label>{form.minParticipants&&<label>Date limite de décision<input required type="datetime-local" value={form.minParticipantsDeadline} onChange={e=>setForm({...form,minParticipantsDeadline:e.target.value})}/></label>}</div>
      <p className="fine wide">Les quotas hommes/femmes (Speed dating), les tarifs différenciés et la galerie photo se règlent après création, depuis « Mes événements ».</p>
      <button className="button" disabled={submitting}>{submitting?"Création…":"Créer la soirée"}</button>
    </form>
  </div></section></Layout>;
}

export function AdminEventPhotos() {
  const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const highlightId=searchParams.get("highlight");
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
  // C14 (ordre correctif 2026-09-20) : une notification "soirée approuvée/à valider/..." doit ouvrir
  // CETTE soirée, pas seulement la liste — /admin/events?highlight=<id> défile jusqu'à sa carte et
  // la met en évidence brièvement plutôt que de forcer le restaurateur à la rechercher lui-même.
  useEffect(()=>{
    if(!highlightId||events.length===0)return;
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
  const HISTORY_LABEL:Record<string,string>={CREATE_EVENT:"Création",SUBMIT_EVENT_FOR_REVIEW:"Soumis à validation",APPROVE_EVENT:"Publié",REJECT_EVENT:"Renvoyé en brouillon",UPDATE_EVENT:"Modifié",SET_EVENT_PRICING:"Tarifs modifiés",SET_EVENT_QUOTAS:"Quotas modifiés",ADD_EVENT_PHOTO:"Photo ajoutée",CANCEL_EVENT:"Annulé",APPROVE_DATE_CHANGE:"Changement de date approuvé",REJECT_DATE_CHANGE:"Changement de date refusé"};

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Mes événements</h1><p className="fine left">Formats acceptés : JPEG, PNG, WEBP · 5 Mo maximum. Sans photo personnalisée, l’illustration de la catégorie est utilisée.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="event-photo-grid">{events.map(ev=><div key={ev.id} id={`event-${ev.id}`} className="panel event-photo-card"><img src={imgUrl(ev.imageUrl)} alt={ev.title}/><div><b>{ev.title}</b><div className="admin-event-meta"><CategoryBadge category={ev.category} className="inline"/><small>{EVENT_STATUS_LABEL[ev.status]??ev.status}</small></div>
      <label className="button small secondary">{uploadingFor===ev.id?"Envoi…":"Changer la photo principale"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id} onChange={e=>{const f=e.target.files?.[0];if(f)upload(ev.id,f);e.target.value=""}}/></label>

      <div className="gallery-editor"><small>GALERIE ({ev.photos?.length??0}/5)</small><div className="gallery-thumbs">{(ev.photos??[]).map((p:any)=><div key={p.id} className="gallery-thumb"><img src={imgUrl(p.url)} alt=""/><button type="button" onClick={()=>removeGalleryPhoto(ev.id,p.id)} aria-label="Supprimer la photo"><X size={16} aria-hidden="true"/></button></div>)}</div><label className="button small secondary" style={{opacity:(ev.photos?.length??0)>=5?0.5:1}}>{uploadingFor===ev.id?"Envoi…":"Ajouter une photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id||(ev.photos?.length??0)>=5} onChange={e=>{const f=e.target.files?.[0];if(f)uploadGalleryPhoto(ev.id,f);e.target.value=""}}/></label></div>

      {user?.role==="ORGANIZER"&&ev.status==="DRAFT"&&<button className="button small" disabled={actingOn===ev.id} onClick={()=>submitForReview(ev.id)}>{actingOn===ev.id?"Envoi…":"Soumettre à validation"}</button>}
      {user?.role==="ADMIN"&&ev.status==="PENDING_REVIEW"&&<div className="review-actions">
        <button className="button small" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,true)}>Publier</button>
        {rejectNoteFor===ev.id?<div className="reject-note"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Motif (optionnel)"/><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,false,rejectNote)}>Confirmer le refus</button></div>:<button className="button small danger" onClick={()=>setRejectNoteFor(ev.id)}>Renvoyer en brouillon</button>}
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
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Participants</h1><p className="fine">Informations nécessaires à l’organisation de votre événement uniquement.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="filters"><select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(ev=><option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></div>
    {loading?<Loading/>:reservations.length===0?<div className="empty"><Inbox size={24} aria-hidden="true"/><h2>Aucun participant pour le moment</h2></div>:<div className="panel table"><div className="table-row head"><span>Participant</span><span>Catégorie</span><span>Paiement</span><span>Billet</span></div>{reservations.map(r=><div key={r.id} className="table-row"><span><b>{r.user.displayName}</b>{r.user.phone&&<small>{r.user.phone}</small>}</span><span>{r.quotaCategory?QUOTA_CATEGORY_LABEL[r.quotaCategory]??r.quotaCategory:"—"}</span><span>{r.payment?STATUS_LABEL[r.payment.status]??r.payment.status:"—"}{isAdmin&&r.payment?.status==="SUCCEEDED"&&(requestingFor===r.payment.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif (obligatoire à 24 h ou moins)"/><button className="button small danger" disabled={busy===r.payment.id} onClick={()=>refund(r.payment.id)}>{busy===r.payment.id?"Remboursement…":"Confirmer le remboursement"}</button></div>:<button type="button" className="button small secondary" onClick={()=>setRequestingFor(r.payment.id)}>Rembourser</button>)}{isAdmin&&r.payment?.refundRequestedAt&&r.payment.status==="SUCCEEDED"&&<small className="fine">Demande historique : {r.payment.refundRequestReason}</small>}</span><span>{r.ticket?.status==="USED"?"Utilisé":r.ticket?.status==="VALID"?"Valide":r.cancelledAt?"Annulé":"En attente"}</span></div>)}</div>}
  </div></section></Layout>;
}
