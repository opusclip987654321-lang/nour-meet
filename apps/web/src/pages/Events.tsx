import { EVENT_CATEGORIES } from "@nour/shared";
import type { Paginated, PublicEvent } from "@nour/shared";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { EventCard } from "../components/ui";

export function Events() {
  const [searchParams]=useSearchParams();
  // §5 (cahier des charges 2026-09) : permet au blog (et à tout autre lien externe) de renvoyer
  // directement vers les événements d'une catégorie précise, ex. /events?category=Speed%20dating.
  const [events,setEvents]=useState<PublicEvent[]>([]),[q,setQ]=useState(""),[category,setCategory]=useState(searchParams.get("category")??"");
  useEffect(()=>{api<Paginated<PublicEvent>>(`/events?${new URLSearchParams({...(q?{q}:{}),...(category?{category}:{})})}`).then(r=>setEvents(r.items))},[q,category]);
  return <Layout><section className="page"><span className="eyebrow">CALENDRIER</span><h1>Trouvez la rencontre qui vous ressemble.</h1><div className="filters"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher un événement"/><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Toutes les catégories</option>{EVENT_CATEGORIES.map(c=><option key={c.name}>{c.name}</option>)}</select></div>{events.length?<div className="event-grid">{events.map(e=><EventCard key={e.id} event={e}/>)}</div>:<div className="empty"><span>◇</span><h2>Aucun événement disponible</h2><p>Modifiez vos filtres ou revenez prochainement.</p></div>}</section></Layout>;
}
