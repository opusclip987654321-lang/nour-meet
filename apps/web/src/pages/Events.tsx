import { EVENT_CATEGORIES } from "@nour/shared";
import type { Paginated, PublicEvent } from "@nour/shared";
import { CalendarDays, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { EventCard } from "../components/ui";

export function Events() {
  const [searchParams,setSearchParams]=useSearchParams();
  // §5 (cahier des charges 2026-09) : permet au blog (et à tout autre lien externe) de renvoyer
  // directement vers les événements d'une catégorie précise, ex. /events?category=Speed%20dating.
  const category=searchParams.get("category")??"";
  const [q,setQ]=useState("");
  const [debouncedQ,setDebouncedQ]=useState("");
  const [events,setEvents]=useState<PublicEvent[]|null>(null);
  const [page,setPage]=useState(1);
  const [totalPages,setTotalPages]=useState(1);
  const [total,setTotal]=useState(0);
  const [loadingMore,setLoadingMore]=useState(false);
  // Recherche : une requête après 300 ms sans frappe, jamais une requête par caractère saisi.
  useEffect(()=>{const t=setTimeout(()=>setDebouncedQ(q.trim()),300);return()=>clearTimeout(t)},[q]);
  // L'API ne renvoie que les soirées à venir, déjà triées de la plus proche à la plus éloignée (§5.1) :
  // les pages suivantes s'ajoutent à la suite, jamais retriées côté navigateur sur une date formatée.
  const query=(p:number)=>`/events?${new URLSearchParams({...(debouncedQ?{q:debouncedQ}:{}),...(category?{category}:{}),page:String(p),pageSize:"24"})}`;
  useEffect(()=>{
    let ignore=false;
    setPage(1);
    api<Paginated<PublicEvent>>(query(1))
      .then(r=>{if(!ignore){setEvents(r.items);setTotalPages(r.totalPages);setTotal(r.total)}}).catch(()=>{if(!ignore)setEvents([])});
    return()=>{ignore=true};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query dérive de ces deux valeurs
  },[debouncedQ,category]);
  const loadMore=async()=>{
    setLoadingMore(true);
    try{const r=await api<Paginated<PublicEvent>>(query(page+1));setEvents(prev=>[...(prev??[]),...r.items]);setPage(page+1);setTotalPages(r.totalPages)}
    catch{/* le bouton reste disponible pour réessayer */}
    finally{setLoadingMore(false)}
  };
  const setCategory=(c:string)=>{const next=new URLSearchParams(searchParams);if(c)next.set("category",c);else next.delete("category");setSearchParams(next,{replace:true})};
  return <Layout><section className="page">
    <h1>Les prochaines soirées</h1>
    <p className="page-lead">Speed dating sur sélection ou networking en accès direct, dans des restaurants partenaires à Paris et en Île-de-France. Chaque fiche indique le lieu, l’organisateur, le prix et ce qui est compris.</p>
    <div className="filters" role="search">
      <label className="search-field"><span className="visually-hidden">Rechercher une soirée</span><Search size={18} aria-hidden="true"/><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher par nom ou quartier"/></label>
      <div className="chip-toggle" role="group" aria-label="Filtrer par format">
        <button type="button" className={`chip${category===""?" active":""}`} aria-pressed={category===""} onClick={()=>setCategory("")}>Toutes</button>
        {EVENT_CATEGORIES.map(c=><button key={c.name} type="button" className={`chip${category===c.name?" active":""}`} aria-pressed={category===c.name} onClick={()=>setCategory(c.name)}>{c.name}</button>)}
      </div>
    </div>
    {events===null
      ?<div className="event-grid" aria-busy="true">{[0,1,2].map(i=><div key={i} className="event-card skeleton-card"><div className="skeleton" style={{aspectRatio:"4 / 3"}}/><div className="event-copy"><div className="skeleton" style={{height:18,width:"50%"}}/><div className="skeleton" style={{height:26,width:"85%"}}/></div></div>)}</div>
      :events.length
        ?<><p className="results-count" aria-live="polite">{total} soirée{total>1?"s":""} à venir</p><div className="event-grid">{events.map((e,i)=><EventCard key={e.id} event={e} priority={i<3} headingLevel={2}/>)}</div>{page<totalPages&&<div className="load-more"><button type="button" className="button secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore?"Chargement…":"Afficher plus de soirées"}</button></div>}</>
        :<div className="empty"><CalendarDays size={24} aria-hidden="true"/><h2>Aucune soirée ne correspond</h2><p>Essayez un autre mot-clé ou un autre format — de nouvelles dates sont publiées régulièrement.</p></div>}
  </section></Layout>;
}
