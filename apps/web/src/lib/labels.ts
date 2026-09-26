// PAYMENT_PENDING : jamais « Acceptée » — le networking n'a aucune sélection ; le libellé dit seulement ce qui reste à faire.
export const APPLICATION_STATUS_LABEL: Record<string,string> = { PENDING_CALL: "En attente de choix d’un créneau", CALL_SCHEDULED: "Entretien programmé", CALL_COMPLETED: "Entretien réalisé", ACCEPTED: "Candidature acceptée", REFUSED: "Candidature refusée", PAYMENT_PENDING: "Paiement à finaliser", CONFIRMED: "Place confirmée", CANCELLED: "Annulée", NO_SHOW: "Absence à l’entretien" };
export const QUOTA_CATEGORY_LABEL: Record<string,string> = { HOMME: "Homme", FEMME: "Femme" };
export const EVENT_STATUS_LABEL: Record<string,string> = { DRAFT: "Brouillon", PENDING_REVIEW: "En attente de validation", PUBLISHED: "Publié", FULL: "Complet", CANCELLED: "Annulé", COMPLETED: "Terminé" };
// État de validation d'une soirée, dans les termes du restaurateur (v3 §6.4, §6.5) : un brouillon refusé
// avec un commentaire est « À modifier », jamais un refus définitif sans suite.
export type ValidationTone = "neutral" | "warning" | "info" | "success" | "danger";
export function eventValidation(ev: { status: string; reviewNote?: string | null; reviewedAt?: string | null }): { label: string; tone: ValidationTone } {
  if (ev.status === "DRAFT") return ev.reviewNote && ev.reviewedAt ? { label: "À modifier", tone: "warning" } : { label: "Brouillon", tone: "neutral" };
  if (ev.status === "PENDING_REVIEW") return { label: "En attente de validation", tone: "info" };
  if (ev.status === "CANCELLED") return { label: "Annulé", tone: "danger" };
  if (ev.status === "COMPLETED") return { label: "Terminé", tone: "neutral" };
  return { label: ev.status === "FULL" ? "Validé · complet" : "Validé", tone: "success" };
}
export const RESTAURANT_VALIDATION: Record<string, { label: string; tone: ValidationTone }> = { PENDING: { label: "En attente de validation", tone: "info" }, APPROVED: { label: "Validé", tone: "success" }, REJECTED: { label: "Refusé", tone: "danger" }, SUSPENDED: { label: "Suspendu", tone: "danger" } };
export const RESTAURANT_STATUS_LABEL: Record<string,string> = { PENDING: "En attente", APPROVED: "Approuvé", REJECTED: "Refusé", SUSPENDED: "Suspendu" };

// Architecture éditoriale (instructions définitives 2026-09-20) : couvre explicitement les
// rencontres amoureuses, l'amitié, la solitude et le networking professionnel.
export const BLOG_CATEGORIES=["Rencontres amoureuses","Amitié","Solitude et vie sociale","Networking professionnel"];

export const SUBSCRIPTION_STATUS_LABEL:Record<string,string>={TRIALING:"Essai en cours",ACTIVE:"Actif",PAST_DUE:"Paiement en échec",CANCELLED:"Résilié",INCOMPLETE:"Incomplet"};
