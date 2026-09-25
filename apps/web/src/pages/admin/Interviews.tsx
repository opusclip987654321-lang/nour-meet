import { Inbox, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Layout } from "../../components/Layout";
import { Avatar, Notice } from "../../components/ui";
import { CallCalendar } from "../../components/CallCalendar";
import { dateTime } from "../../lib/format";
import { APPLICATION_STATUS_LABEL } from "../../lib/labels";
import { AdminNav } from "./AdminNav";

export function AdminGlobalInterviews() {
  const [items,setItems]=useState<any[]|null>(null),[selected,setSelected]=useState<any>(null),[message,setMessage]=useState(""); const load=useCallback(()=>api<any[]>("/admin/global-interviews").then(v=>{setItems(v);setSelected((cur:any)=>cur?v.find(x=>x.id===cur.id):cur)}),[]);useEffect(()=>{load()},[load]);
  const decide=async(accept:boolean)=>{await api(`/admin/global-interviews/${selected.id}/decision`,{method:"POST",body:JSON.stringify({accept,notes:accept?undefined:"Profil non retenu pour le moment."})});setMessage(accept?"Profil validé.":"Profil non validé.");await load()};
  const revokeValidation=async()=>{await api(`/admin/profiles/${selected.user.id}/revoke-validation`,{method:"POST"});setMessage("Validation retirée.");await load()};
  const [rescheduling,setRescheduling]=useState(false),[schedulingId,setSchedulingId]=useState<string|null>(null),[error,setError]=useState("");
  const reschedule=async(startsAt:string)=>{setSchedulingId(startsAt);setError("");try{await api(`/admin/global-interviews/${selected.id}/reschedule`,{method:"POST",body:JSON.stringify({startsAt})});setMessage("Entretien reprogrammé.");setRescheduling(false);await load()}catch(err){setError((err as Error).message)}finally{setSchedulingId(null)}};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Entretiens de validation</h1><p className="fine">Un seul entretien global valide le profil d’un participant, indépendamment de tout événement.</p>{message&&<Notice kind="success">{message}</Notice>}<div className="applications-layout"><div className="panel table"><div className="table-row head"><span>Personne</span><span>Statut</span></div>{items===null?[0,1,2].map(i=><div key={i} className="table-row" aria-hidden="true"><span className="skeleton" style={{height:18}}/><span className="skeleton" style={{height:18}}/></div>):items.length===0?<div className="empty small"><p>Aucun entretien à traiter pour le moment.</p></div>:items.map(a=><button key={a.id} onClick={()=>{setSelected(a);setRescheduling(false)}} className={`table-row ${selected?.id===a.id?"selected":""}`}><span><b>{a.user.displayName}</b><small>{a.user.phone}</small></span><span>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</span></button>)}</div><aside className="panel candidate-detail">{selected?<><Avatar name={selected.user.displayName} photoUrl={selected.user.profile?.photoUrl} size="large" verified={!!selected.user.profile?.validatedAt}/><h2>{selected.user.displayName}</h2><p>{selected.user.profile?.profession} · {selected.user.profile?.city}</p><hr/><small>MOTIVATION</small><blockquote>{selected.motivation}</blockquote><small>Centres d’intérêt</small><div className="chips">{selected.user.profile?.interests.map((x:string)=><span key={x}>{x}</span>)}</div><small>ENTRETIEN</small><p>{selected.call?dateTime(selected.call.startsAt):"Aucun créneau réservé pour le moment"}</p>{!["ACCEPTED","REFUSED"].includes(selected.status)&&<div className="decision-buttons"><button className="button" onClick={()=>decide(true)}>Valider le profil</button><button className="button danger" onClick={()=>decide(false)}>Refuser</button></div>}{!!selected.user.profile?.validatedAt&&<button type="button" className="button secondary small" onClick={revokeValidation}>Retirer le badge Vérifié</button>}{selected.call&&!["ACCEPTED","REFUSED"].includes(selected.status)&&(rescheduling?<div className="stack">{error&&<Notice kind="error">{error}</Notice>}<CallCalendar title="Nouveau créneau" onSelect={reschedule} schedulingId={schedulingId} exclude={new Date(selected.call.startsAt).toISOString()}/><button type="button" className="button small secondary full" onClick={()=>setRescheduling(false)}>Annuler</button></div>:<button type="button" className="button small secondary full" onClick={()=>{setRescheduling(true);setError("")}}>Reprogrammer l’entretien</button>)}</>:<div className="empty"><h3>Sélectionnez un entretien</h3></div>}</aside></div></div></section></Layout>;
}

const WEEKDAYS=[[1,"Lun"],[2,"Mar"],[3,"Mer"],[4,"Jeu"],[5,"Ven"],[6,"Sam"],[0,"Dim"]] as const;
const emptyBlock={startDate:"",endDate:"",allDay:true,startTime:"10:00",endTime:"22:00",weekdays:[] as number[],reason:""};

