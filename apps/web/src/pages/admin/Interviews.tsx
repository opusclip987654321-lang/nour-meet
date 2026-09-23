import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Layout } from "../../components/Layout";
import { Avatar, Notice } from "../../components/ui";
import { dateTime, timeLabel } from "../../lib/format";
import { APPLICATION_STATUS_LABEL } from "../../lib/labels";
import { AdminNav } from "./AdminNav";

export function AdminGlobalInterviews() {
  const [items,setItems]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[message,setMessage]=useState(""); const load=()=>api<any[]>("/admin/global-interviews").then(v=>{setItems(v);if(selected)setSelected(v.find(x=>x.id===selected.id))});useEffect(()=>{load()},[]);
  const decide=async(accept:boolean)=>{await api(`/admin/global-interviews/${selected.id}/decision`,{method:"POST",body:JSON.stringify({accept,notes:accept?undefined:"Profil non retenu pour le moment."})});setMessage(accept?"Profil validé.":"Profil non validé.");await load()};
  const revokeValidation=async()=>{await api(`/admin/profiles/${selected.user.id}/revoke-validation`,{method:"POST"});setMessage("Validation retirée.");await load()};
  const [rescheduling,setRescheduling]=useState(false),[slots,setSlots]=useState<any[]>([]);
  const openReschedule=async()=>{setSlots(await api<any[]>("/interview-slots"));setRescheduling(true)};
  const reschedule=async(slotId:string)=>{await api(`/admin/global-interviews/${selected.id}/reschedule`,{method:"POST",body:JSON.stringify({slotId})});setMessage("Entretien reprogrammé.");setRescheduling(false);await load()};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Entretiens de validation</h1><p className="fine">Un seul entretien global valide le profil d’un participant, indépendamment de tout événement.</p>{message&&<Notice kind="success">{message}</Notice>}<div className="applications-layout"><div className="panel table"><div className="table-row head"><span>Personne</span><span>Statut</span></div>{items.map(a=><button key={a.id} onClick={()=>{setSelected(a);setRescheduling(false)}} className={`table-row ${selected?.id===a.id?"selected":""}`}><span><b>{a.user.displayName}</b><small>{a.user.phone}</small></span><span>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</span></button>)}</div><aside className="panel candidate-detail">{selected?<><Avatar name={selected.user.displayName} photoUrl={selected.user.profile?.photoUrl} size="large" verified={!!selected.user.profile?.validatedAt}/><h2>{selected.user.displayName}</h2><p>{selected.user.profile?.profession} · {selected.user.profile?.city}</p><hr/><small>MOTIVATION</small><blockquote>{selected.motivation}</blockquote><small>CENTRES D’INTÉRÊT</small><div className="chips">{selected.user.profile?.interests.map((x:string)=><span key={x}>{x}</span>)}</div><small>ENTRETIEN</small><p>{selected.call?dateTime(selected.call.startsAt):"Aucun créneau réservé pour le moment"}</p>{!["ACCEPTED","REFUSED"].includes(selected.status)&&<div className="decision-buttons"><button className="button" onClick={()=>decide(true)}>Valider le profil</button><button className="button danger" onClick={()=>decide(false)}>Refuser</button></div>}{!!selected.user.profile?.validatedAt&&<button type="button" className="button secondary small" onClick={revokeValidation}>Retirer le badge Vérifié</button>}{selected.call&&!["ACCEPTED","REFUSED"].includes(selected.status)&&(rescheduling?<div className="stack">{slots.length===0?<p className="fine left">Aucun créneau disponible pour le moment.</p>:slots.map((s:any)=><button key={s.id} type="button" className="button small secondary full" onClick={()=>reschedule(s.id)}>{dateTime(s.startsAt)}</button>)}<button type="button" className="button small secondary full" onClick={()=>setRescheduling(false)}>Annuler</button></div>:<button type="button" className="button small secondary full" onClick={openReschedule}>Reprogrammer l’entretien</button>)}</>:<div className="empty"><h3>Sélectionnez un entretien</h3></div>}</aside></div></div></section></Layout>;
}

export function AdminAvailability() {
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [form,setForm]=useState({date:"",startTime:"18:00",endTime:"20:00",durationMinutes:20});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [generating,setGenerating]=useState(false);

  const loadSlots=()=>{setLoadingSlots(true);api<any[]>("/admin/interview-slots").then(setSlots).catch(()=>setSlots([])).finally(()=>setLoadingSlots(false))};
  useEffect(()=>{loadSlots()},[]);

  const generate=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    if(!form.date){setNotice({kind:"error",text:"Choisissez une date"});return}
    setGenerating(true);
    try{
      const res=await api<{created:number;skipped:number}>("/admin/interview-slots/generate",{method:"POST",body:JSON.stringify(form)});
      setNotice({kind:"success",text:`${res.created} créneau(x) ajouté(s)${res.skipped?`, ${res.skipped} déjà existant(s) ignoré(s)`:""}.`});
      loadSlots();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setGenerating(false)}
  };
  const remove=async(slotId:string)=>{
    setNotice(null);
    try{await api(`/admin/interview-slots/${slotId}`,{method:"DELETE"});loadSlots()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const byDay=useMemo(()=>{
    const map=new Map<string,any[]>();
    for(const s of slots){const key=new Date(s.startsAt).toDateString();if(!map.has(key))map.set(key,[]);map.get(key)!.push(s)}
    return map;
  },[slots]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Agenda des entretiens</h1><p className="fine">Un seul agenda pour toute la plateforme : un seul entretien possible à la fois.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="availability-layout">
      <form className="panel availability-form" onSubmit={generate}>
        <div className="panel-title"><h2>Ajouter des créneaux</h2></div>
        <label>Date<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
        <div className="time-row"><label>Début<input type="time" required value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>Fin<input type="time" required value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label></div>
        <label>Durée par entretien (minutes)<input type="number" min={5} max={180} required value={form.durationMinutes} onChange={e=>setForm({...form,durationMinutes:Number(e.target.value)})}/></label>
        <button className="button full" disabled={generating}>{generating?"Génération…":"Générer les créneaux"}</button>
      </form>
      <div className="panel availability-list">
        <div className="panel-title"><h2>Créneaux existants</h2><span>{slots.length} créneau(x)</span></div>
        {loadingSlots?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
        :slots.length===0?<div className="empty small"><span>◇</span><p>Aucun créneau créé.</p></div>
        :<div className="stack">{[...byDay.entries()].map(([day,daySlots])=><div key={day} className="availability-day"><small>{new Date(day).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}</small><div className="slot-chip-grid">{daySlots.map(s=><div key={s.id} className={`slot-chip ${s.application?"booked":""}`}><span>{timeLabel(s.startsAt)}</span>{s.application?<small>{s.application.user.displayName}</small>:<button type="button" onClick={()=>remove(s.id)} aria-label="Supprimer le créneau">×</button>}</div>)}</div></div>)}</div>}
      </div>
    </div>
  </div></section></Layout>;
}
