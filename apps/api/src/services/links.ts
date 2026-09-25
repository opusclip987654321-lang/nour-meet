// Destinations des notifications (corrections web 2026-09-24, §4.3) : un seul endroit construit les
// chemins frontend vers l'objet métier concerné, pour que toutes les notifications d'un même type
// mènent au même écran. Le site web sait ouvrir et mettre en évidence chacune de ces cibles
// (voir apps/web/src/lib/notifications.ts et Dashboard.tsx).
export const links = {
  // Fiche publique d'un événement (place libérée, changement d'événement…).
  event: (slug: string) => `/events/${slug}`,
  // Carte d'une inscription précise dans l'espace participant (paiement à finaliser, liste d'attente,
  // remboursement, annulation, propositions de soirées similaires).
  reservation: (applicationId: string) => `/dashboard?tab=reservations&application=${applicationId}`,
  // Billet QR d'une réservation confirmée.
  ticket: (reservationId: string) => `/dashboard?tab=tickets&reservation=${reservationId}`,
  interview: () => "/dashboard?tab=interview",
  contacts: () => "/dashboard?tab=contacts",
  // Espace restaurateur et administration (comportement de référence déjà en place).
  subscription: () => "/restaurant?tab=subscription",
  restaurant: () => "/restaurant",
  adminEvent: (eventId: string) => `/admin/events?highlight=${eventId}`,
  // Décision du 2026-09-25 : le restaurateur n'a jamais de lien vers /admin, seulement vers son espace.
  restaurantEvent: (eventId: string) => `/restaurant/soirees?highlight=${eventId}`,
  receptionScanner: () => "/scanner"
};
