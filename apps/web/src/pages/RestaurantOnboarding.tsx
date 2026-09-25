import { Check } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EventForm, emptyEventForm, eventFormPayload, eventToForm, type EventFormState } from "../components/EventForm";
import { Layout } from "../components/Layout";
import { Loading, Notice } from "../components/ui";
import { dateTime, money } from "../lib/format";
import { RestaurantSubscriptionPanel } from "./RestaurantSubscription";

// Onboarding restaurateur (décision v2 §5) : trois étapes distinctes, jamais mélangées dans un même
// formulaire. 1. l'établissement (page /restaurant), 2. le premier événement (ici, en brouillon),
// 3. l'abonnement pour pouvoir le soumettre et le mettre en ligne. Tant que la demande n'est pas
// examinée, tout reste présenté comme « en attente de validation » : rien n'annonce qu'un paiement
// entraînerait une validation.
type Onboarding = { restaurantStatus: string; draft: any | null; subscriptionStatus: string | null };

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Votre établissement", "Votre premier événement", "Votre abonnement"];
  return <ol className="onboarding-steps" aria-label="Étapes">{steps.map((label, i) => {
    const n = (i + 1) as 1 | 2 | 3;
    return <li key={label} className={n < current ? "done" : n === current ? "current" : undefined} aria-current={n === current ? "step" : undefined}>
      <span className="onboarding-step-num" aria-hidden="true">{n < current ? <Check size={16} /> : n}</span>{label}
    </li>;
  })}</ol>;
}

export function RestaurantOnboarding() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<Onboarding | null | undefined>(undefined);
  const [form, setForm] = useState<EventFormState>(emptyEventForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const load = () => api<Onboarding>("/restaurants/me/onboarding")
    .then(o => { setState(o); if (o.draft) setForm(eventToForm(o.draft)); })
    .catch(() => setState(null));
  useEffect(() => { load(); }, []);

  if (state === undefined) return <Layout><Loading /></Layout>;
  if (state === null || state.restaurantStatus !== "PENDING") return <Navigate to="/restaurant" replace />;
  const editing = searchParams.get("etape") === "evenement";
  const step: 2 | 3 = state.draft && !editing ? 3 : 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSubmitting(true); setError("");
    try {
      await api("/restaurants/me/onboarding-event", { method: state.draft ? "PUT" : "POST", body: JSON.stringify(eventFormPayload(form)) });
      setSearchParams({}, { replace: true });
      await load();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { setError((err as Error).message); }
    finally { setSubmitting(false); }
  };

  return <Layout><section className="page onboarding">
    <Steps current={step} />
    <p className="onboarding-status">Restaurant en attente de validation.</p>
    {step === 2 ? <>
      <h1>{state.draft ? "Modifier votre premier événement" : "Créez votre premier événement"}</h1>
      <p className="page-lead">Préparez-le dès maintenant : il reste en brouillon, rien n’est publié à cette étape.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <EventForm form={form} setForm={setForm} submitting={submitting} submitLabel={state.draft ? "Enregistrer mon événement" : "Enregistrer mon premier événement"} onSubmit={submit}>
        <p className="fine wide">Vous pourrez ajouter les photos de la soirée, les quotas et les tarifs après la validation de votre établissement.</p>
      </EventForm>
    </> : <>
      <h1>Votre premier événement est prêt.</h1>
      <p className="page-lead">Choisissez maintenant votre abonnement pour pouvoir le soumettre et le mettre en ligne.</p>
      <div className="panel onboarding-draft">
        <div><b>{state.draft.title}</b><span>{dateTime(state.draft.startsAt)} · {state.draft.district} · {state.draft.priceCents === 0 ? "Gratuit" : money(state.draft.priceCents)} · {state.draft.capacity} places</span></div>
        <Link className="button secondary small" to="/restaurant/premier-evenement?etape=evenement">Modifier</Link>
      </div>
      <RestaurantSubscriptionPanel onChanged={load} />
    </>}
  </section></Layout>;
}
