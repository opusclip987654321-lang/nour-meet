

export const APPLICATION_STATUS_LABEL: Record<string,string> = { PENDING_CALL: "En attente de choix d’un créneau", CALL_SCHEDULED: "Entretien programmé", CALL_COMPLETED: "Entretien réalisé", ACCEPTED: "Candidature acceptée", REFUSED: "Candidature refusée", PAYMENT_PENDING: "Acceptée · paiement à finaliser", CONFIRMED: "Place confirmée", CANCELLED: "Annulée", NO_SHOW: "Absence à l’entretien" };

export const BLOG_CATEGORIES=["Rencontres amoureuses","Amitié","Solitude et vie sociale","Networking professionnel"];

// Accueil du personnel sans fiche restaurant (ADMIN/MODERATOR/RECEPTION) : un compte ORGANIZER passe
// par RestaurantSpace à la place (voir plus haut), pas par cet écran, pour ne pas dupliquer sa fiche
// établissement ni son bouton de déconnexion. Le reste du back-office (statistiques, finance,
// modération, CMS…) reste volontairement hors mobile : ce sont des outils denses pensés desktop,
// contrairement au scan de billet à l'entrée qui, lui, a toute sa place sur un téléphone.
export const ROLE_LABEL:Record<string,string>={ADMIN:"ADMINISTRATEUR",MODERATOR:"MODÉRATEUR",RECEPTION:"PERSONNEL D’ACCUEIL"};
