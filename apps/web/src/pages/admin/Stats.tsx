import { useCallback, useEffect, useState } from "react";
import { API_URL, api, getToken } from "../../api";
import { Layout } from "../../components/Layout";
import { Loading, Notice } from "../../components/ui";
import { money } from "../../lib/format";
import { AdminNav, Stat } from "./AdminNav";

// §6 (cahier des charges 2026-09) : tableau exclusivement super-admin — la route serveur elle-même
// (roles(UserRole.ADMIN) seul) refuse déjà tout autre rôle ; cette page n'est de toute façon jamais
// listée ni routée pour un restaurateur ou modérateur (voir AdminNav et App()).
// C33 : préréglages de période. Chaque préréglage calcule aussi la période précédente de même
// durée, pour la comparaison — jamais une comparaison approximative ou inventée.
const STATS_PRESETS: [string, () => {since:string;until:string;compareSince:string;compareUntil:string}][] = [
  ["Aujourd’hui", () => { const d=new Date().toISOString().slice(0,10); const y=new Date(Date.now()-86_400_000).toISOString().slice(0,10); return {since:d,until:d,compareSince:y,compareUntil:y}; }],
  ["Hier", () => { const y=new Date(Date.now()-86_400_000).toISOString().slice(0,10); const y2=new Date(Date.now()-2*86_400_000).toISOString().slice(0,10); return {since:y,until:y,compareSince:y2,compareUntil:y2}; }],
  ["7 derniers jours", () => { const until=new Date().toISOString().slice(0,10); const since=new Date(Date.now()-7*86_400_000).toISOString().slice(0,10); const compareUntil=new Date(Date.now()-7*86_400_000).toISOString().slice(0,10); const compareSince=new Date(Date.now()-14*86_400_000).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }],
  ["30 derniers jours", () => { const until=new Date().toISOString().slice(0,10); const since=new Date(Date.now()-30*86_400_000).toISOString().slice(0,10); const compareUntil=new Date(Date.now()-30*86_400_000).toISOString().slice(0,10); const compareSince=new Date(Date.now()-60*86_400_000).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }],
  ["Ce mois-ci", () => { const now=new Date(); const since=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10); const until=now.toISOString().slice(0,10); const compareUntil=new Date(now.getFullYear(),now.getMonth(),0).toISOString().slice(0,10); const compareSince=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }],
  ["Cette année", () => { const now=new Date(); const since=new Date(now.getFullYear(),0,1).toISOString().slice(0,10); const until=now.toISOString().slice(0,10); const compareUntil=new Date(now.getFullYear()-1,11,31).toISOString().slice(0,10); const compareSince=new Date(now.getFullYear()-1,0,1).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }]
];
function StatDelta({current,previous,invert}:{current:number;previous:number|null|undefined;invert?:boolean}){
  if(previous==null)return null;
  const diff=previous===0?(current>0?100:0):Math.round(((current-previous)/previous)*100);
  const good=invert?diff<=0:diff>=0;
  return <span style={{fontSize:11,color:good?"var(--green)":"var(--red)",marginLeft:6}}>{diff>0?"+":""}{diff}%</span>;
}
export function AdminStats() {
  const [stats,setStats]=useState<any>(null);
  const [range,setRange]=useState(STATS_PRESETS[3][1]());
  const [scope,setScope]=useState<"all"|"participants"|"restaurants">("all");
  const load=useCallback(()=>api<any>(`/admin/stats?since=${range.since}&until=${range.until}&compareSince=${range.compareSince}&compareUntil=${range.compareUntil}`).then(setStats),[range]);
  useEffect(()=>{load()},[load]);
  const exportFile=async(ext:"csv"|"xlsx")=>{
    const response=await fetch(`${API_URL}/admin/stats/export.${ext}?since=${range.since}&until=${range.until}`,{headers:{Authorization:`Bearer ${getToken()}`}});
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`statistiques-${range.since}-${range.until}.${ext}`;a.click();URL.revokeObjectURL(url);
  };
  if(!stats)return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><Loading/></div></section></Layout>;
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Statistiques</h1>
    <div className="filters">{STATS_PRESETS.map(([label,fn])=><button key={label} type="button" className="button small secondary" onClick={()=>setRange(fn())}>{label}</button>)}</div>
    <div className="filters"><label>Depuis<input type="date" value={range.since} onChange={e=>setRange({...range,since:e.target.value})}/></label><label>Jusqu’au<input type="date" value={range.until} onChange={e=>setRange({...range,until:e.target.value})}/></label>
      <select value={scope} onChange={e=>setScope(e.target.value as any)}><option value="all">Participants + restaurateurs</option><option value="participants">Participants</option><option value="restaurants">Restaurateurs</option></select>
      <button type="button" className="button small secondary" onClick={()=>exportFile("csv")}>Exporter les ventes (CSV)</button>
      <button type="button" className="button small secondary" onClick={()=>exportFile("xlsx")}>Exporter tout (Excel)</button>
    </div>
    {(stats.alerts.cancellationRate24h>=stats.alerts.cancellationThreshold||stats.alerts.subscriptionsExpiringSoon>0||stats.alerts.blockedPayments24h>0||stats.alerts.pendingRefundRequests>0||stats.alerts.underfilledEventsPending>0)&&<Notice kind="error">
      {stats.alerts.cancellationRate24h>=stats.alerts.cancellationThreshold&&<>Taux d’annulation sur 24h : {stats.alerts.cancellationRate24h}% (seuil {stats.alerts.cancellationThreshold}%). </>}
      {stats.alerts.subscriptionsExpiringSoon>0&&<>{stats.alerts.subscriptionsExpiringSoon} abonnement{stats.alerts.subscriptionsExpiringSoon>1?"s":""} restaurateur{stats.alerts.subscriptionsExpiringSoon>1?"s":""} arrivent à échéance bientôt. </>}
      {stats.alerts.blockedPayments24h>0&&<>{stats.alerts.blockedPayments24h} paiement{stats.alerts.blockedPayments24h>1?"s":""} bloqué{stats.alerts.blockedPayments24h>1?"s":""} sur 24h. </>}
      {stats.alerts.pendingRefundRequests>0&&<>{stats.alerts.pendingRefundRequests} demande{stats.alerts.pendingRefundRequests>1?"s":""} de remboursement en attente. </>}
      {stats.alerts.underfilledEventsPending>0&&<>{stats.alerts.underfilledEventsPending} soirée{stats.alerts.underfilledEventsPending>1?"s":""} sous le seuil de participants, décision attendue.</>}
    </Notice>}
    {!stats.analyticsEnabled&&<Notice kind="info">Mesure d’audience coupée côté serveur (réglage ANALYTICS_ENABLED) : aucune visite n’est enregistrée.</Notice>}

    {(scope==="all"||scope==="participants")&&<>
      <div className="panel-title"><h2>Audience</h2></div>
      {stats.audience.instrumented?<div className="stat-grid">
        <Stat label="Visites" value={stats.audience.totalViews}/>
        <Stat label="Visiteurs uniques" value={stats.audience.uniqueVisitors}/>
      </div>:<p className="fine left">Non instrumenté (mesure d’audience désactivée).</p>}
      {stats.audience.instrumented&&stats.audience.bySource.length>0&&<p className="fine left">Sources : {stats.audience.bySource.map((s:any)=>`${s.source} (${s.visits})`).join(" · ")}</p>}

      <div className="panel-title"><h2>Tunnel participant</h2></div>
      <div className="stat-grid">
        {stats.funnelParticipant.top.instrumented&&<><Stat label="Visiteurs accueil" value={stats.funnelParticipant.top.homeVisitors}/><Stat label="Visiteurs catalogue" value={stats.funnelParticipant.top.catalogVisitors}/></>}
        <Stat label="Entretiens demandés" value={stats.funnelParticipant.interviewsRequested}/>
        <Stat label="Profils validés" value={stats.funnelParticipant.interviewsAccepted}/>
        <Stat label="Taux d’acceptation" value={stats.funnelParticipant.interviewAcceptanceRate!=null?`${stats.funnelParticipant.interviewAcceptanceRate}%`:"—"}/>
        <Stat label="Candidatures à un événement" value={stats.funnelParticipant.applicationsCreated}/>
        <Stat label="Paiements réussis" value={stats.funnelParticipant.paymentsSucceeded}/>
        <Stat label="Taux de succès paiement" value={stats.funnelParticipant.paymentSuccessRate!=null?`${stats.funnelParticipant.paymentSuccessRate}%`:"—"}/>
        <Stat label="Billets confirmés" value={stats.funnelParticipant.ticketsConfirmed}/>
        <Stat label="Annulations" value={stats.funnelParticipant.cancellationsCount}/>
        <Stat label="Entrées liste d’attente" value={stats.funnelParticipant.waitlistCount}/>
      </div>
    </>}

    {(scope==="all"||scope==="restaurants")&&<>
      <div className="panel-title"><h2>Tunnel restaurateur</h2></div>
      <div className="stat-grid"><Stat label="Nouvelles demandes" value={stats.funnelRestaurant.newRequests}/><Stat label="Approuvées" value={stats.funnelRestaurant.approved}/><Stat label="Abonnements souscrits" value={stats.funnelRestaurant.subscriptionsStarted}/><Stat label="Événements créés" value={stats.funnelRestaurant.eventsCreated}/><Stat label="Événements publiés" value={stats.funnelRestaurant.eventsPublished}/></div>
    </>}

    <div className="panel-title"><h2>Finance</h2></div>
    <div className="stat-grid">
      <Stat label="Revenu billetterie" value={<>{money(stats.finance.ticketRevenueCents)}<StatDelta current={stats.finance.ticketRevenueCents} previous={stats.previous?.finance.ticketRevenueCents}/></>}/>
      <Stat label="Remboursé" value={`${money(stats.finance.refundedCents)} (${stats.finance.refundedCount})`}/>
      <Stat label="MRR abonnements" value={money(stats.finance.subscriptionMonthlyRevenueCents)}/>
      <Stat label="Abonnements actifs" value={stats.finance.activeSubscriptionsCount}/>
      <Stat label="Impayés (PAST_DUE)" value={stats.finance.pastDueCount}/>
    </div>
    <p className="fine left">Abonnements par statut : {stats.finance.subscriptionsByStatus.map((s:any)=>`${s.status} (${s.count})`).join(" · ")||"—"}</p>

    <div className="panel-title"><h2>Blog</h2></div>
    {stats.blog.instrumented?<div className="stat-grid"><Stat label="Lectures" value={stats.blog.reads}/><Stat label="Lecteurs uniques" value={stats.blog.uniqueReaders}/></div>:<p className="fine left">Non instrumenté (mesure d’audience désactivée).</p>}

    <div className="panel-title"><h2>Search Console</h2></div>
    <p className="fine left">{stats.searchConsole.connected?"Connecté.":"Non configuré — aucune donnée Search Console à afficher."}</p>

    <div className="panel-title"><h2>Partage</h2></div>
    <div className="stat-grid"><Stat label="Nouveaux participants" value={stats.audienceLegacy.newParticipants}/><Stat label="Clics de partage (total)" value={stats.audienceLegacy.shareClicks}/><Stat label="Candidatures via partage" value={stats.audienceLegacy.shareAttributedApplications}/><Stat label="Achats via partage" value={stats.audienceLegacy.shareAttributedPurchases}/></div>
  </div></section></Layout>;
}
