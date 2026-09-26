import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { EVENT_CATEGORIES } from "@nour/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { money } from "../../lib/format";
import { EVENT_STATUS_LABEL } from "../../lib/labels";
import { spacePath } from "../../lib/spaces";
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
  {!stats?<div className="stat-grid" aria-busy="true">{[0,1,2,3,4].map(i=><div key={i} className="stat skeleton-panel" style={{minHeight:104}}/>)}</div>:<>
    {user?.role==="ADMIN"&&<TodoPanel items={[
      {label:"Entretiens en attente",count:stats.pendingInterviews??0,to:"/admin/applications"},
      {label:"Soirées à valider",count:events.filter(e=>e.status==="PENDING_REVIEW").length,to:"/admin/events"},
      {label:"Demandes restaurateurs",count:stats.pendingRestaurantApplications??0,to:"/admin/restaurants"},
      {label:"Signalements ouverts",count:stats.openReports??0,to:"/admin/moderation"},
      {label:"Paiements échoués",count:stats.failedPayments??0,to:"/admin/finance"}
    ]}/>}
    {/* Les cinq chiffres qui résument la période ; le reste en liste compacte, sous le graphique. */}
    <div className="stat-grid kpi-row">
      <Stat label={`Candidatures · ${periodDays} j`} value={stats.applications}/>
      <Stat label={`Billets vendus · ${periodDays} j`} value={stats.ticketsSold}/>
      <Stat label={user?.role==="ADMIN"?`Encaissements · ${periodDays} j`:`Ventes · ${periodDays} j`} value={money(stats.revenueCents)}/>
      {stats.acceptanceRate!=null?<Stat label="Taux d’acceptation" value={`${stats.acceptanceRate} %`}/>:<Stat label="Sur liste d’attente" value={stats.waitlisted}/>}
      <Stat label="Places restantes" value={stats.remainingSpots}/>
    </div>
    <div className="admin-grid"><ActivityChart data={stats.activity??[]} periodDays={periodDays}/>
      <div className="panel">
        <div className="panel-title"><h2>Autres indicateurs</h2></div>
        <dl className="metric-list">
          <div><dt>Événements à venir</dt><dd>{stats.upcomingEvents}</dd></div>
          <div><dt>Événements au total</dt><dd>{stats.events}</dd></div>
          {stats.acceptanceRate!=null&&<div><dt>Sur liste d’attente</dt><dd>{stats.waitlisted}</dd></div>}
          {stats.upcomingInterviews!=null&&<div><dt>Entretiens à venir</dt><dd>{stats.upcomingInterviews}</dd></div>}
          {stats.pendingPayments!=null&&<div><dt>Paiements commencés, non finalisés</dt><dd>{stats.pendingPayments}</dd></div>}
          {stats.shareClicks!=null&&<div><dt>Clics sur les liens partagés</dt><dd>{stats.shareClicks}</dd></div>}
          {stats.shareAttributedApplications!=null&&<div><dt>Inscriptions grâce à un partage</dt><dd>{stats.shareAttributedApplications}</dd></div>}
          {stats.shareAttributedPurchases!=null&&<div><dt>Ventes grâce à un partage</dt><dd>{stats.shareAttributedPurchases}</dd></div>}
          {stats.subscriptionsByStatus?.map((x:any)=><div key={x.status}><dt>Abonnements · {SUBSCRIPTION_STATUS_LABEL[x.status]??x.status}</dt><dd>{x.count}</dd></div>)}
        </dl>
      </div>
    </div>
    <div className="panel quick"><h2>Raccourcis</h2><div className="quick-links"><Link to={spacePath(user?.role,"attendees")}>Voir les participants <ArrowRight size={18} aria-hidden="true"/></Link><Link to={spacePath(user?.role,"scanner")}>Scanner un billet <ArrowRight size={18} aria-hidden="true"/></Link>{user?.role==="ADMIN"&&<Link to="/admin/events/new">Créer un événement <ArrowRight size={18} aria-hidden="true"/></Link>}{user?.role==="ADMIN"&&<Link to="/admin/stats">Statistiques détaillées <ArrowRight size={18} aria-hidden="true"/></Link>}<Link to="/events">Voir le site <ArrowRight size={18} aria-hidden="true"/></Link></div></div>
  </>}</div></section></Layout>;
}

// « À traiter » (v3 : tableaux d'administration plus lisibles) : ce qui attend une action de l'équipe,
// en tête de page, chaque ligne menant à l'écran où la traiter ; un compteur non nul ressort.
function TodoPanel({ items }: { items: { label: string; count: number; to: string }[] }) {
  const total = items.reduce((n, i) => n + i.count, 0);
  return <section className="panel todo-panel" aria-labelledby="todo-title">
    <div className="panel-title"><h2 id="todo-title">À traiter</h2><span>{total === 0 ? "Tout est à jour" : `${total} élément${total > 1 ? "s" : ""}`}</span></div>
    <ul>{items.map(i => <li key={i.label}><Link to={i.to} className={i.count > 0 ? "pending" : undefined}><span>{i.label}</span><span className={`badge ${i.count > 0 ? "warning" : "neutral"}`}>{i.count}</span><ArrowRight size={16} aria-hidden="true"/></Link></li>)}</ul>
  </section>;
}

// Activité réelle (inscriptions aux événements par jour) sur la période filtrée — une seule série :
// le titre la nomme, pas de légende. Survol et focus clavier affichent la valeur de chaque barre ;
// la même donnée est disponible en tableau pour les lecteurs d'écran.
function ActivityChart({ data, periodDays }: { data: { day: string; applications: number }[]; periodDays: number }) {
  const max = Math.max(0, ...data.map(d => d.applications));
  const total = data.reduce((n, d) => n + d.applications, 0);
  const fmt = (day: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`));
  return <div className="panel chart">
    <div className="panel-title"><h2>Inscriptions par jour</h2><span>{total} sur {periodDays} jours</span></div>
    {total === 0 ? <p className="chart-empty">Aucune inscription sur cette période.</p> : <>
      <div className="chart-plot">
        <span className="chart-max" aria-hidden="true">{max}</span>
        <div className="bars" role="img" aria-label={`Inscriptions par jour, du ${fmt(data[0].day)} au ${fmt(data[data.length - 1].day)} : ${total} au total, maximum ${max} en une journée.`}>
          {data.map(d => <span key={d.day} className="bar" tabIndex={0} data-tip={`${fmt(d.day)} · ${d.applications}`} aria-label={`${fmt(d.day)} : ${d.applications} inscription${d.applications > 1 ? "s" : ""}`}><i style={{ height: `${max ? Math.max((d.applications / max) * 100, d.applications ? 3 : 0) : 0}%` }}/></span>)}
        </div>
      </div>
      <div className="chart-axis" aria-hidden="true"><span>{fmt(data[0].day)}</span><span>{fmt(data[data.length - 1].day)}</span></div>
      <details className="chart-table"><summary>Voir les données</summary><div className="table-scroll"><table><thead><tr><th scope="col">Jour</th><th scope="col">Inscriptions</th></tr></thead><tbody>{data.map(d => <tr key={d.day}><td>{fmt(d.day)}</td><td>{d.applications}</td></tr>)}</tbody></table></div></details>
    </>}
  </div>;
}
