import { CalendarClock, Check, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Notice } from "../components/ui";
import { money } from "../lib/format";
import { SUBSCRIPTION_STATUS_LABEL } from "../lib/labels";

type Plan = { id: string; name: string; monthlyPriceCents: number; annualPriceCents: number | null; monthlyEventQuota: number | null; highlightTier: "simple" | "priority" | null };
type Period = "MONTHLY" | "ANNUAL";

const longDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const priceFor = (plan: Plan, period: Period) => period === "ANNUAL" ? plan.annualPriceCents : plan.monthlyPriceCents;

// Lignes de comparaison : uniquement ce qui existe réellement dans le produit (quota appliqué à la
// publication, badge de mise en avant sur les fiches), jamais une promesse commerciale sans effet.
// Corrections web 2026-09-24 (§1.1) : plus de mention de mise en avant pour la formule Standard.
const planFeatures = (plan: Plan): { label: string; included: boolean }[] => [
  { label: plan.monthlyEventQuota == null ? "Soirées publiées en illimité" : `${plan.monthlyEventQuota} soirées publiées par mois`, included: true },
  { label: "Billetterie, paiement en ligne et billets QR", included: true },
  { label: "Liste des participants et scan à l’entrée", included: true },
  { label: "Comptes pour votre personnel d’accueil", included: true },
  { label: "Mise en avant prioritaire des soirées et de l’établissement", included: plan.highlightTier === "priority" }
];

