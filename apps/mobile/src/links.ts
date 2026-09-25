// Navigation de l'application (2026-09-24) : les notifications et les articles portent des chemins du
// site (voir apps/api/src/services/links.ts). Une seule fonction les traduit en écran de l'application,
// pour que chaque lien mène au même objet que sur le web ; un chemin sans équivalent mobile s'ouvre
// dans le navigateur plutôt que de ne rien faire.
export type EspaceTab = "reservations" | "tickets" | "interview" | "profile";
export type RestaurantTab = "establishment" | "events" | "subscription";
export type Route =
  | { name: "home" }
  | { name: "events"; slug?: string; category?: string }
  | { name: "espace"; tab: EspaceTab; focus?: string }
  | { name: "messages" }
  | { name: "scan" }
  | { name: "notifications" }
  | { name: "restaurant"; tab: RestaurantTab; focus?: string }
  | { name: "blog"; slug?: string }
  | { name: "concept" }
  | { name: "web"; path: string };

export type Navigate = (route: Route | string) => void;

export function routeFromPath(path: string | null | undefined): Route {
  if (!path || !path.startsWith("/")) return { name: "home" };
  const [pathname, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean);
  switch (parts[0]) {
    case undefined: return { name: "home" };
    case "events": return parts[1] ? { name: "events", slug: parts[1] } : { name: "events", category: params.get("category") ?? undefined };
    case "blog": return parts[1] ? { name: "blog", slug: parts[1] } : { name: "blog" };
    case "concept": return { name: "concept" };
    case "notifications": return { name: "notifications" };
    // Espace restaurateur du site (décision du 2026-09-25) : /restaurant/soirees et /participants
    // mènent à « Mes soirées », /restaurant/scanner au scanner, le reste à la fiche ou à l'abonnement.
    case "restaurant":
      if (parts[1] === "soirees" || parts[1] === "participants") return { name: "restaurant", tab: "events", focus: params.get("highlight") ?? undefined };
      if (parts[1] === "scanner") return { name: "scan" };
      if (parts[1]) return { name: "web", path };
      return { name: "restaurant", tab: params.get("tab") === "subscription" ? "subscription" : "establishment" };
    case "scanner": return { name: "scan" };
    // Soirées d'un restaurateur (création, validation, participants) : onglet « Mes soirées ».
    case "admin": return parts[1] === "events" || parts[1] === "attendees" ? { name: "restaurant", tab: "events", focus: params.get("highlight") ?? undefined } : { name: "web", path };
    case "dashboard": {
      const tab = params.get("tab");
      if (tab === "contacts") return { name: "messages" };
      if (tab === "tickets") return { name: "espace", tab: "tickets", focus: params.get("reservation") ?? undefined };
      if (tab === "interview" || tab === "profile") return { name: "espace", tab };
      return { name: "espace", tab: "reservations", focus: params.get("application") ?? undefined };
    }
    default: return { name: "web", path };
  }
}
