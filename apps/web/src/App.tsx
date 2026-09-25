import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { reloadOnceForNewVersion } from "./lib/new-version";
import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { Layout } from "./components/Layout";
import { Protected } from "./components/Protected";
import { ArticlePage, Blog } from "./pages/Blog";
import { EventDetail } from "./pages/EventDetail";
import { Events } from "./pages/Events";
import { Concept, Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";

// Espaces séparés (décision du 2026-09-25) : /admin pour la seule équipe Nūr Meet, /restaurant/…
// pour le restaurateur (mêmes écrans que l'administration, restreints à son établissement par
// l'API), /scanner pour le personnel d'accueil. Voir lib/spaces.ts.
// Découpage par route : l'accueil, le catalogue et les fiches restent dans le lot initial ;
// espaces connectés, administration, paiement et textes juridiques se chargent à la demande.
// Chargement d'une page échoué (fichier d'une version précédente, voir lib/new-version.ts) : on
// recharge une fois ; la promesse reste alors en attente pour ne rien afficher de cassé entre-temps.
const lazyNamed = <T extends Record<string, any>>(load: () => Promise<T>, name: keyof T) => lazy(() => load().then(m => ({ default: m[name] }), err => {
  if (reloadOnceForNewVersion()) return new Promise<never>(() => {});
  throw err;
}));
const PayStandalone = lazyNamed(() => import("./components/payment"), "PayStandalone");
const CGU = lazyNamed(() => import("./legal"), "CGU");
const CGV = lazyNamed(() => import("./legal"), "CGV");
const Confidentialite = lazyNamed(() => import("./legal"), "Confidentialite");
const Cookies = lazyNamed(() => import("./legal"), "Cookies");
const MentionsLegales = lazyNamed(() => import("./legal"), "MentionsLegales");
const Dashboard = lazyNamed(() => import("./pages/Dashboard"), "Dashboard");
const Admin = lazyNamed(() => import("./pages/admin/Admin"), "Admin");
const AdminArticleEditor = lazyNamed(() => import("./pages/admin/Blog"), "AdminArticleEditor");
const AdminBlog = lazyNamed(() => import("./pages/admin/Blog"), "AdminBlog");
const AdminOutbox = lazyNamed(() => import("./pages/admin/Content"), "AdminOutbox");
const AdminSettings = lazyNamed(() => import("./pages/admin/Content"), "AdminSettings");
const AdminTestimonials = lazyNamed(() => import("./pages/admin/Content"), "AdminTestimonials");
const AdminAttendees = lazyNamed(() => import("./pages/admin/Events"), "AdminAttendees");
const AdminCreateEvent = lazyNamed(() => import("./pages/admin/Events"), "AdminCreateEvent");
const AdminEventPhotos = lazyNamed(() => import("./pages/admin/Events"), "AdminEventPhotos");
const AdminFinance = lazyNamed(() => import("./pages/admin/Finance"), "AdminFinance");
const AdminAvailability = lazyNamed(() => import("./pages/admin/Interviews"), "AdminAvailability");
const AdminGlobalInterviews = lazyNamed(() => import("./pages/admin/Interviews"), "AdminGlobalInterviews");
const AdminRestaurants = lazyNamed(() => import("./pages/admin/Restaurants"), "AdminRestaurants");
const Scanner = lazyNamed(() => import("./pages/admin/Scanner"), "Scanner");
const AdminStats = lazyNamed(() => import("./pages/admin/Stats"), "AdminStats");
const AdminModeration = lazyNamed(() => import("./pages/admin/Team"), "AdminModeration");
const AdminStaff = lazyNamed(() => import("./pages/admin/Team"), "AdminStaff");
const RestaurantSpace = lazyNamed(() => import("./pages/restaurant"), "RestaurantSpace");
const MobileAuth = lazyNamed(() => import("./pages/MobileAuth"), "MobileAuth");
const NotificationsPage = lazyNamed(() => import("./pages/Notifications"), "NotificationsPage");

const RouteFallback = () => <div className="state-page" aria-busy="true"><div className="spinner"/></div>;

export function App(){return <ErrorBoundary><AuthProvider><Suspense fallback={<RouteFallback/>}><Routes><Route path="/" element={<Home/>}/><Route path="/events" element={<Events/>}/><Route path="/events/:id" element={<EventDetail/>}/><Route path="/concept" element={<Concept/>}/><Route path="/blog" element={<Blog/>}/><Route path="/blog/:id" element={<ArticlePage/>}/><Route path="/login" element={<Login/>}/><Route path="/legal/mentions-legales" element={<Layout><MentionsLegales/></Layout>}/><Route path="/legal/cgu" element={<Layout><CGU/></Layout>}/><Route path="/legal/cgv" element={<Layout><CGV/></Layout>}/><Route path="/legal/confidentialite" element={<Layout><Confidentialite/></Layout>}/><Route path="/legal/cookies" element={<Layout><Cookies/></Layout>}/><Route path="/pay/:applicationId" element={<PayStandalone/>}/><Route path="/auth/mobile" element={<MobileAuth/>}/><Route path="/notifications" element={<Protected><NotificationsPage/></Protected>}/><Route path="/dashboard" element={<Protected roles={["PARTICIPANT"]}><Dashboard/></Protected>}/><Route path="/restaurant" element={<Protected roles={["PARTICIPANT","ORGANIZER"]}><RestaurantSpace/></Protected>}/><Route path="/restaurant/tableau-de-bord" element={<Protected roles={["ORGANIZER"]}><Admin/></Protected>}/><Route path="/restaurant/soirees/nouvelle" element={<Protected roles={["ORGANIZER"]}><AdminCreateEvent/></Protected>}/><Route path="/restaurant/soirees" element={<Protected roles={["ORGANIZER"]}><AdminEventPhotos/></Protected>}/><Route path="/restaurant/participants" element={<Protected roles={["ORGANIZER"]}><AdminAttendees/></Protected>}/><Route path="/restaurant/personnel" element={<Protected roles={["ORGANIZER"]}><AdminStaff/></Protected>}/><Route path="/restaurant/scanner" element={<Protected roles={["ORGANIZER"]}><Scanner/></Protected>}/><Route path="/scanner" element={<Protected roles={["RECEPTION"]}><Scanner/></Protected>}/><Route path="/admin" element={<Protected roles={["ADMIN"]}><Admin/></Protected>}/><Route path="/admin/applications" element={<Protected roles={["ADMIN"]}><AdminGlobalInterviews/></Protected>}/><Route path="/admin/availability" element={<Protected roles={["ADMIN"]}><AdminAvailability/></Protected>}/><Route path="/admin/events/new" element={<Protected roles={["ADMIN"]}><AdminCreateEvent/></Protected>}/><Route path="/admin/events" element={<Protected roles={["ADMIN"]}><AdminEventPhotos/></Protected>}/><Route path="/admin/attendees" element={<Protected roles={["ADMIN"]}><AdminAttendees/></Protected>}/><Route path="/admin/finance" element={<Protected roles={["ADMIN"]}><AdminFinance/></Protected>}/><Route path="/admin/staff" element={<Protected roles={["ADMIN"]}><AdminStaff/></Protected>}/><Route path="/admin/moderation" element={<Protected roles={["ADMIN","MODERATOR"]}><AdminModeration/></Protected>}/><Route path="/admin/outbox" element={<Protected roles={["ADMIN"]}><AdminOutbox/></Protected>}/><Route path="/admin/settings" element={<Protected roles={["ADMIN"]}><AdminSettings/></Protected>}/><Route path="/admin/testimonials" element={<Protected roles={["ADMIN"]}><AdminTestimonials/></Protected>}/><Route path="/admin/blog" element={<Protected roles={["ADMIN"]}><AdminBlog/></Protected>}/><Route path="/admin/blog/:id" element={<Protected roles={["ADMIN"]}><AdminArticleEditor/></Protected>}/><Route path="/admin/restaurants" element={<Protected roles={["ADMIN"]}><AdminRestaurants/></Protected>}/><Route path="/admin/stats" element={<Protected roles={["ADMIN"]}><AdminStats/></Protected>}/><Route path="/admin/scanner" element={<Protected roles={["ADMIN"]}><Scanner/></Protected>}/><Route path="*" element={<NotFound/>}/></Routes></Suspense></AuthProvider></ErrorBoundary>}
