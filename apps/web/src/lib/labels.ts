// PAYMENT_PENDING : jamais « Acceptée » — le networking n'a aucune sélection ; le libellé dit seulement ce qui reste à faire.
export const APPLICATION_STATUS_LABEL: Record<string,string> = { PENDING_CALL: "En attente de choix d’un créneau", CALL_SCHEDULED: "Entretien programmé", CALL_COMPLETED: "Entretien réalisé", ACCEPTED: "Candidature acceptée", REFUSED: "Candidature refusée", PAYMENT_PENDING: "Paiement à finaliser", CONFIRMED: "Place confirmée", CANCELLED: "Annulée", NO_SHOW: "Absence à l’entretien" };
export const QUOTA_CATEGORY_LABEL: Record<string,string> = { HOMME: "Homme", FEMME: "Femme" };
export const EVENT_STATUS_LABEL: Record<string,string> = { DRAFT: "Brouillon", PENDING_REVIEW: "En attente de validation", PUBLISHED: "Publié", FULL: "Complet", CANCELLED: "Annulé", COMPLETED: "Terminé" };
export const RESTAURANT_STATUS_LABEL: Record<string,string> = { PENDING: "En attente", APPROVED: "Approuvé", REJECTED: "Refusé", SUSPENDED: "Suspendu" };

// Architecture éditoriale (instructions définitives 2026-09-20) : couvre explicitement les
// rencontres amoureuses, l'amitié, la solitude et le networking professionnel.
export const BLOG_CATEGORIES=["Rencontres amoureuses","Amitié","Solitude et vie sociale","Networking professionnel"];

export const SUBSCRIPTION_STATUS_LABEL:Record<string,string>={TRIALING:"Essai en cours",ACTIVE:"Actif",PAST_DUE:"Paiement en échec",CANCELLED:"Résilié",INCOMPLETE:"Incomplet"};
