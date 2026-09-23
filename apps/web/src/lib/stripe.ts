import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";

// Stripe.js n'est chargé qu'au moment où un paiement s'ouvre (import « pure » : aucun script
// injecté à l'import du module). Avant, il l'était sur toutes les pages dès l'arrivée sur le site :
// un script tiers de plus à chaque chargement, et les traceurs anti-fraude de Stripe posés chez
// des visiteurs qui ne payaient rien.
let stripePromise: Promise<Stripe | null> | null = null;
export function getStripe() {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) return Promise.resolve(null);
  stripePromise ??= loadStripe(key);
  return stripePromise;
}
