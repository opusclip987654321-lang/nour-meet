import { Inbox } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { Notice } from "../../components/ui";
import { dateTime } from "../../lib/format";
import { AdminNav } from "./AdminNav";

export function AdminStaff() {
  const [items,setItems]=useState<any[]>([]);
  const [form,setForm]=useState({phone:"",displayName:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const load=()=>api<any[]>("/admin/staff").then(setItems).catch(()=>setItems([]));
  useEffect(()=>{load()},[]);
  const add=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{await api("/admin/staff",{method:"POST",body:JSON.stringify(form)});setForm({phone:"",displayName:""});setNotice({kind:"success",text:"Accès accueil activé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const revoke=async(id:string)=>{
    setBusy(true);setNotice(null);
    try{await api(`/admin/staff/${id}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Personnel d’accueil</h1><p className="fine">Ces comptes peuvent uniquement scanner les billets de votre établissement. Ils n’ont accès à aucune candidature, aucun client ni aucune donnée financière.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={add}>
      <label>Téléphone<input required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+33612345678"/></label>
      <label>Nom<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="Prénom Nom"/></label>
      <button className="button" disabled={busy}>{busy?"…":"Donner l’accès accueil"}</button>
    </form>
    {items.length===0?<div className="empty small"><Inbox size={24} aria-hidden="true"/><p>Aucun personnel d’accueil pour le moment.</p></div>:<div className="stack">{items.map(s=><article key={s.id} className="panel restaurant-request"><div><h3>{s.displayName}</h3><p>{s.phone}</p></div><button className="button danger" disabled={busy} onClick={()=>revoke(s.id)}>Retirer l’accès</button></article>)}</div>}
  </div></section></Layout>;
}

export function AdminModeration() {
  const {user}=useAuth();
  const [items,setItems]=useState<any[]>([]);
  const [mods,setMods]=useState<any[]>([]);
  const [modForm,setModForm]=useState({phone:"",displayName:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [busyId,setBusyId]=useState<string|null>(null);
  const load=()=>api<any[]>("/admin/reports").then(setItems);
  const loadMods=()=>api<any[]>("/admin/moderators").then(setMods);
  useEffect(()=>{load();if(user?.role==="ADMIN")loadMods()},[user?.role]);
  const decide=async(id:string,status:string)=>{
    setBusyId(id);setNotice(null);
    try{await api(`/admin/reports/${id}/decision`,{method:"POST",body:JSON.stringify({status})});setNotice({kind:"success",text:"Signalement mis à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const addMod=async(e:FormEvent)=>{
    e.preventDefault();setBusyId("mod");setNotice(null);
    try{await api("/admin/moderators",{method:"POST",body:JSON.stringify(modForm)});setModForm({phone:"",displayName:""});await loadMods()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const revokeMod=async(id:string)=>{
    setBusyId(id);setNotice(null);
    try{await api(`/admin/moderators/${id}`,{method:"DELETE"});await loadMods()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const STATUS_LABEL:Record<string,string>={OPEN:"Ouvert",REVIEWING:"En cours d’examen",RESOLVED:"Résolu",DISMISSED:"Classé sans suite"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Signalements</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {user?.role==="ADMIN"&&<div className="panel form-grid"><div className="panel-title"><h2>Modérateurs</h2><span>Personnes autorisées à traiter les signalements</span></div>
      {mods.length>0&&<div className="stack">{mods.map(m=><div key={m.id} className="table-row"><span><b>{m.displayName}</b> · {m.phone}</span><button type="button" className="button danger small" disabled={busyId===m.id} onClick={()=>revokeMod(m.id)}>Retirer</button></div>)}</div>}
      <form className="time-row wide" onSubmit={addMod}><input required placeholder="+33612345678" value={modForm.phone} onChange={e=>setModForm({...modForm,phone:e.target.value})}/><input placeholder="Nom" value={modForm.displayName} onChange={e=>setModForm({...modForm,displayName:e.target.value})}/><button className="button" disabled={busyId==="mod"}>Nommer modérateur</button></form>
    </div>}
    {items.length===0?<div className="empty"><Inbox size={24} aria-hidden="true"/><h2>Aucun signalement</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request"><div><h3>{r.reporter.displayName} → {r.reported.displayName}</h3><p>{r.reason}</p>{r.details&&<p className="fine left">{r.details}</p>}<small>{STATUS_LABEL[r.status]??r.status} · {dateTime(r.createdAt)}</small></div>{!["RESOLVED","DISMISSED"].includes(r.status)&&<div className="decision-buttons"><button className="button" disabled={busyId===r.id} onClick={()=>decide(r.id,"REVIEWING")}>Commencer l’examen</button><button className="button" disabled={busyId===r.id} onClick={()=>decide(r.id,"RESOLVED")}>Résoudre</button><button className="button danger" disabled={busyId===r.id} onClick={()=>decide(r.id,"DISMISSED")}>Classer</button></div>}</article>)}</div>}
  </div></section></Layout>;
}
