import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { SUBSCRIPTION_STATUS_LABEL } from "../../lib/labels";
import { Layout } from "../../components/Layout";
import { Notice } from "../../components/ui";
import { imgUrl, money } from "../../lib/format";
import { RESTAURANT_STATUS_LABEL, RESTAURANT_VALIDATION } from "../../lib/labels";
import { DataTable, FilterTabs, type Column } from "../../components/DataTable";
import { Search } from "lucide-react";
import { AdminNav } from "./AdminNav";
import { SubscriptionSummary, type SubscriptionOverview } from "../RestaurantSubscription";

export function AdminRestaurants() {
  // null = en cours de chargement (squelette), [] = réellement vide : jamais d'état vide affiché
  // avant l'arrivée des données.
  const [items,setItems]=useState<any[]|null>(null);
  const [plans,setPlans]=useState<any[]|null>(null);
  const [filter,setFilter]=useState<"PENDING"|"APPROVED"|"REJECTED"|"SUSPENDED">("PENDING");
  const [q,setQ]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [actingOn,setActingOn]=useState<string|null>(null);
  const [reasonFor,setReasonFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [notesFor,setNotesFor]=useState<string|null>(null);
  const [notes,setNotes]=useState("");
  // Abonnement d'un restaurateur : consultation seule (décision du 2026-09-25), même lecture que
  // l'espace restaurateur (GET /admin/restaurants/:id/subscription → subscriptionOverview).
  const [subFor,setSubFor]=useState<string|null>(null);
  const [subOverview,setSubOverview]=useState<SubscriptionOverview|null>(null);
  const showSubscription=async(id:string)=>{
    if(subFor===id){setSubFor(null);return}
    setSubFor(id);setSubOverview(null);
    try{setSubOverview(await api<SubscriptionOverview>(`/admin/restaurants/${id}/subscription`))}
    catch(err){setNotice({kind:"error",text:(err as Error).message});setSubFor(null)}
  };
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [planEdits,setPlanEdits]=useState<Record<string,{monthlyPriceCents:string;monthlyEventQuota:string}>>({});
  const [newPlan,setNewPlan]=useState({name:"",monthlyPriceCents:"",monthlyEventQuota:""});
  // Tous les établissements d'un coup : les onglets affichent leur compteur sans nouvel appel.
  const load=useCallback(()=>api<any[]>("/admin/restaurants").then(setItems),[]);
  const loadPlans=useCallback(()=>api<any[]>("/admin/plans").then(v=>{setPlans(v);setPlanEdits(Object.fromEntries(v.map(p=>[p.id,{monthlyPriceCents:String(p.monthlyPriceCents/100),monthlyEventQuota:p.monthlyEventQuota==null?"":String(p.monthlyEventQuota)}])))}),[]);
  useEffect(()=>{load();loadPlans().catch(()=>{})},[load,loadPlans]);
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
    try{await api(`/admin/restaurants/${id}/decision`,{method:"POST",body:JSON.stringify({accept,reason:rejectReason})});setNotice({kind:"success",text:accept?"Restaurateur approuvé.":"Demande refusée."});setReasonFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const saveNotes=async(id:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/notes`,{method:"PATCH",body:JSON.stringify({adminNotes:notes})});setNotice({kind:"success",text:"Notes internes enregistrées."});setNotesFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const counts=(status:string)=>(items??[]).filter(r=>r.status===status).length;
  const query=q.trim().toLowerCase();
  const rows=items===null?null:items.filter(r=>r.status===filter).filter(r=>!query||[r.name,r.owner?.displayName,r.district,r.siret].some((t:string|undefined)=>t?.toLowerCase().includes(query)));
  const detail=(r:any)=><article className="panel restaurant-request">
      <div>
        <h3>{r.name}</h3>
        <p>{r.owner.displayName} · {(r.phone||r.owner.phone)?<a href={`tel:${r.phone||r.owner.phone}`}>{r.phone||r.owner.phone}</a>:(r.owner.email??"coordonnées non renseignées")}{r.owner.email?<> · <a href={`mailto:${r.owner.email}`}>Contacter par e-mail</a></>:null}</p>
        <p className="fine left">Responsable : {r.managerName??"—"} · SIRET {r.siret??"—"}</p>
        {r.district&&<p className="fine left">{r.address}, {r.district}</p>}
        {r.description&&<p className="fine left">{r.description}</p>}
        <p className="fine left">Places souhaitées : {r.desiredCapacity??"—"} · Créneaux : {r.desiredSchedule??"—"} · Prix moyen/pers. : {r.averagePricePerPersonCents!=null?money(r.averagePricePerPersonCents):"—"} · Minimum habituel : {r.defaultMinParticipants??"—"}</p>
        <p className="fine left">Inclus : {[r.priceIncludesDrink&&"boisson",r.priceIncludesStarter&&"entrée",r.priceIncludesMain&&"plat",r.priceIncludesDessert&&"dessert"].filter(Boolean).join(", ")||"—"}{r.proposesCategoryPricing?" · tarifs par catégorie proposés":""}{r.allowsPrivatization?" · privatisation possible":""}</p>
        {r.specialConditions&&<p className="fine left">Conditions particulières : {r.specialConditions}</p>}
        {r.photos?.length>0&&<div className="event-photo-grid">{r.photos.map((p:any)=><img key={p.id} src={imgUrl(p.url)} alt="" style={{height:100,borderRadius:8,objectFit:"cover"}}/>)}</div>}
        <small>{RESTAURANT_STATUS_LABEL[r.status]}</small>
        {r.status==="APPROVED"&&<p className="fine left">Abonnement : {r.subscription?`${r.subscription.plan.name} — ${SUBSCRIPTION_STATUS_LABEL[r.subscription.status]??r.subscription.status}`:"aucun"} <button type="button" className="link-button" aria-expanded={subFor===r.id} onClick={()=>showSubscription(r.id)}>{subFor===r.id?"masquer":"consulter"}</button></p>}
        {subFor===r.id&&<div className="panel admin-subscription">{subOverview?<SubscriptionSummary overview={subOverview}/>:<div className="skeleton skeleton-panel"/>}<p className="fine left">Consultation seule : le restaurateur gère son abonnement depuis son espace.</p></div>}
        <p className="fine left">Notes internes : {r.adminNotes||"—"} <button type="button" className="link-button" onClick={()=>{setNotesFor(r.id);setNotes(r.adminNotes??"")}}>modifier</button></p>
        {notesFor===r.id&&<div className="time-row"><textarea value={notes} onChange={e=>setNotes(e.target.value)}/><button className="button small" disabled={actingOn===r.id} onClick={()=>saveNotes(r.id)}>Enregistrer</button></div>}
      </div>
      {r.status==="PENDING"&&<div className="decision-buttons">
      {!(r.photos?.length>0)&&<p className="fine left">Aucune photo de l’établissement : l’approbation reste impossible tant que le restaurateur n’en a pas ajouté au moins une.</p>}<button className="button" disabled={actingOn===r.id||!(r.photos?.length>0)} onClick={()=>decide(r.id,true)}>Accepter</button>
      {reasonFor===r.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif (optionnel)"/><button className="button danger" disabled={actingOn===r.id} onClick={()=>decide(r.id,false,reason)}>Confirmer le refus</button></div>:<button className="button danger" onClick={()=>setReasonFor(r.id)}>Refuser</button>}
    </div>}</article>;
  const columns:Column<any>[]=[
    {key:"name",header:"Établissement",primary:true,render:r=><span className="cell-main"><b>{r.name}</b><small>{r.district??"—"}</small></span>},
    {key:"owner",header:"Contact",render:r=><span className="cell-main"><span>{r.owner.displayName}</span><small>{r.phone||r.owner.phone||r.owner.email||"—"}</small></span>},
    {key:"subscription",header:"Abonnement",render:r=>r.subscription?`${r.subscription.plan.name} · ${SUBSCRIPTION_STATUS_LABEL[r.subscription.status]??r.subscription.status}`:"Aucun"},
    {key:"photos",header:"Photos",numeric:true,render:r=>r.photos?.length??0},
    {key:"date",header:"Demande reçue",render:r=>r.submittedAt?new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric"}).format(new Date(r.submittedAt)):"—"},
    {key:"status",header:"Statut",render:r=>{const v=RESTAURANT_VALIDATION[r.status];return <span className={`badge ${v?.tone??"neutral"}`}>{RESTAURANT_STATUS_LABEL[r.status]??r.status}</span>}},
    {key:"actions",header:"Actions",render:r=><span className="cell-actions"><button type="button" className="button small secondary" aria-expanded={selected===r.id} onClick={e=>{e.stopPropagation();setSelected(selected===r.id?null:r.id)}}>{selected===r.id?"Fermer":r.status==="PENDING"?"Examiner":"Détails"}</button></span>}
  ];
  const current=(items??[]).find(r=>r.id===selected&&r.status===filter);
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Restaurateurs</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <FilterTabs label="Filtrer les restaurateurs" value={filter} onChange={v=>{setFilter(v);setSelected(null)}} options={[{value:"PENDING",label:"À examiner",count:items===null?undefined:counts("PENDING")},{value:"APPROVED",label:"Validés",count:items===null?undefined:counts("APPROVED")},{value:"REJECTED",label:"Refusés",count:items===null?undefined:counts("REJECTED")},{value:"SUSPENDED",label:"Suspendus",count:items===null?undefined:counts("SUSPENDED")}]}/>
    <div className="table-toolbar"><label className="search-field"><span className="visually-hidden">Rechercher un restaurateur</span><Search size={18} aria-hidden="true"/><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher : nom, responsable, quartier, SIRET…"/></label></div>
    <DataTable caption="Restaurateurs" rows={rows} columns={columns} rowKey={r=>r.id} selectedKey={selected} onRowClick={r=>setSelected(selected===r.id?null:r.id)} empty={filter==="PENDING"?"Aucune demande à examiner.":"Aucun établissement dans cette liste."}/>
    {current&&<div className="restaurant-detail">{detail(current)}</div>}
    <details className="panel plans-details">
      <summary><h2>Formules d’abonnement</h2><span className="fine">Prix HT · quota vide = illimité</span></summary>
    <div>
      <p className="fine left">Le prix annuel se fixe séparément (2 mois offerts).</p>
      <div className="stack">{plans===null&&[0,1].map(i=><div key={i} className="skeleton" style={{height:76}}/>)}{(plans??[]).map(p=><div key={p.id} className="time-row" style={{alignItems:"center"}}>
        <span>{p.name}{!p.active&&" (désactivée)"}</span>
        <label>€/mois<input type="number" min={0} step="1" value={planEdits[p.id]?.monthlyPriceCents??""} onChange={e=>setPlanEdits({...planEdits,[p.id]:{...planEdits[p.id],monthlyPriceCents:e.target.value}})}/></label>
        <label>Quota mensuel (vide=illimité)<input type="number" min={1} placeholder="illimité" value={planEdits[p.id]?.monthlyEventQuota??""} onChange={e=>setPlanEdits({...planEdits,[p.id]:{...planEdits[p.id],monthlyEventQuota:e.target.value}})}/></label>
        <small className="fine">Annuel : {p.annualPriceCents!=null?`${(p.annualPriceCents/100).toFixed(0)} €/an`:"non proposé"}</small>
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
    </details>
  </div></section></Layout>;
}