// Corrections web 2026-09-24 (§1.2 à §1.4) : cartes de tarifs côte à côte. Un établissement déjà abonné
// voit sa formule marquée « Offre actuelle » et « Changer de formule » sur les autres ; la règle
// (immédiat avec prorata vers le haut, à l'échéance vers le bas) est appliquée par l'API, cet écran
// ne fait que l'expliquer avant confirmation et afficher l'état relu chez Stripe.
export function RestaurantSubscriptionPanel({ restaurant, onChanged }: { restaurant: any; onChanged: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const subscription = restaurant.subscription;
  const subscribed = !!subscription && subscription.status !== "CANCELLED";
  const [period, setPeriod] = useState<Period>(subscribed ? subscription.billingPeriod : "MONTHLY");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  useEffect(() => { api<Plan[]>("/plans").then(setPlans).catch(() => setPlans([])); }, []);
  useEffect(() => { if (subscribed) setPeriod(subscription.billingPeriod); }, [subscribed, subscription?.billingPeriod]);

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
          if (synced?.stripeSubscriptionId) { if (!cancelled) { setNotice({ kind: "success", text: synced.status === "TRIALING" ? `Formule ${synced.plan.name} activée : votre essai gratuit court jusqu’au ${longDate(synced.currentPeriodEnd)}.` : `Formule ${synced.plan.name} activée.` }); onChanged(); } return; }
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
    const { url } = await api<{ url: string }>("/restaurants/me/subscription/checkout", { method: "POST", body: JSON.stringify({ planId, billingPeriod: period }) });
    window.location.href = url;
  });
  const changePlan = (plan: Plan) => run(plan.id, async () => {
    const result = await api<{ direction: "UPGRADE" | "DOWNGRADE"; subscription: any }>("/restaurants/me/subscription/change-plan", { method: "POST", body: JSON.stringify({ planId: plan.id }) });
    setConfirming(null);
    setNotice({ kind: "success", text: result.direction === "UPGRADE" ? `Vous êtes passé en formule ${plan.name}. Le prorata a été facturé sur votre moyen de paiement.` : `Changement programmé : vous restez en formule ${subscription.plan.name} jusqu’au ${longDate(result.subscription.pendingChangeAt)}, puis passez en ${plan.name}.` });
    onChanged();
  });
  const cancelPendingChange = () => run("cancel-change", async () => {
    await api("/restaurants/me/subscription/cancel-plan-change", { method: "POST" });
    setNotice({ kind: "success", text: `Changement annulé : vous conservez la formule ${subscription.plan.name}.` });
    onChanged();
  });
  const cancelSubscription = () => run("cancel", async () => {
    await api("/restaurants/me/subscription/cancel", { method: "POST" });
    setNotice({ kind: "success", text: "Résiliation programmée : vos avantages restent actifs jusqu’à la fin de la période déjà payée." });
    onChanged();
  });
  const openPortal = () => run("portal", async () => {
    const { url } = await api<{ url: string }>("/restaurants/me/subscription/portal", { method: "POST" });
    window.location.href = url;
  });

  const pendingPlan = subscribed && subscription.pendingPlanId ? plans?.find(p => p.id === subscription.pendingPlanId) : null;
  const trialOffered = !subscription;
  const canToggle = !subscribed;

  return <div className="stack">
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    {subscribed && <div className="panel subscription-summary">
      <div className="panel-title"><h2>Mon abonnement</h2><span className={`badge ${subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? "success" : "warning"}`}>{SUBSCRIPTION_STATUS_LABEL[subscription.status] ?? subscription.status}</span></div>
      <p className="subscription-line">Formule <b>{subscription.plan.name}</b> · facturation {subscription.billingPeriod === "ANNUAL" ? "annuelle" : "mensuelle"} · {subscription.cancelAtPeriodEnd ? `résiliation effective le ${longDate(subscription.currentPeriodEnd)}` : subscription.status === "TRIALING" ? `essai gratuit jusqu’au ${longDate(subscription.currentPeriodEnd)}` : `prochaine échéance le ${longDate(subscription.currentPeriodEnd)}`}</p>
      <p className="subscription-line">Ce mois-ci : {restaurant.currentMonthEventsPublished}{subscription.plan.monthlyEventQuota == null ? " soirée(s) publiée(s), sans limite" : ` / ${subscription.plan.monthlyEventQuota} soirées publiées`}</p>
      {pendingPlan && <Notice kind="info"><CalendarClock size={16} aria-hidden="true" /> Passage en formule <b>{pendingPlan.name}</b> le <b>{longDate(subscription.pendingChangeAt)}</b>. Vous gardez la formule {subscription.plan.name} jusqu’à cette date.</Notice>}
      {subscription.status === "PAST_DUE" && <Notice kind="error">Le dernier prélèvement a échoué. Mettez à jour votre moyen de paiement pour conserver votre formule.</Notice>}
      <div className="decision-buttons">
        {subscription.stripeCustomerId && <button type="button" className="button secondary small" disabled={!!busy} onClick={openPortal}>Moyen de paiement et factures</button>}
        {pendingPlan && <button type="button" className="button secondary small" disabled={!!busy} onClick={cancelPendingChange}>{busy === "cancel-change" ? "Annulation…" : `Conserver ${subscription.plan.name}`}</button>}
        {!subscription.cancelAtPeriodEnd && <button type="button" className="button ghost small" disabled={!!busy} onClick={cancelSubscription}>{busy === "cancel" ? "Résiliation…" : "Résilier"}</button>}
      </div>
    </div>}

    <div className="pricing-head">
      <div>
        <h2>{subscribed ? "Les formules" : "Choisissez votre formule"}</h2>
        <p className="fine left">Prix hors taxes. {trialOffered ? `Essai gratuit de ${restaurant.trialDays??7} jours, carte requise, résiliable avant l’échéance.` : "Sans engagement au-delà de la période en cours."}</p>
      </div>
      {canToggle && <div className="segmented" role="group" aria-label="Périodicité de facturation">
        <button type="button" aria-pressed={period === "MONTHLY"} className={period === "MONTHLY" ? "active" : undefined} onClick={() => setPeriod("MONTHLY")}>Mensuel</button>
        <button type="button" aria-pressed={period === "ANNUAL"} className={period === "ANNUAL" ? "active" : undefined} onClick={() => setPeriod("ANNUAL")}>Annuel · 2 mois offerts</button>
      </div>}
    </div>

    {plans === null
      ? <div className="pricing-grid" aria-busy="true">{[0, 1].map(i => <div key={i} className="pricing-card skeleton" style={{ minHeight: 420 }} />)}</div>
      : <div className="pricing-grid">{plans.map(plan => {
        const price = priceFor(plan, period);
        const isCurrent = subscribed && subscription.planId === plan.id;
        const isPending = subscribed && subscription.pendingPlanId === plan.id;
        const featured = plan.highlightTier === "priority";
        const upgrade = subscribed && plan.monthlyPriceCents > subscription.plan.monthlyPriceCents;
        return <article key={plan.id} className={`pricing-card${featured ? " featured" : ""}${isCurrent ? " current" : ""}`} aria-labelledby={`plan-${plan.id}`}>
          <div className="pricing-card-top">
            <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
            {isCurrent ? <span className="pricing-tag">Offre actuelle</span> : isPending ? <span className="pricing-tag muted">Dès le {longDate(subscription.pendingChangeAt)}</span> : null}
          </div>
          <p className="pricing-price">{price == null ? <span className="pricing-unavailable">Non disponible en annuel</span> : <><strong>{money(price).replace(",00", "")}</strong><span>{period === "ANNUAL" ? "HT / an" : "HT / mois"}</span></>}</p>
          {period === "ANNUAL" && price != null && <p className="pricing-note">soit {money(Math.round(price / 12))} HT par mois</p>}
          <ul className="pricing-features">{planFeatures(plan).map(f => <li key={f.label} className={f.included ? undefined : "excluded"}>{f.included ? <Check size={18} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}<span>{f.label}{!f.included && <span className="visually-hidden"> (non inclus)</span>}</span></li>)}</ul>
          <div className="pricing-action">
            {isCurrent
              ? <button type="button" className="button full secondary" disabled>Offre actuelle</button>
              : isPending
                ? <p className="fine">Changement déjà programmé.</p>
                : subscribed && subscription.stripeSubscriptionId
                  ? confirming === plan.id
                    ? <div className="pricing-confirm">
                      <p>{upgrade ? `Passage immédiat en ${plan.name}. Stripe facture aujourd’hui la différence au prorata de la période en cours.` : `Vous gardez ${subscription.plan.name} jusqu’au ${longDate(subscription.currentPeriodEnd)}, puis passez en ${plan.name} à l’échéance.`}</p>
                      <div className="decision-buttons"><button type="button" className={`button small${featured ? " accent" : ""}`} disabled={!!busy} onClick={() => changePlan(plan)}>{busy === plan.id ? "Confirmation…" : "Confirmer"}</button><button type="button" className="button small secondary" disabled={!!busy} onClick={() => setConfirming(null)}>Annuler</button></div>
                    </div>
                    : <button type="button" className={`button full${featured ? " accent" : " secondary"}`} disabled={!!busy || price == null} onClick={() => setConfirming(plan.id)}>Changer de formule</button>
                  : <button type="button" className={`button full${featured ? " accent" : ""}`} disabled={!!busy || price == null} onClick={() => checkout(plan.id)}>{busy === plan.id ? "Redirection…" : subscribed ? "Changer de formule" : "Choisir cette formule"}</button>}
          </div>
        </article>;
      })}</div>}
    <p className="fine left">Le choix de la formule ne publie rien automatiquement : chaque soirée reste soumise à validation par l’équipe Nūr Meet. Paiement sécurisé par Stripe.</p>
  </div>;
}
