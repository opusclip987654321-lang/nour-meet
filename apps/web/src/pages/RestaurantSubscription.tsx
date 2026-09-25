import { subscriptionChangeTiming } from "@nour/shared";
import type { BillingPeriod } from "@nour/shared";
import { CalendarClock, Check, FileText, Minus } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DevTestCards } from "../components/DevTestCards";
import { Notice } from "../components/ui";
import { longDate, money } from "../lib/format";
import { Plan, planFeatures, priceFor } from "../lib/plans";
import { SUBSCRIPTION_STATUS_LABEL } from "../lib/labels";

type Invoice = { id: string; number: string | null; status: string | null; createdAt: string; amountCents: number; currency: string; hostedUrl: string | null; pdfUrl: string | null };
// Lecture unique de l'abonnement (GET /restaurants/me/subscription) — exactement celle que
// l'administration consulte en lecture seule (GET /admin/restaurants/:id/subscription).
export type SubscriptionOverview = {
  subscription: null | {
    status: string; billingPeriod: BillingPeriod; plan: { id: string; name: string; monthlyPriceCents: number; annualPriceCents: number | null; monthlyEventQuota: number | null };
    currentPeriodEnd: string; cancelAtPeriodEnd: boolean; pendingPlan: { id: string; name: string } | null; pendingBillingPeriod: BillingPeriod | null; pendingChangeAt: string | null;
    managedByStripe: boolean; hasBillingAccount: boolean;
  };
  eventsPublishedThisMonth: number;
  invoices: Invoice[];
};

export const periodLabel = (period: BillingPeriod | null | undefined) => period === "ANNUAL" ? "annuelle" : "mensuelle";
const INVOICE_STATUS: Record<string, string> = { paid: "Payée", open: "À régler", draft: "En préparation", void: "Annulée", uncollectible: "Impayée" };

// Résumé et factures, partagés avec la fiche restaurateur de l'administration (lecture seule).
export function SubscriptionSummary({ overview, actions }: { overview: SubscriptionOverview; actions?: ReactNode }) {
  const subscription = overview.subscription;
  if (!subscription) return <p className="fine left">Aucun abonnement souscrit pour le moment.</p>;
  return <>
    <p className="subscription-line">Formule <b>{subscription.plan.name}</b> · facturation {periodLabel(subscription.billingPeriod)} · {subscription.cancelAtPeriodEnd ? `résiliation effective le ${longDate(subscription.currentPeriodEnd)}` : subscription.status === "TRIALING" ? `essai gratuit jusqu’au ${longDate(subscription.currentPeriodEnd)}` : `prochaine échéance le ${longDate(subscription.currentPeriodEnd)}`}</p>
    <p className="subscription-line">Ce mois-ci : {overview.eventsPublishedThisMonth}{subscription.plan.monthlyEventQuota == null ? " soirée(s) publiée(s), sans limite" : ` / ${subscription.plan.monthlyEventQuota} soirées publiées`}</p>
    {subscription.pendingPlan && subscription.pendingChangeAt && <Notice kind="info"><span><CalendarClock size={16} aria-hidden="true" /> Passage en formule <b>{subscription.pendingPlan.name}</b> (facturation {periodLabel(subscription.pendingBillingPeriod ?? subscription.billingPeriod)}) le <b>{longDate(subscription.pendingChangeAt)}</b>.</span></Notice>}
    {subscription.status === "PAST_DUE" && <Notice kind="error">Le dernier prélèvement a échoué : moyen de paiement à mettre à jour.</Notice>}
    {actions}
    <InvoiceList invoices={overview.invoices}/>
  </>;
}

