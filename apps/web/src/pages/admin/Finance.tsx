import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { Notice } from "../../components/ui";
import { money } from "../../lib/format";
import { AdminNav, Stat } from "./AdminNav";
import { DataTable } from "../../components/DataTable";

export function AdminFinance() {
  const {user}=useAuth();
  // null = en cours de chargement (squelette), [] = réellement vide : jamais d'état vide affiché
  // avant l'arrivée des données.
  const [entries,setEntries]=useState<any[]|null>(null);
  const [summary,setSummary]=useState<any>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/admin/finance/ledger"),api<any>("/admin/finance/summary")]).then(([l,s])=>{setEntries(l);setSummary(s)});
  useEffect(()=>{load()},[]);

  const markPaid=async(id:string)=>{
    setBusy(id);setNotice(null);
    try{await api(`/admin/finance/ledger/${id}/mark-paid`,{method:"POST",body:JSON.stringify({})});setNotice({kind:"success",text:"Marqué comme reversé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><h1>Finances</h1><p className="fine left">Aucun virement n’est jamais déclenché automatiquement par la plateforme : « Marquer comme reversé » n’est qu’un registre, à cocher après un virement fait vous-même.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {!summary?<div className="stat-grid" aria-busy="true">{[0,1,2,3].map(i=><div key={i} className="stat skeleton-panel" style={{minHeight:104}}/>)}</div>:<>
      <h2 className="section-heading">Revenus actuels</h2>
      <div className="stat-grid kpi-row">
        {summary.nourOwnRevenueCents!=null&&<Stat label="Chiffre d’affaires des événements Nūr Meet" value={money(summary.nourOwnRevenueCents)}/>}
        {summary.subscriptionMonthlyRevenueCents!=null&&<Stat label={`Abonnements restaurateurs · ${summary.activeSubscriptionsCount} actif${summary.activeSubscriptionsCount>1?"s":""}`} value={`${money(summary.subscriptionMonthlyRevenueCents)} / mois`}/>}
        <Stat label="Billets vendus par les restaurateurs (brut)" value={money(summary.grossTicketVolumeCents)}/>
        {summary.disputesCount!=null&&<Stat label="Litiges Stripe en cours" value={summary.disputesCount>0?`${summary.disputesCount} · ${money(summary.disputesAmountCents)}`:"Aucun"}/>}
        {summary.stripeBalance&&<Stat label="Solde Stripe disponible / en attente" value={`${money(summary.stripeBalance.availableCents)} / ${money(summary.stripeBalance.pendingCents)}`}/>}
      </div>
      {/* Ancien modèle à commission : conservé pour l'historique (données comptables jamais supprimées). */}
      <details className="panel legacy-ledger" open={(entries?.length??0)>0&&summary.commissionLedgerEnabled}>
        <summary><h2>Ancien modèle à commission 30/70</h2><span className="fine">{summary.commissionLedgerEnabled?"Actif":"Historique — remplacé par l’abonnement mensuel"}</span></summary>
        <div className="stat-grid kpi-row">
          <Stat label="Commission Nūr Meet" value={money(summary.commissionCents)}/>
          <Stat label="Dû aux restaurants" value={money(summary.restaurantDueCents)}/>
          <Stat label="Déjà reversé" value={money(summary.paidOutCents)}/>
          <Stat label="Remboursé" value={money(summary.refundedCents)}/>
          <Stat label="Frais Stripe" value={money(summary.feesCents)}/>
        </div>
        {!summary.commissionLedgerEnabled&&<p className="fine left">Ces montants ne couvrent que les ventes réalisées sous l’ancien modèle, pas les événements récents sous abonnement.</p>}
        <DataTable caption="Registre des ventes (modèle 30/70)" rows={entries} rowKey={e=>e.id} empty="Aucune vente sous l’ancien modèle 30/70." columns={[
          {key:"event",header:"Événement",primary:true,render:e=><span className="cell-main"><b>{e.event.title}</b>{user?.role==="ADMIN"&&<small>{e.restaurant.name}</small>}</span>},
          {key:"gross",header:"Brut",numeric:true,render:e=>money(e.grossAmountCents)},
          {key:"commission",header:"Commission",numeric:true,render:e=>`${money(e.commissionAmountCents)} (${e.commissionRate} %)`},
          {key:"due",header:"Dû au restaurant",numeric:true,render:e=><>{money(e.restaurantDueCents)}{e.refundedAmountCents>0&&<small className="fine"> · remboursé</small>}</>},
          {key:"status",header:"Statut",render:e=>e.paidOutAt?<span className="badge success">Reversé le {new Date(e.paidOutAt).toLocaleDateString("fr-FR")}</span>:user?.role==="ADMIN"?<button className="button small" disabled={busy===e.id} onClick={()=>markPaid(e.id)}>Marquer comme reversé</button>:<span className="badge neutral">{e.readyToPayOut?"Prêt à reverser":"En attente"}</span>}
        ]}/>
      </details>
    </>}
  </div></section></Layout>;
}
