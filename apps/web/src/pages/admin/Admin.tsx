import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { EVENT_CATEGORIES } from "@nour/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { Loading } from "../../components/ui";
import { money } from "../../lib/format";
import { EVENT_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL } from "../../lib/labels";
import { AdminNav, Stat } from "./AdminNav";

const emptyDashboardFilters={eventId:"",category:"",status:"",city:"",minAge:"",maxAge:""};
export function Admin() {
  const {user}=useAuth();
  const showStats = user?.role==="ADMIN"||user?.role==="ORGANIZER";
  const [periodDays,setPeriodDays]=useState(30);
  const [filters,setFilters]=useState(emptyDashboardFilters);
  const [showFilters,setShowFilters]=useState(false);
  const [events,setEvents]=useState<any[]>([]);
  useEffect(()=>{if(showStats)api<any[]>("/admin/events").then(setEvents).catch(()=>{})},[showStats]);
  const [stats,setStats]=useState<any>(null);
  useEffect(()=>{
    if(!showStats)return;
    const params=new URLSearchParams({since:new Date(Date.now()-periodDays*86_400_000).toISOString()});
    if(filters.eventId)params.set("eventId",filters.eventId);
    if(filters.category)params.set("category",filters.category);
    if(filters.status)params.set("status",filters.status);
    if(filters.city)params.set("city",filters.city);
    if(filters.minAge)params.set("minAge",filters.minAge);
    if(filters.maxAge)params.set("maxAge",filters.maxAge);
    api(`/admin/dashboard?${params}`).then(setStats);
  },[showStats,periodDays,filters]);
  if(!showStats) return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Bienvenue, {user?.displayName}</h1><p className="fine">{user?.role==="MODERATOR"?"Utilisez le menu pour traiter les signalements.":"Utilisez le menu pour scanner les billets de l’établissement."}</p></div></section></Layout>;
  const SUBSCRIPTION_STATUS_LABEL:Record<string,string>={TRIALING:"Essai",ACTIVE:"Actifs",PAST_DUE:"Impayés",CANCELLED:"Résiliés",INCOMPLETE:"Incomplets"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><div className="admin-heading"><div><h1>Tableau de bord {user?.role==="ADMIN"?"général":"de mon établissement"}</h1></div><select aria-label="Période" value={periodDays} onChange={e=>setPeriodDays(Number(e.target.value))}><option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option></select></div>
  {/* Mobile : filtres repliés derrière un bouton, pour que les chiffres restent visibles. */}
  <button type="button" className="button secondary small filters-toggle" aria-expanded={showFilters} onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={16} aria-hidden="true"/>Filtres{JSON.stringify(filters)!==JSON.stringify(emptyDashboardFilters)?" (actifs)":""}</button>
  <div className={`filters admin-filters${showFilters?" open":""}`}>
    <select aria-label="Événement" value={filters.eventId} onChange={e=>setFilters({...filters,eventId:e.target.value})}><option value="">Tous les événements</option>{events.map((ev:any)=><option key={ev.id} value={ev.id}>{ev.title}</option>)}</select>
    <select aria-label="Catégorie" value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="">Toutes les catégories</option>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select>
    <select aria-label="Statut" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Tous statuts</option>{Object.entries(EVENT_STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
    <input aria-label="Ville" value={filters.city} onChange={e=>setFilters({...filters,city:e.target.value})} placeholder="Ville"/>
    <input aria-label="Âge minimum" type="number" min={0} value={filters.minAge} onChange={e=>setFilters({...filters,minAge:e.target.value})} placeholder="Âge min"/>
    <input aria-label="Âge maximum" type="number" min={0} value={filters.maxAge} onChange={e=>setFilters({...filters,maxAge:e.target.value})} placeholder="Âge max"/>
    {JSON.stringify(filters)!==JSON.stringify(emptyDashboardFilters)&&<button type="button" className="button small secondary" onClick={()=>setFilters(emptyDashboardFilters)}>Réinitialiser</button>}
  </div>
  {!stats?<Loading/>:<><div className="stat-grid">
    <Stat label={`Candidatures (${periodDays} jours)`} value={stats.applications}/>
    {stats.acceptanceRate!=null&&<Stat label="Taux d’acceptation (entretien)" value={`${stats.acceptanceRate}%`}/>}
    <Stat label="Événements à venir" value={stats.upcomingEvents}/>
    <Stat label="Événements au total" value={stats.events}/>
    <Stat label="Places restantes" value={stats.remainingSpots}/>
    <Stat label="Billets vendus (30j)" value={stats.ticketsSold}/>
    <Stat label="Sur liste d’attente" value={stats.waitlisted}/>
    <Stat label="Revenus (30j)" value={money(stats.revenueCents)}/>
    {stats.openReports!=null&&<Stat label="Signalements ouverts" value={stats.openReports}/>}
    {stats.pendingInterviews!=null&&<Stat label="Entretiens en attente" value={stats.pendingInterviews}/>}
    {stats.upcomingInterviews!=null&&<Stat label="Entretiens à venir" value={stats.upcomingInterviews}/>}
    {stats.pendingRestaurantApplications!=null&&<Stat label="Demandes restaurateurs" value={stats.pendingRestaurantApplications}/>}
    {stats.pendingPayments!=null&&<Stat label="Paiements en attente" value={stats.pendingPayments}/>}
    {stats.failedPayments!=null&&<Stat label="Paiements échoués" value={stats.failedPayments}/>}
    {stats.shareClicks!=null&&<Stat label="Clics de partage" value={stats.shareClicks}/>}
    {stats.shareAttributedApplications!=null&&<Stat label="Inscriptions attribuées" value={stats.shareAttributedApplications}/>}
    {stats.shareAttributedPurchases!=null&&<Stat label="Ventes attribuées" value={stats.shareAttributedPurchases}/>}
    {stats.subscriptionsByStatus?.map((s:any)=><Stat key={s.status} label={`Abonnements ${SUBSCRIPTION_STATUS_LABEL[s.status]??s.status}`} value={s.count}/>)}
  </div><div className="admin-grid"><div className="panel chart"><div className="panel-title"><h2>Activité sur 30 jours</h2><span>Données de démonstration</span></div><div className="bars">{[32,50,42,68,60,82,75,94,70,85,97,88].map((n,i)=><i key={i} style={{height:`${n}%`}}/>)}</div></div><div className="panel quick"><h2>Actions rapides</h2>{user?.role==="ADMIN"&&<Link to="/admin/applications">Traiter les entretiens <ArrowRight size={18} aria-hidden="true"/></Link>}<Link to="/admin/attendees">Voir les participants <ArrowRight size={18} aria-hidden="true"/></Link><Link to="/admin/scanner">Scanner un billet <ArrowRight size={18} aria-hidden="true"/></Link>{user?.role==="ADMIN"&&<Link to="/admin/restaurants">Demandes restaurateurs <ArrowRight size={18} aria-hidden="true"/></Link>}{user?.role==="ADMIN"&&<Link to="/admin/finance">Voir les finances <ArrowRight size={18} aria-hidden="true"/></Link>}<Link to="/events">Voir les événements <ArrowRight size={18} aria-hidden="true"/></Link></div></div></>}</div></section></Layout>;
}
