import { Inbox } from "lucide-react";
import { EVENT_CATEGORIES } from "@nour/shared";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { Layout } from "../../components/Layout";
import { Loading, Notice } from "../../components/ui";
import { AdminNav } from "./AdminNav";

export function AdminOutbox() {
  const [items,setItems]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{api<any[]>("/admin/outbox").then(setItems).finally(()=>setLoading(false))},[]);
  const STATUS_LABEL:Record<string,string>={QUEUED:"En file d’attente",SENT:"Envoyé",FAILED:"Échec d’envoi"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Notifications SMS / e-mail</h1><p className="fine left">« Envoyé » signifie accepté par le fournisseur réel (Resend pour l’e-mail). Le SMS hors connexion reste simulé pour l’instant : il n’est jamais présenté comme envoyé.</p>
    {loading?<Loading/>:items.length===0?<div className="empty"><Inbox size={24} aria-hidden="true"/><h2>Aucun message pour le moment</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Destinataire</span><span>Message</span><span>Statut</span></div>
      {items.map(m=><div key={m.id} className="table-row"><span><b>{m.channel}</b><small>{m.recipient}</small></span><span>{m.subject&&<b>{m.subject} — </b>}{m.body}</span><span>{STATUS_LABEL[m.status]??m.status}{m.error&&<small className="fine left">{m.error}</small>}</span></div>)}
    </div>}
  </div></section></Layout>;
}

export function AdminSettings() {
  const [items,setItems]=useState<any[]>([]);
  const [editing,setEditing]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/settings").then(setItems);
  useEffect(()=>{load()},[]);

  const save=async(key:string)=>{
    setBusy(key);setNotice(null);
    const raw=editing[key];
    let value:unknown=raw;
    if(typeof items.find(i=>i.key===key)?.value==="boolean") value=raw==="true";
    else if(typeof items.find(i=>i.key===key)?.value==="number") value=Number(raw);
    try{await api(`/admin/settings/${key}`,{method:"PATCH",body:JSON.stringify({value})});setNotice({kind:"success",text:`${key} mis à jour.`});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Paramètres applicatifs</h1><p className="fine left">Valeurs provisoires du cahier des charges (verrou de paiement, quotas, drapeaux de fonction, contenu de la page « Le concept »…), modifiables ici sans redéploiement. Chaque modification est journalisée.</p>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="panel table">
      <div className="table-row head"><span>Paramètre</span><span>Valeur</span><span>Par défaut</span></div>
      {items.map(it=><div key={it.key} className="table-row settings-row"><span><b>{it.key}</b><small>{it.description}</small></span><span><input value={editing[it.key]??String(it.value)} onChange={e=>setEditing({...editing,[it.key]:e.target.value})}/></span><span><small className="fine">{String(it.default)}</small><button className="button small" disabled={busy===it.key} onClick={()=>save(it.key)}>Enregistrer</button></span></div>)}
    </div>
  </div></section></Layout>;
}

export function AdminTestimonials() {
  const [items,setItems]=useState<any[]>([]);
  const [form,setForm]=useState({displayName:"",eventType:"Speed dating",text:"",rating:5,status:"DRAFT" as "DRAFT"|"PUBLISHED",position:0});
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/testimonials").then(setItems);
  useEffect(()=>{load()},[]);

  const create=async(e:FormEvent)=>{
    e.preventDefault();setBusy("new");setNotice(null);
    try{await api("/admin/testimonials",{method:"POST",body:JSON.stringify(form)});setForm({displayName:"",eventType:"Speed dating",text:"",rating:5,status:"DRAFT",position:0});setNotice({kind:"success",text:"Témoignage créé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const toggleStatus=async(t:any)=>{
    setBusy(t.id);setNotice(null);
    try{await api(`/admin/testimonials/${t.id}`,{method:"PATCH",body:JSON.stringify({status:t.status==="PUBLISHED"?"DRAFT":"PUBLISHED"})});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const remove=async(id:string)=>{
    setBusy(id);setNotice(null);
    try{await api(`/admin/testimonials/${id}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Témoignages</h1><p className="fine left">Jamais publié automatiquement, même soumis par un participant : chaque témoignage reste en brouillon tant qu’il n’est pas explicitement publié ici.</p>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={create}>
      <div className="panel-title"><h2>Nouveau témoignage</h2></div>
      <label>Prénom ou pseudonyme<input required value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label>
      <label>Type d’événement<select value={form.eventType} onChange={e=>setForm({...form,eventType:e.target.value})}>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
      <label>Note (1 à 5, facultatif)<input type="number" min={1} max={5} value={form.rating} onChange={e=>setForm({...form,rating:Number(e.target.value)})}/></label>
      <label className="wide">Texte<textarea required minLength={10} value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/></label>
      <button className="button" disabled={busy==="new"}>Créer (en brouillon)</button>
    </form>
    <div className="stack">{items.map(t=><article key={t.id} className="panel restaurant-request"><div><h3>{t.displayName}</h3><p className="fine left">{t.eventType}{t.rating?` · ${t.rating}/5`:""}</p><p className="fine left">{t.text}</p><small>{t.status==="PUBLISHED"?"Publié":"Brouillon"}</small></div><div className="decision-buttons"><button className="button small" disabled={busy===t.id} onClick={()=>toggleStatus(t)}>{t.status==="PUBLISHED"?"Dépublier":"Publier"}</button><button className="button small danger" disabled={busy===t.id} onClick={()=>remove(t.id)}>Supprimer</button></div></article>)}</div>
  </div></section></Layout>;
}
