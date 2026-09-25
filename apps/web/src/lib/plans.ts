import type { BillingPeriod } from "@nour/shared";

// Formules d'abonnement restaurateur, telles que renvoyées par GET /plans : partagées entre la page
// publique /restaurateurs (présentation) et l'espace restaurateur (souscription).
export type Plan = { id: string; name: string; monthlyPriceCents: number; annualPriceCents: number | null; monthlyEventQuota: number | null; highlightTier: "simple" | "priority" | null };

export const priceFor = (plan: Plan, period: BillingPeriod) => period === "ANNUAL" ? plan.annualPriceCents : plan.monthlyPriceCents;

// Lignes de comparaison : uniquement ce qui existe réellement dans le produit (quota appliqué à la
// publication, badge de mise en avant sur les fiches), jamais une promesse commerciale sans effet.
// Corrections web 2026-09-24 (§1.1) : plus de mention de mise en avant pour la formule Standard.
export const planFeatures = (plan: Plan): { label: string; included: boolean }[] => [
  { label: plan.monthlyEventQuota == null ? "Soirées publiées en illimité" : `${plan.monthlyEventQuota} soirées publiées par mois`, included: true },
  { label: "Billetterie, paiement en ligne et billets QR", included: true },
  { label: "Liste des participants et scan à l’entrée", included: true },
  { label: "Comptes pour votre personnel d’accueil", included: true },
  { label: "Mise en avant prioritaire des soirées et de l’établissement", included: plan.highlightTier === "priority" }
];
