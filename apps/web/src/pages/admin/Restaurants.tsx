import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { SUBSCRIPTION_STATUS_LABEL } from "../../lib/labels";
import { Layout } from "../../components/Layout";
import { Notice } from "../../components/ui";
import { imgUrl, money } from "../../lib/format";
import { RESTAURANT_STATUS_LABEL } from "../../lib/labels";
import { AdminNav } from "./AdminNav";

export function AdminRestaurants() {
  // null = en cours de chargement (squelette), [] = réellement vide : jamais d'état vide affiché
  // avant l'arrivée des données.
  const [items,setItems]=useState<any[]|null>(null);
  const [plans,setPlans]=useState<any[]|null>(null);
  const [filter,setFilter]=useState("PENDING");
  const [actingOn,setActingOn]=useState<string|null>(null);
  const [reasonFor,setReasonFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [notesFor,setNotesFor]=useState<string|null>(null);
  const [notes,setNotes]=useState("");
  const [subFor,setSubFor]=useState<string|null>(null);
  const [subForm,setSubForm]=useState({planId:"",status:"ACTIVE"});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [planEdits,setPlanEdits]=useState<Record<string,{monthlyPriceCents:string;monthlyEventQuota:string}>>({});
  const [newPlan,setNewPlan]=useState({name:"",monthlyPriceCents:"",monthlyEventQuota:""});
  const load=()=>api<any[]>(`/admin/restaurants?status=${filter}`).then(setItems);
  const loadPlans=()=>api<any[]>("/admin/plans").then(v=>{setPlans(v);setPlanEdits(Object.fromEntries(v.map(p=>[p.id,{monthlyPriceCents:String(p.monthlyPriceCents/100),monthlyEventQuota:p.monthlyEventQuota==null?"":String(p.monthlyEventQuota)}])))});
  useEffect(()=>{load();loadPlans().catch(()=>{})},[filter]);
  const savePlan=async(id:string)=>{
    const edit=planEdits[id];setNotice(null);
    try{await api(`/admin/plans/${id}`,{method:"PATCH",body:JSON.stringify({monthlyPriceCents:Math.round(Number(edit.monthlyPriceCents)*100),monthlyEventQuota:edit.monthlyEventQuota===""?null:Number(edit.monthlyEventQuota)})});setNotice({kind:"success",text:"Formule mise à jour."});await loadPlans()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const togglePlanActive=async(p:any)=>{
    try{await api(`/admin/plans/${p.id}`,{method:"PATCH",body:JSON.stringify({active:!p.active})});await loadPlans()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const createPlan=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    try{await api("/admin/plans",{method:"POST",body:JSON.stringify({name:newPlan.name,monthlyPriceCents:Math.round(Number(newPlan.monthlyPriceCents)*100),monthlyEventQuota:newPlan.monthlyEventQuota===""?null:Number(newPlan.monthlyEventQuota)})});setNewPlan({name:"",monthlyPriceCents:"",monthlyEventQuota:""});setNotice({kind:"success",text:"Formule créée."});await loadPlans()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const decide=async(id:string, accept:boolean, rejectReason?:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/decision`,{method:"POST",body:JSON.stringify({accept,reason:rejectReason})});setNotice({kind:"success",text:accept?"Restaurateur approuvé. Un essai d’abonnement a été activé.":"Demande refusée."});setReasonFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const saveNotes=async(id:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/notes`,{method:"PATCH",body:JSON.stringify({adminNotes:notes})});setNotice({kind:"success",text:"Notes internes enregistrées."});setNotesFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const saveSubscription=async(id:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/subscription`,{method:"POST",body:JSON.stringify(subForm)});setNotice({kind:"success",text:"Abonnement mis à jour."});setSubFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Demandes restaurateurs</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="panel" style={{marginBottom:20}}>
      <div className="panel-title"><h2>Formules d’abonnement</h2><span>Prix HT · quota vide = illimité · le prix annuel se fixe séparément (2 mois offerts)</span></div>
      <div className="stack">{plans===null&&[0,1].map(i=><div key={i} className="skeleton" style={{height:76}}/>)}{(plans??[]).map(p=><div key={p.id} className="time-row" style={{alignItems:"center"}}>
        <span>{p.name}{!p.active&&" (désactivée)"}</span>
        <label>€/mois<input type="number" min={0} step="1" value={planEdits[p.id]?.monthlyPriceCents??""} onChange={e=>setPlanEdits({...planEdits,[p.id]:{...planEdits[p.id],monthlyPriceCents:e.target.value}})}/></label>
        <label>Quota mensuel (vide=illimité)<input type="number" min={1} placeholder="illimité" value={planEdits[p.id]?.monthlyEventQuota??""} onChange={e=>setPlanEdits({...planEdits,[p.id]:{...planEdits[p.id],monthlyEventQuota:e.target.value}})}/></label>
        <small className="fine">Annuel : {(Math.round(Number(planEdits[p.id]?.monthlyPriceCents||0)*100*12*0.8)/100).toFixed(0)} €/an</small>
        <button type="button" className="button small" onClick={()=>savePlan(p.id)}>Enregistrer</button>
        <button type="button" className="button small secondary" onClick={()=>togglePlanActive(p)}>{p.active?"Désactiver":"Réactiver"}</button>
      </div>)}</div>
      <form className="time-row" onSubmit={createPlan} style={{marginTop:14,alignItems:"center"}}>
        <input placeholder="Nom de la nouvelle formule" value={newPlan.name} onChange={e=>setNewPlan({...newPlan,name:e.target.value})} required/>
        <input type="number" min={0} placeholder="€/mois" value={newPlan.monthlyPriceCents} onChange={e=>setNewPlan({...newPlan,monthlyPriceCents:e.target.value})} required/>
        <input type="number" min={1} placeholder="Quota (vide=illimité)" value={newPlan.monthlyEventQuota} onChange={e=>setNewPlan({...newPlan,monthlyEventQuota:e.target.value})}/>
        <button className="button small">Créer la formule</button>
      </form>
    </div>
    <div className="filters"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="PENDING">En attente</option><option value="APPROVED">Approuvés</option><option value="REJECTED">Refusés</option><option value="SUSPENDED">Suspendus</option></select></div>
    {items===null?<div className="stack" aria-busy="true">{[0,1,2].map(i=><div key={i} className="skeleton" style={{height:64}}/>)}</div>:items.length===0?<div className="empty"><h2>Aucune demande</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request">
      <div>
        <h3>{r.name}</h3>
        <p>{r.owner.displayName} · <a href={`tel:${r.phone||r.owner.phone}`}>{r.phone||r.owner.phone}</a>{r.owner.email?<> · <a href={`mailto:${r.owner.email}`}>Contacter par e-mail</a></>:null}</p>
        <p className="fine left">Responsable : {r.managerName??"—"} · SIRET {r.siret??"—"}</p>
        {r.district&&<p className="fine left">{r.address}, {r.district}</p>}
        {r.description&&<p className="fine left">{r.description}</p>}
        <p className="fine left">Places souhaitées : {r.desiredCapacity??"—"} · Créneaux : {r.desiredSchedule??"—"} · Prix moyen/pers. : {r.averagePricePerPersonCents!=null?money(r.averagePricePerPersonCents):"—"} · Minimum habituel : {r.defaultMinParticipants??"—"}</p>
        <p className="fine left">Inclus : {[r.priceIncludesDrink&&"boisson",r.priceIncludesStarter&&"entrée",r.priceIncludesMain&&"plat",r.priceIncludesDessert&&"dessert"].filter(Boolean).join(", ")||"—"}{r.proposesCategoryPricing?" · tarifs par catégorie proposés":""}{r.allowsPrivatization?" · privatisation possible":""}</p>
        {r.specialConditions&&<p className="fine left">Conditions particulières : {r.specialConditions}</p>}
        {r.photos?.length>0&&<div className="event-photo-grid">{r.photos.map((p:any)=><img key={p.id} src={imgUrl(p.url)} alt="" style={{height:100,borderRadius:8,objectFit:"cover"}}/>)}</div>}
        <small>{RESTAURANT_STATUS_LABEL[r.status]}</small>
        {r.status==="APPROVED"&&<p className="fine left">Abonnement : {r.subscription?`${r.subscription.plan.name} (${(r.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois) — ${SUBSCRIPTION_STATUS_LABEL[r.subscription.status]??r.subscription.status}`:"aucun"} <button type="button" className="link-button" onClick={()=>{setSubFor(r.id);setSubForm({planId:r.subscription?.planId??plans?.[0]?.id??"",status:r.subscription?.status??"ACTIVE"})}}>modifier</button></p>}
        {subFor===r.id&&<div className="time-row"><select value={subForm.planId} onChange={e=>setSubForm({...subForm,planId:e.target.value})}>{(plans??[]).map(p=><option key={p.id} value={p.id}>{p.name} ({(p.monthlyPriceCents/100).toFixed(0)} €/mois, {p.monthlyEventQuota==null?"illimité":`${p.monthlyEventQuota} évt.`})</option>)}</select><select value={subForm.status} onChange={e=>setSubForm({...subForm,status:e.target.value})}><option value="TRIALING">Essai</option><option value="ACTIVE">Actif</option><option value="PAST_DUE">Impayé</option><option value="CANCELLED">Résilié</option><option value="INCOMPLETE">Incomplet</option></select><button className="button small" disabled={actingOn===r.id} onClick={()=>saveSubscription(r.id)}>Enregistrer</button></div>}
        <p className="fine left">Notes internes : {r.adminNotes||"—"} <button type="button" className="link-button" onClick={()=>{setNotesFor(r.id);setNotes(r.adminNotes??"")}}>modifier</button></p>
        {notesFor===r.id&&<div className="time-row"><textarea value={notes} onChange={e=>setNotes(e.target.value)}/><button className="button small" disabled={actingOn===r.id} onClick={()=>saveNotes(r.id)}>Enregistrer</button></div>}
      </div>
      {r.status==="PENDING"&&<div className="decision-buttons">
      <button className="button" disabled={actingOn===r.id} onClick={()=>decide(r.id,true)}>Accepter</button>
      {reasonFor===r.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif (optionnel)"/><button className="button danger" disabled={actingOn===r.id} onClick={()=>decide(r.id,false,reason)}>Confirmer le refus</button></div>:<button className="button danger" onClick={()=>setReasonFor(r.id)}>Refuser</button>}
    </div>}</article>)}</div>}
  </div></section></Layout>;
}