// Agenda des entretiens (v2 §11) : ouvert par défaut tous les jours de 10h à 22h, par quarts d'heure.
// L'équipe ne crée plus de créneaux : elle ferme un créneau, des heures, un ou plusieurs jours, une
// période, ou certains jours de la semaine d'une période. Les rendez-vous déjà pris restent inchangés.
export function AdminAvailability() {
  const [blocks,setBlocks]=useState<any[]|null>(null);
  const [bookings,setBookings]=useState<any[]|null>(null);
  const [form,setForm]=useState(emptyBlock);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [saving,setSaving]=useState(false);

  const load=useCallback(()=>{
    api<any[]>("/admin/interview-blocks").then(setBlocks).catch(()=>setBlocks([]));
    api<any[]>("/admin/interview-slots").then(setBookings).catch(()=>setBookings([]));
  },[]);
  useEffect(()=>{load()},[load]);

  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(saving)return;setNotice(null);setSaving(true);
    try{
      const body={startDate:form.startDate,endDate:form.endDate||form.startDate,...(form.allDay?{}:{startTime:form.startTime,endTime:form.endTime}),...(form.weekdays.length?{weekdays:form.weekdays}:{}),...(form.reason.trim()?{reason:form.reason.trim()}:{})};
      const res=await api<{created:number;conflicts:{displayName:string;startsAt:string}[]}>("/admin/interview-blocks",{method:"POST",body:JSON.stringify(body)});
      setNotice(res.conflicts.length
        ?{kind:"error",text:`Période fermée. Attention : ${res.conflicts.length} entretien(s) déjà réservé(s) sur cette période sont maintenus — ${res.conflicts.map(c=>`${c.displayName} (${dateTime(c.startsAt)})`).join(", ")}. Reprogrammez-les depuis « Entretiens » si besoin.`}
        :{kind:"success",text:"Période fermée : plus aucun créneau n’y est proposé."});
      setForm(emptyBlock);load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSaving(false)}
  };
  const remove=async(id:string)=>{
    setNotice(null);
    try{await api(`/admin/interview-blocks/${id}`,{method:"DELETE"});setNotice({kind:"success",text:"Période rouverte."});load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const toggleWeekday=(d:number)=>setForm(f=>({...f,weekdays:f.weekdays.includes(d)?f.weekdays.filter(x=>x!==d):[...f.weekdays,d]}));
  const today=new Date().toISOString().slice(0,10);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Agenda des entretiens</h1><p className="fine">Ouvert par défaut tous les jours de 10h à 22h, par créneaux de 15 minutes. Fermez ici les périodes où personne ne peut appeler.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="availability-layout">
      <form className="panel availability-form" onSubmit={submit}>
        <div className="panel-title"><h2>Fermer une période</h2></div>
        <div className="time-row"><label>Du<input type="date" required min={today} value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value,endDate:form.endDate&&form.endDate<e.target.value?e.target.value:form.endDate})}/></label><label>Au (inclus)<input type="date" min={form.startDate||today} value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})} placeholder="Même jour"/></label></div>
        <label className="consent-check"><input type="checkbox" checked={form.allDay} onChange={e=>setForm({...form,allDay:e.target.checked})}/> <span>Journées entières</span></label>
        {!form.allDay&&<div className="time-row"><label>De<input type="time" step={900} required value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>À<input type="time" step={900} required value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label></div>}
        <fieldset className="weekday-picker"><legend>Seulement certains jours (facultatif)</legend><div>{WEEKDAYS.map(([d,label])=><button type="button" key={d} aria-pressed={form.weekdays.includes(d)} className={form.weekdays.includes(d)?"active":""} onClick={()=>toggleWeekday(d)}>{label}</button>)}</div></fieldset>
        <label>Motif interne (facultatif)<input maxLength={200} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="Congés, formation…"/></label>
        <button className="button full" disabled={saving}>{saving?"Enregistrement…":"Fermer cette période"}</button>
      </form>
      <div className="stack">
        <div className="panel availability-list">
          <div className="panel-title"><h2>Périodes fermées</h2><span>{blocks?.length??0}</span></div>
          {blocks===null?<div className="skeleton skeleton-panel" aria-hidden="true"/>
          :blocks.length===0?<div className="empty small"><Inbox size={24} aria-hidden="true"/><p>Aucune période fermée : tout le calendrier est ouvert.</p></div>
          :<ul className="block-list">{blocks.map(b=><li key={b.id}><span><b>{dateTime(b.startsAt)}</b> → {dateTime(b.endsAt)}{b.reason&&<small>{b.reason}</small>}</span><button type="button" className="icon-button" onClick={()=>remove(b.id)} aria-label="Rouvrir cette période"><X size={16} aria-hidden="true"/></button></li>)}</ul>}
        </div>
        <div className="panel availability-list">
          <div className="panel-title"><h2>Entretiens réservés</h2><span>{bookings?.length??0}</span></div>
          {bookings===null?<div className="skeleton skeleton-panel" aria-hidden="true"/>
          :bookings.length===0?<div className="empty small"><Inbox size={24} aria-hidden="true"/><p>Aucun entretien réservé.</p></div>
          :<ul className="block-list">{bookings.map(c=><li key={c.id}><span><b>{dateTime(c.startsAt)}</b>{c.application&&<small>{c.application.user.displayName}</small>}</span></li>)}</ul>}
        </div>
      </div>
    </div>
  </div></section></Layout>;
}
