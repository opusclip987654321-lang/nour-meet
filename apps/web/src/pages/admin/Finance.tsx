import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Layout } from "../../components/Layout";
import { Notice } from "../../components/ui";
import { money } from "../../lib/format";
import { AdminNav, Stat } from "./AdminNav";

export function AdminFinance() {
  const {user}=useAuth();
  const [entries,setEntries]=useState<any[]>([]);
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

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">{user?.role==="ADMIN"?"SUPER-ADMINISTRATION":"ESPACE RESTAURATEUR"}</span><h1>Finances</h1><p className="fine left">Aucun virement n’est jamais déclenché automatiquement par la plateforme : « Marquer comme reversé » n’est qu’un registre, à cocher après un virement fait vous-même.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {summary&&<div className="stat-grid">
      {summary.nourOwnRevenueCents!=null&&<Stat label="CA propre Nūr (événements en direct)" value={money(summary.nourOwnRevenueCents)}/>}
      {summary.subscriptionMonthlyRevenueCents!=null&&<Stat label="Abonnements restaurateurs (mensuel)" value={`${money(summary.subscriptionMonthlyRevenueCents)} · ${summary.activeSubscriptionsCount} actifs`}/>}
      <Stat label="Volume brut billets restaurateurs" value={money(summary.grossTicketVolumeCents)}/>
      <Stat label="Commission Nour (héritée 30/70)" value={money(summary.commissionCents)}/>
      <Stat label="Dû au(x) restaurant(s) (modèle 30/70)" value={money(summary.restaurantDueCents)}/>
      <Stat label="Déjà reversé (modèle 30/70)" value={money(summary.paidOutCents)}/>
      <Stat label="Remboursé (modèle 30/70)" value={money(summary.refundedCents)}/>
      <Stat label="Frais Stripe (modèle 30/70)" value={money(summary.feesCents)}/>
      {summary.stripeBalance&&<Stat label="Solde Stripe (test) disponible / en attente" value={`${money(summary.stripeBalance.availableCents)} / ${money(summary.stripeBalance.pendingCents)}`}/>}
      {summary.disputesCount!=null&&<Stat label="Litiges Stripe en cours" value={summary.disputesCount>0?`${summary.disputesCount} · ${money(summary.disputesAmountCents)}`:"Aucun"}/>}
    </div>}
    {summary&&!summary.commissionLedgerEnabled&&<p className="fine left">Le registre commission 30/70 est désactivé depuis le passage à l’abonnement mensuel : « Commission », « Dû » et « Déjà reversé » ne couvrent que les ventes historiques sous l’ancien modèle, pas les événements récents sous abonnement. Le volume brut reste, lui, toujours à jour.</p>}
    {entries.length===0?<div className="empty"><span>◇</span><h2>Aucune vente pour le moment</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Événement</span><span>Brut</span><span>Commission</span><span>Dû restaurant</span><span>Statut</span></div>
      {entries.map(e=><div key={e.id} className="table-row"><span><b>{e.event.title}</b>{user?.role==="ADMIN"&&<small>{e.restaurant.name}</small>}</span><span>{money(e.grossAmountCents)}</span><span>{money(e.commissionAmountCents)} ({e.commissionRate}%)</span><span>{money(e.restaurantDueCents)}{e.refundedAmountCents>0&&<small className="fine"> · remboursé</small>}</span><span>{e.paidOutAt?<small className="fine">Reversé le {new Date(e.paidOutAt).toLocaleDateString("fr-FR")}</small>:user?.role==="ADMIN"?<button className="button small" disabled={busy===e.id} onClick={()=>markPaid(e.id)}>Marquer comme reversé</button>:<small className="fine">{e.readyToPayOut?"Prêt à reverser":"En attente"}</small>}</span></div>)}
    </div>}
  </div></section></Layout>;
}
