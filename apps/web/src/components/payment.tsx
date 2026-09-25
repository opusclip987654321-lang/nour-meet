import { X } from "lucide-react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, setToken } from "../api";
import { money } from "../lib/format";
import { getStripe } from "../lib/stripe";
import { Notice } from "./ui";

function PaymentForm({ amountCents, onSuccess, onCancel }: { amountCents: number; onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setError("");
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (confirmError) { setError(confirmError.message ?? "Le paiement a été refusé."); setSubmitting(false); return; }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) { onSuccess(); return; }
    setError("Le paiement n’a pas pu être confirmé."); setSubmitting(false);
  };
  return <form onSubmit={submit} className="payment-form">
    <PaymentElement/>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="payment-actions">
      <button type="button" className="button secondary" onClick={onCancel} disabled={submitting}>Annuler</button>
      <button type="submit" className="button" disabled={!stripe || submitting}>{submitting?"Traitement…":`Payer ${money(amountCents)}`}</button>
    </div>
  </form>;
}

export function PaymentModal({ applicationId, eventId, amountCents: announcedCents, onClose, onConfirmed, onWaitlisted }: { applicationId: string; eventId: string; amountCents: number; onClose: () => void; onConfirmed: () => void; onWaitlisted: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"terms" | "loading" | "ready" | "confirming" | "success" | "timeout" | "notBookable">("terms");
  const [acceptCgv, setAcceptCgv] = useState(false);
  // Le montant renvoyé à la création du paiement fait foi : c'est celui que Stripe débitera.
  const [amountCents, setAmountCents] = useState(announcedCents);
  const free = amountCents === 0;

  // CGV A3 : la réservation n'est ferme qu'après acceptation des CGV — étape obligatoire avant tout
  // appel à l'API, y compris pour une soirée gratuite (qui passe donc aussi par cette fenêtre).
  // Ne garantit jamais une place avant cet appel précis (§5) : c'est ici, et seulement ici, qu'un
  // verrou technique court est posé — si la place vient d'être prise entre l'inscription et cet
  // instant, la personne rejoint automatiquement la liste d'attente plutôt que d'échouer sans suite.
  const acceptAndContinue = () => {
    setError(""); setPhase("loading");
    api<{ clientSecret?: string; free?: boolean; confirmed?: boolean; amountCents?: number }>(`/applications/${applicationId}/payment-intent`, { method: "POST", body: JSON.stringify({ acceptCgv: true }) })
      .then(r => {
        if (typeof r.amountCents === "number") setAmountCents(r.amountCents);
        if (r.free) { setPhase("success"); setTimeout(onConfirmed, 1200); return; }
        setClientSecret(r.clientSecret!); setPhase("ready");
      })
      .catch((err: any) => {
        if (err?.waitlisted) { onWaitlisted(); onClose(); return; }
        // §8 (corrections web 2026-09-24) : événement non réservable, refusé par l'API avant toute
        // transaction — message dédié plutôt qu'une erreur de paiement générique.
        if (err?.notBookable) { setError(""); setPhase("notBookable"); return; }
        setError((err as Error).message); setPhase("terms");
      });
  };

  const handleSuccess = async () => {
    setPhase("confirming");
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const application = await api<any>(`/events/${eventId}/my-application`);
        if (application.status === "CONFIRMED") { setPhase("success"); setTimeout(onConfirmed, 1200); return; }
      } catch { /* on retente */ }
    }
    setPhase("timeout");
  };

  return <div className="modal-overlay" role="dialog" aria-modal="true">
    <div className="modal payment-modal">
      <div className="modal-head"><h2>{free ? "Confirmer ma place" : "Paiement sécurisé"}</h2><button type="button" className="link-button" onClick={onClose} aria-label="Fermer"><X size={22} aria-hidden="true"/></button></div>
      <p className="payment-amount">{free ? <>Soirée <b>gratuite</b></> : <>Montant à régler : <b>{money(amountCents)}</b> TTC, frais inclus</>}</p>
      {error && <Notice kind="error">{error}</Notice>}
      {phase === "terms" && <div className="stack">
        <ul className="fine left" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Annulation gratuite jusqu’à 24 heures avant le début de l’événement{free ? "" : ", avec remboursement intégral"}.</li>
          <li>{free ? "Passé ce délai, merci de prévenir si vous ne pouvez pas venir." : "À 24 heures ou moins, ou en cas d’absence, aucun remboursement."}</li>
          {!free && <li>Billet pour une date déterminée : pas de délai légal de rétractation (art. L.221-28 du Code de la consommation).</li>}
        </ul>
        <label className="consent-check"><input type="checkbox" checked={acceptCgv} onChange={e => setAcceptCgv(e.target.checked)}/> <span>J’ai lu et j’accepte les <Link to="/legal/cgv" target="_blank">conditions générales de vente</Link>, notamment la politique d’annulation.</span></label>
        <div className="decision-buttons">
          <button type="button" className="button secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="button" disabled={!acceptCgv} onClick={acceptAndContinue}>{free ? "Confirmer ma place" : "Continuer vers le paiement"}</button>
        </div>
      </div>}
      {phase === "loading" && <div className="calendar-state"><div className="spinner small"/><span>{free ? "Confirmation de votre place…" : "Chargement du module de paiement…"}</span></div>}
      {phase === "confirming" && <div className="calendar-state"><div className="spinner small"/><span>Confirmation du paiement…</span></div>}
      {phase === "success" && <Notice kind="success">{free ? "Place confirmée ! Votre billet est prêt." : "Paiement confirmé ! Votre billet est prêt."}</Notice>}
      {phase === "notBookable" && <div className="stack">
        <Notice kind="info">Cet événement n’est actuellement pas réservable. Aucun paiement n’a été effectué.</Notice>
        <div className="decision-buttons"><Link className="button" to="/events" onClick={onClose}>Voir les autres soirées</Link><button type="button" className="button secondary" onClick={onClose}>Fermer</button></div>
      </div>}
      {phase === "timeout" && <><Notice kind="error">Le paiement est en cours de confirmation. Actualisez la page dans un instant.</Notice><button className="button full" onClick={onClose}>Fermer</button></>}
      {phase === "ready" && clientSecret && <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#1c2653", colorText: "#15171c", colorDanger: "#b3261e", borderRadius: "8px", fontSizeBase: "16px" } } }}>
        <PaymentForm amountCents={amountCents} onSuccess={handleSuccess} onCancel={onClose}/>
      </Elements>}
    </div>
  </div>;
}

