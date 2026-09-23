import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Logo } from "../../components/ui";

// C35 : jamais de mention "mis à jour maintenant" statique — trompeur pour une période choisie
// par l'admin (ex. "cette année"), qui n'a rien à voir avec l'instant présent.
export function Stat({label,value}:{label:string;value:ReactNode}){return <div className="stat"><small>{label.toUpperCase()}</small><strong>{value}</strong></div>}
export function AdminNav(){
  const {user}=useAuth(); const role=user?.role;
  const manages = role==="ADMIN"||role==="ORGANIZER";
  const [unread,setUnread]=useState(0);
  const [searchParams]=useSearchParams();
  const location=useLocation();
  useEffect(()=>{if(role==="ORGANIZER")api<{count:number}>("/notifications/unread-count").then(r=>setUnread(r.count)).catch(()=>{})},[role]);
  // Deux liens partagent le même chemin ("/restaurant") avec un ?tab= différent : NavLink ne
  // distingue pas les search params (bug identique à C18 sinon), donc l'état actif se calcule ici.
  const onRestaurant=location.pathname==="/restaurant";
  const restaurantTab=searchParams.get("tab");
  return <aside className="admin-nav"><Logo/>
    {manages&&<NavLink end to="/admin">Vue générale</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/applications">Entretiens</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/availability">Agenda</NavLink>}
    {manages&&<NavLink end to="/admin/events/new">Créer une soirée</NavLink>}
    {manages&&<NavLink end to="/admin/events">Mes événements</NavLink>}
    {manages&&<NavLink to="/admin/attendees">Participants</NavLink>}
    {manages&&<NavLink to="/admin/finance">Finances</NavLink>}
    {manages&&<NavLink to="/admin/staff">Personnel d’accueil</NavLink>}
    {role==="ORGANIZER"&&<Link className={onRestaurant&&restaurantTab==="subscription"?"active":undefined} to="/restaurant?tab=subscription">Abonnement</Link>}
    {role==="ORGANIZER"&&<Link className={onRestaurant&&restaurantTab==="notifications"?"active":undefined} to="/restaurant?tab=notifications">🔔 Notifications{unread>0?` (${unread})`:""}</Link>}
    <NavLink to="/admin/scanner">Scanner les billets</NavLink>
    {role==="ADMIN"&&<NavLink to="/admin/restaurants">Demandes restaurateurs</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/stats">Statistiques</NavLink>}
    {(role==="ADMIN"||role==="MODERATOR")&&<NavLink to="/admin/moderation">Modération</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/outbox">Notifications</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/testimonials">Témoignages</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/blog">Blog</NavLink>}
    {role==="ADMIN"&&<NavLink to="/admin/settings">Paramètres</NavLink>}
    <Link to="/">Voir le site public</Link>
  </aside>;
}
