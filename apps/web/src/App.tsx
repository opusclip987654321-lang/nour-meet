import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { Layout } from "./components/Layout";
import { Protected } from "./components/Protected";
import { PayStandalone } from "./components/payment";
import { CGU, CGV, Confidentialite, Cookies, MentionsLegales } from "./legal";
import { ArticlePage, Blog } from "./pages/Blog";
import { Dashboard } from "./pages/Dashboard";
import { EventDetail } from "./pages/EventDetail";
import { Events } from "./pages/Events";
import { Concept, Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Admin } from "./pages/admin/Admin";
import { AdminArticleEditor, AdminBlog } from "./pages/admin/Blog";
import { AdminOutbox, AdminSettings, AdminTestimonials } from "./pages/admin/Content";
import { AdminAttendees, AdminCreateEvent, AdminEventPhotos } from "./pages/admin/Events";
import { AdminFinance } from "./pages/admin/Finance";
import { AdminAvailability, AdminGlobalInterviews } from "./pages/admin/Interviews";
import { AdminRestaurants } from "./pages/admin/Restaurants";
import { Scanner } from "./pages/admin/Scanner";
import { AdminStats } from "./pages/admin/Stats";
import { AdminModeration, AdminStaff } from "./pages/admin/Team";
import { RestaurantSpace } from "./pages/restaurant";

export function App(){return <AuthProvider><Routes><Route path="/" element={<Home/>}/><Route path="/events" element={<Events/>}/><Route path="/events/:id" element={<EventDetail/>}/><Route path="/concept" element={<Concept/>}/><Route path="/blog" element={<Blog/>}/><Route path="/blog/:id" element={<ArticlePage/>}/><Route path="/login" element={<Login/>}/><Route path="/legal/mentions-legales" element={<Layout><MentionsLegales/></Layout>}/><Route path="/legal/cgu" element={<Layout><CGU/></Layout>}/><Route path="/legal/cgv" element={<Layout><CGV/></Layout>}/><Route path="/legal/confidentialite" element={<Layout><Confidentialite/></Layout>}/><Route path="/legal/cookies" element={<Layout><Cookies/></Layout>}/><Route path="/pay/:applicationId" element={<PayStandalone/>}/><Route path="/dashboard" element={<Protected roles={["PARTICIPANT"]}><Dashboard/></Protected>}/><Route path="/restaurant" element={<Protected roles={["PARTICIPANT","ORGANIZER"]}><RestaurantSpace/></Protected>}/><Route path="/admin" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION","MODERATOR"]}><Admin/></Protected>}/><Route path="/admin/applications" element={<Protected roles={["ADMIN"]}><AdminGlobalInterviews/></Protected>}/><Route path="/admin/availability" element={<Protected roles={["ADMIN"]}><AdminAvailability/></Protected>}/><Route path="/admin/events/new" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminCreateEvent/></Protected>}/><Route path="/admin/events" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminEventPhotos/></Protected>}/><Route path="/admin/attendees" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminAttendees/></Protected>}/><Route path="/admin/finance" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminFinance/></Protected>}/><Route path="/admin/staff" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminStaff/></Protected>}/><Route path="/admin/moderation" element={<Protected roles={["ADMIN","MODERATOR"]}><AdminModeration/></Protected>}/><Route path="/admin/outbox" element={<Protected roles={["ADMIN"]}><AdminOutbox/></Protected>}/><Route path="/admin/settings" element={<Protected roles={["ADMIN"]}><AdminSettings/></Protected>}/><Route path="/admin/testimonials" element={<Protected roles={["ADMIN"]}><AdminTestimonials/></Protected>}/><Route path="/admin/blog" element={<Protected roles={["ADMIN"]}><AdminBlog/></Protected>}/><Route path="/admin/blog/:id" element={<Protected roles={["ADMIN"]}><AdminArticleEditor/></Protected>}/><Route path="/admin/restaurants" element={<Protected roles={["ADMIN"]}><AdminRestaurants/></Protected>}/><Route path="/admin/stats" element={<Protected roles={["ADMIN"]}><AdminStats/></Protected>}/><Route path="/admin/scanner" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION"]}><Scanner/></Protected>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AuthProvider>}