// Page de paiement autonome ouverte depuis l'app mobile dans un navigateur intégré (expo-web-
// browser) : Stripe n'a pas de module natif installable dans Expo Go (seuls les modules Expo
// officiels le sont, pas les SDK tiers), donc plutôt que de dupliquer PaymentModal en React Native
// et de forcer un client de développement natif, le mobile réutilise ici la page web déjà testée.
// L'authentification se fait par un jeton passé en paramètre d'URL (le mobile n'a pas de cookie ou
// de localStorage partagé avec le navigateur web) : il est stocké avant tout appel à l'API, jamais
// après, pour éviter toute course avec PaymentModal ci-dessus qui lit le jeton dès son montage.
// Cahier des charges consolidé final (2026-09-20, section 9.2) : la page n'accepte plus le jeton de
// session (30 jours) directement dans l'URL — seulement un jeton de paiement opaque, à usage unique
// et de courte durée, échangé ici contre un vrai jeton de session éphémère (voir
// POST /auth/payment-session-exchange). Jamais stocké ni journalisé tel quel.
export function PayStandalone(){
  const { applicationId } = useParams();
  const [searchParams] = useSearchParams();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [eventId, setEventId] = useState("");
  // Le jeton est à usage unique : l'échange ne doit partir qu'une fois, même si l'effet est rejoué
  // (mode strict de React en développement, remontage) — un second appel serait refusé.
  const exchangeStarted = useRef(false);
  useEffect(() => {
    if (exchangeStarted.current) return;
    exchangeStarted.current = true;
    const session = searchParams.get("session");
    if (!session) { setError(true); setReady(true); return; }
    api<{ token: string }>("/auth/payment-session-exchange", { method: "POST", body: JSON.stringify({ token: session }) })
      // Montant relu auprès du serveur, jamais depuis l'URL : un paramètre absent affichait « gratuite ».
      .then(r => { setToken(r.token); return api<{ amountCents: number; eventId: string }>(`/me/applications/${applicationId}/amount`); })
      .then(a => { setAmountCents(a.amountCents); setEventId(a.eventId); setReady(true); })
      .catch(() => { setError(true); setReady(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jeton à usage unique : échangé une seule fois au montage
  }, []);
  if (!ready) return <div className="state-page"><div className="spinner"/></div>;
  if (error) return <div className="state-page"><h2>Lien de paiement invalide ou expiré.</h2><p>Retournez dans l’application et réessayez.</p></div>;
  if (done) return <div className="state-page"><h2>C’est terminé ici.</h2><p>Vous pouvez fermer cette fenêtre et retourner dans l’application Nūr Meet.</p></div>;
  return <div style={{ minHeight: "100dvh", background: "var(--canvas)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <PaymentModal applicationId={applicationId!} eventId={eventId} amountCents={amountCents!} onClose={() => setDone(true)} onConfirmed={() => setDone(true)} onWaitlisted={() => setDone(true)}/>
  </div>;
}
