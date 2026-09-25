// Espaces par rôle (décision du 2026-09-25) : /admin appartient à la seule équipe Nūr Meet ;
// le restaurateur a tout son espace sous /restaurant (fiche, abonnement, soirées, participants,
// personnel, scanner) ; le personnel d'accueil n'a que le scanner. Les écrans partagés
// (création de soirée, participants…) sont les mêmes composants, montés sous deux chemins ; les
// permissions restent vérifiées par l'API.
export type SpaceSection = "overview" | "newEvent" | "events" | "attendees" | "staff" | "scanner";

const ADMIN_PATHS: Record<SpaceSection, string> = { overview: "/admin", newEvent: "/admin/events/new", events: "/admin/events", attendees: "/admin/attendees", staff: "/admin/staff", scanner: "/admin/scanner" };
const RESTAURANT_PATHS: Record<SpaceSection, string> = { overview: "/restaurant/tableau-de-bord", newEvent: "/restaurant/soirees/nouvelle", events: "/restaurant/soirees", attendees: "/restaurant/participants", staff: "/restaurant/personnel", scanner: "/restaurant/scanner" };

export const spacePath = (role: string | undefined, section: SpaceSection) =>
  role === "ORGANIZER" ? RESTAURANT_PATHS[section] : role === "RECEPTION" && section === "scanner" ? "/scanner" : ADMIN_PATHS[section];

export const homeFor = (user: { role: string; hasRestaurant?: boolean } | null | undefined) => {
  if (!user) return "/login";
  switch (user.role) {
    case "ADMIN": return "/admin";
    case "MODERATOR": return "/admin/moderation";
    case "ORGANIZER": return RESTAURANT_PATHS.overview;
    case "RECEPTION": return "/scanner";
    default: return user.hasRestaurant ? "/restaurant" : "/dashboard";
  }
};

// Ancien lien vers /admin (notification déjà envoyée, favori) ouvert par un restaurateur : la même
// section de son propre espace, paramètres de recherche conservés.
export const restaurantEquivalent = (adminPathWithSearch: string) => {
  const [path, search] = adminPathWithSearch.split("?");
  const section = (Object.keys(ADMIN_PATHS) as SpaceSection[]).find(k => ADMIN_PATHS[k] === path);
  return section ? `${RESTAURANT_PATHS[section]}${search ? `?${search}` : ""}` : RESTAURANT_PATHS.overview;
};
