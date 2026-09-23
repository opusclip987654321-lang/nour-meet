

export type Tab="home"|"events"|"scan"|"messages"|"profile"|"concept"|"blog";

// "Mon espace" (parité avec le dashboard participant du site web, voir Dashboard() dans
// apps/web/src/App.tsx) : un hub avec ses propres sous-onglets plutôt que cinq entrées de plus dans
// la barre de navigation globale (déjà pleine), la même structure que la sidebar web.
export type EspaceTab="interview"|"reservations"|"tickets"|"profile"|"notifications";