function InvoiceList({ invoices }: { invoices: Invoice[] }) {
  return <div className="invoice-list">
    <h3>Factures</h3>
    {invoices.length === 0
      ? <p className="fine left">Aucune facture pour le moment.</p>
      : <div className="table">{invoices.map(i => <div key={i.id} className="table-row">
        <span><FileText size={16} aria-hidden="true" /> {longDate(i.createdAt)}{i.number ? <small>{i.number}</small> : null}</span>
        <span>{money(i.amountCents)}</span>
        <span>{INVOICE_STATUS[i.status ?? ""] ?? i.status}</span>
        <span className="invoice-links">{i.hostedUrl && <a className="text-link" href={i.hostedUrl} target="_blank" rel="noreferrer">Voir</a>}{i.pdfUrl && <a className="text-link" href={i.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}</span>
      </div>)}</div>}
  </div>;
}

// Espace restaurateur : il gère SON abonnement. Cartes côte à côte, périodicité mensuelle ou annuelle
// au choix, y compris pour un abonnement en cours. La règle (immédiat ou à l'échéance) vient de
// @nour/shared et est appliquée par l'API : cet écran l'annonce avant confirmation, puis affiche
// l'état relu chez Stripe.
export function RestaurantSubscriptionPanel({ onChanged }: { onChanged: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [overview, setOverview] = useState<SubscriptionOverview | null>(null);
  const subscription = overview?.subscription ?? null;
  const subscribed = !!subscription && subscription.status !== "CANCELLED";
  const [period, setPeriod] = useState<BillingPeriod>("MONTHLY");
  // CGV partie B : acceptation exigée avant toute souscription ou tout changement de formule (paiement immédiat).
  const [acceptCgv, setAcceptCgv] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const loadOverview = () => api<SubscriptionOverview>("/restaurants/me/subscription").then(o => { setOverview(o); if (o.subscription && o.subscription.status !== "CANCELLED") setPeriod(o.subscription.billingPeriod); }).catch(() => setOverview({ subscription: null, eventsPublishedThisMonth: 0, invoices: [] }));
  useEffect(() => { api<Plan[]>("/plans").then(setPlans).catch(() => setPlans([])); loadOverview(); }, []);
  const refresh = () => { loadOverview(); onChanged(); };

  // Retour de Stripe Checkout : le webhook peut arriver quelques secondes après la redirection. On
  // relit l'état réel chez Stripe (quelques essais espacés) plutôt que d'afficher une formule non confirmée.
  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (!checkout) return;
    const next = new URLSearchParams(searchParams); next.delete("checkout"); setSearchParams(next, { replace: true });
    if (checkout === "cancel") { setNotice({ kind: "error", text: "Souscription interrompue avant la fin du paiement : aucune formule n’a été activée." }); return; }
    let cancelled = false;
    setNotice({ kind: "info", text: "Paiement reçu, confirmation de votre abonnement auprès de Stripe…" });
    (async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        try {
          const synced = await api<any>("/restaurants/me/subscription/sync", { method: "POST" });
          if (synced?.stripeSubscriptionId) { if (!cancelled) { setNotice({ kind: "success", text: synced.status === "TRIALING" ? `Formule ${synced.plan.name} activée : votre essai gratuit court jusqu’au ${longDate(synced.currentPeriodEnd)}.` : `Formule ${synced.plan.name} activée.` }); refresh(); } return; }
        } catch { /* nouvel essai ci-dessous */ }
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!cancelled) setNotice({ kind: "info", text: "Votre paiement est en cours de confirmation par Stripe. Rechargez la page dans quelques instants." });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois au retour de Checkout
  }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setNotice(null);
    try { await action(); } catch (err) { setNotice({ kind: "error", text: (err as Error).message }); } finally { setBusy(null); }
  };
  const checkout = (planId: string) => run(planId, async () => {
    const { url } = await api<{ url: string }>("/restaurants/me/subscription/checkout", { method: "POST", body: JSON.stringify({ planId, billingPeriod: period, acceptCgv }) });
    window.location.href = url;
  });
  const changePlan = (plan: Plan) => run(plan.id, async () => {
    const result = await api<{ direction: "UPGRADE" | "DOWNGRADE"; subscription: any }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: plan.id, billingPeriod: period, acceptCgv }) });
    setConfirming(null);
    setNotice({ kind: "success", text: result.direction === "UPGRADE" ? `C’est fait : formule ${plan.name}, facturation ${periodLabel(period)}. Le prorata a été facturé sur votre moyen de paiement.` : `Changement programmé : formule ${plan.name}, facturation ${periodLabel(period)}, à partir du ${longDate(result.subscription.pendingChangeAt)}.` });
    refresh();
  });
  const cancelPendingChange = () => run("cancel-change", async () => {
    await api("/restaurants/me/subscription/cancel-plan-change", { method: "POST" });
    setNotice({ kind: "success", text: "Changement annulé : vous conservez votre formule actuelle." });
    refresh();
  });
  const cancelSubscription = () => run("cancel", async () => {
    await api("/restaurants/me/subscription/cancel", { method: "POST" });
    setNotice({ kind: "success", text: "Résiliation programmée : vos avantages restent actifs jusqu’à la fin de la période déjà payée." });
    refresh();
  });
  const openPortal = () => run("portal", async () => {
    const { url } = await api<{ url: string }>("/restaurants/me/subscription/portal", { method: "POST" });
    window.location.href = url;
  });

  if (!overview) return <div className="stack" aria-busy="true"><div className="panel skeleton skeleton-panel" /></div>;

  return <div className="stack">
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    {subscribed && subscription && <div className="panel subscription-summary">
      <div className="panel-title"><h2>Mon abonnement</h2><span className={`badge ${subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? "success" : "warning"}`}>{SUBSCRIPTION_STATUS_LABEL[subscription.status] ?? subscription.status}</span></div>
      <SubscriptionSummary overview={overview} actions={<div className="decision-buttons">
        {subscription.hasBillingAccount && <button type="button" className="button secondary small" disabled={!!busy} onClick={openPortal}>Moyen de paiement</button>}
        {subscription.pendingPlan && <button type="button" className="button secondary small" disabled={!!busy} onClick={cancelPendingChange}>{busy === "cancel-change" ? "Annulation…" : "Annuler le changement programmé"}</button>}
        {!subscription.cancelAtPeriodEnd && <button type="button" className="button ghost small" disabled={!!busy} onClick={cancelSubscription}>{busy === "cancel" ? "Résiliation…" : "Résilier"}</button>}
      </div>}/>
    </div>}

    <div className="pricing-head">
      <div>
        <h2>{subscribed ? "Changer de formule ou de périodicité" : "Choisissez votre formule"}</h2>
        <p className="fine left">Prix hors taxes. {!subscription ? "Paiement par carte à la souscription, puis à chaque échéance." : "Formule supérieure ou passage à l’annuel : immédiat, au prorata. Formule inférieure ou passage au mensuel : à la fin de la période déjà payée."}</p>
        <label className="consent-check"><input type="checkbox" checked={acceptCgv} onChange={e => setAcceptCgv(e.target.checked)} /> <span>J’ai lu et j’accepte les <Link to="/legal/cgv" target="_blank">conditions générales de vente</Link> (partie B, abonnements restaurateurs).</span></label>
      </div>
      <div className="segmented" role="group" aria-label="Périodicité de facturation">
        <button type="button" aria-pressed={period === "MONTHLY"} className={period === "MONTHLY" ? "active" : undefined} onClick={() => { setPeriod("MONTHLY"); setConfirming(null); }}>Mensuel</button>
        <button type="button" aria-pressed={period === "ANNUAL"} className={period === "ANNUAL" ? "active" : undefined} onClick={() => { setPeriod("ANNUAL"); setConfirming(null); }}>Annuel · 2 mois offerts</button>
      </div>
    </div>

    {plans === null
      ? <div className="pricing-grid" aria-busy="true">{[0, 1].map(i => <div key={i} className="pricing-card skeleton skeleton-pricing" />)}</div>
      : <div className="pricing-grid">{plans.map(plan => {
        const price = priceFor(plan, period);
        const isCurrent = subscribed && subscription!.plan.id === plan.id && subscription!.billingPeriod === period;
        const isPending = subscribed && subscription!.pendingPlan?.id === plan.id && (subscription!.pendingBillingPeriod ?? subscription!.billingPeriod) === period;
        const featured = plan.highlightTier === "priority";
        const timing = subscribed ? subscriptionChangeTiming({ monthlyPriceCents: subscription!.plan.monthlyPriceCents, billingPeriod: subscription!.billingPeriod }, { monthlyPriceCents: plan.monthlyPriceCents, billingPeriod: period }) : null;
        const samePlan = subscribed && subscription!.plan.id === plan.id;
        const changeLabel = samePlan ? (period === "ANNUAL" ? "Passer en annuel" : "Passer en mensuel") : "Changer de formule";
        return <article key={plan.id} className={`pricing-card${featured ? " featured" : ""}${isCurrent ? " current" : ""}`} aria-labelledby={`plan-${plan.id}`}>
          <div className="pricing-card-top">
            <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
            {isCurrent ? <span className="pricing-tag">Offre actuelle</span> : isPending && subscription!.pendingChangeAt ? <span className="pricing-tag muted">Dès le {longDate(subscription!.pendingChangeAt)}</span> : null}
          </div>
          <p className="pricing-price">{price == null ? <span className="pricing-unavailable">Non disponible en annuel</span> : <><strong>{money(price).replace(",00", "")}</strong><span>{period === "ANNUAL" ? "HT / an" : "HT / mois"}</span></>}</p>
          {period === "ANNUAL" && price != null && <p className="pricing-note">soit {money(Math.round(price / 12))} HT par mois</p>}
          <ul className="pricing-features">{planFeatures(plan).map(f => <li key={f.label} className={f.included ? undefined : "excluded"}>{f.included ? <Check size={18} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}<span>{f.label}{!f.included && <span className="visually-hidden"> (non inclus)</span>}</span></li>)}</ul>
          <div className="pricing-action">
            {isCurrent
              ? <button type="button" className="button full secondary" disabled>Offre actuelle</button>
              : isPending
                ? <p className="fine">Changement déjà programmé.</p>
                : subscribed && subscription!.managedByStripe
                  ? confirming === plan.id
                    ? <div className="pricing-confirm">
                      <p>{timing === "IMMEDIATE" ? `Passage immédiat : ${plan.name}, facturation ${periodLabel(period)}. Stripe facture aujourd’hui la différence au prorata.` : `Vous gardez ${subscription!.plan.name} (facturation ${periodLabel(subscription!.billingPeriod)}) jusqu’au ${longDate(subscription!.currentPeriodEnd)}, puis passez en ${plan.name}, facturation ${periodLabel(period)}.`}</p>
                      <div className="decision-buttons"><button type="button" className={`button small${featured ? " accent" : ""}`} disabled={!!busy || !acceptCgv} onClick={() => changePlan(plan)}>{busy === plan.id ? "Confirmation…" : "Confirmer"}</button><button type="button" className="button small secondary" disabled={!!busy} onClick={() => setConfirming(null)}>Annuler</button></div>
                    </div>
                    : <button type="button" className={`button full${featured ? " accent" : " secondary"}`} disabled={!!busy || price == null} onClick={() => setConfirming(plan.id)}>{changeLabel}</button>
                  : subscribed
                    ? <p className="fine">Abonnement géré par l’équipe Nūr Meet : contactez-nous pour le modifier.</p>
                    : <button type="button" className={`button full${featured ? " accent" : ""}`} disabled={!!busy || price == null || !acceptCgv} onClick={() => checkout(plan.id)}>{busy === plan.id ? "Redirection…" : "Choisir cette formule"}</button>}
          </div>
        </article>;
      })}</div>}
    {!subscribed && overview.invoices.length > 0 && <div className="panel"><InvoiceList invoices={overview.invoices}/></div>}
    <DevTestCards/>
    <p className="fine left">Le choix de la formule ne publie rien automatiquement : chaque soirée reste soumise à validation par l’équipe Nūr Meet. Paiement sécurisé par Stripe.</p>
  </div>;
}
