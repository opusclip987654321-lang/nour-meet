import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

// Prépare les formules d'abonnement restaurateur dans un compte Stripe en MODE TEST (corrections web
// 2026-09-24, §7) : crée si besoin un produit et deux prix (mensuel, annuel) par formule, retrouvés
// ensuite par leur lookup_key, puis enregistre leurs identifiants sur les lignes Plan de la base.
// Idempotent. Refuse toute clé qui n'est pas une clé de test : aucun vrai paiement possible.
// Usage : STRIPE_SECRET_KEY=sk_test_… DATABASE_URL=… npm run stripe:setup-test-plans -w @nour/api
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_")) {
  console.error("STRIPE_SECRET_KEY doit être une clé de TEST (sk_test_…). Abandon.");
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
  for (const plan of plans) {
    const slug = plan.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
    const found = await stripe.products.search({ query: `metadata['planId']:'${plan.id}'` }).catch(() => ({ data: [] as Stripe.Product[] }));
    const product = found.data[0] ?? await stripe.products.create({ name: `Nūr Meet ${plan.name}`, metadata: { planId: plan.id } });
    const monthly = await price(`nour_${slug}_monthly`, product.id, plan.monthlyPriceCents, "month");
    const annual = plan.annualPriceCents != null ? await price(`nour_${slug}_annual`, product.id, plan.annualPriceCents, "year") : null;
    await prisma.plan.update({ where: { id: plan.id }, data: { stripePriceMonthlyId: monthly, stripePriceAnnualId: annual } });
    console.log(`${plan.name} : mensuel ${monthly}${annual ? `, annuel ${annual}` : ""}`);
  }
}
main().finally(() => prisma.$disconnect());
