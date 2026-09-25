import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

// Passage de Stripe en mode RÉEL (production) : crée si besoin, dans le compte Stripe réel, un produit
// et deux prix (mensuel, annuel) par formule active, retrouvés ensuite par leur lookup_key, puis
// enregistre leurs identifiants sur les lignes Plan de la base de production — celles-ci pointaient
// jusqu'ici vers des prix du mode test, inexistants en mode réel. Idempotent : le relancer ne crée
// aucun doublon. Ne débite rien et ne touche à aucun client.
// À lancer SUR LE SERVEUR, dans le conteneur api, pour que la clé secrète ne quitte jamais le serveur :
//   docker compose -f docker-compose.prod.yml exec -e CONFIRMER_MODE_REEL=oui api npm run stripe:setup-live-plans
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_live_") && !key.startsWith("rk_live_")) {
  console.error("STRIPE_SECRET_KEY n'est pas une clé du mode réel (sk_live_…). Abandon : rien n'a été modifié.");
  process.exit(1);
}
if (process.env.CONFIRMER_MODE_REEL !== "oui") {
  console.error("Confirmation manquante : relancer avec CONFIRMER_MODE_REEL=oui. Abandon : rien n'a été modifié.");
  process.exit(1);
}
const stripe = new Stripe(key);
const prisma = new PrismaClient();

async function price(lookupKey: string, product: string, amount: number, interval: "month" | "year") {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0] && existing.data[0].unit_amount === amount) return existing.data[0].id;
  const created = await stripe.prices.create({ product, unit_amount: amount, currency: "eur", recurring: { interval }, lookup_key: lookupKey, transfer_lookup_key: true, tax_behavior: "exclusive" });
  return created.id;
}

async function main() {
  const plans = await prisma.plan.findMany({ where: { active: true } });
  if (plans.length === 0) { console.error("Aucune formule active en base. Abandon."); process.exit(1); }
  for (const plan of plans) {
    const slug = plan.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
    const found = await stripe.products.search({ query: `metadata['planId']:'${plan.id}'` }).catch(() => ({ data: [] as Stripe.Product[] }));
    const product = found.data[0] ?? await stripe.products.create({ name: `Nūr Meet ${plan.name}`, metadata: { planId: plan.id } });
    const monthly = await price(`nour_${slug}_monthly`, product.id, plan.monthlyPriceCents, "month");
    const annual = plan.annualPriceCents != null ? await price(`nour_${slug}_annual`, product.id, plan.annualPriceCents, "year") : null;
    await prisma.plan.update({ where: { id: plan.id }, data: { stripePriceMonthlyId: monthly, stripePriceAnnualId: annual } });
    console.log(`${plan.name} : ${(plan.monthlyPriceCents / 100).toFixed(2)} € HT/mois → ${monthly}${annual ? ` ; ${(plan.annualPriceCents! / 100).toFixed(2)} € HT/an → ${annual}` : ""}`);
  }
  // Abonnements souscrits en mode test : ils n'existent pas dans le compte réel. Signalés, jamais modifiés.
  const testSubscriptions = await prisma.restaurantSubscription.count({ where: { stripeSubscriptionId: { not: null } } });
  if (testSubscriptions > 0) console.log(`Attention : ${testSubscriptions} abonnement(s) enregistré(s) proviennent du mode test ; ils devront être résiliés ou recréés (voir PRODUCTION.md §5).`);
  console.log("Formules prêtes en mode réel.");
}
main().finally(() => prisma.$disconnect());
