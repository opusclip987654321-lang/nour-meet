import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { BarChart3, Bell, CalendarClock, CalendarPlus, ChevronDown, CreditCard, ExternalLink, FileText, Flag, LayoutDashboard, Mail, MessageSquareQuote, PartyPopper, QrCode, Settings, Store, UserCheck, Users, UsersRound, Wallet } from "lucide-react";

// C35 : jamais de mention "mis à jour maintenant" statique — trompeur pour une période choisie
// par l'admin (ex. "cette année"), qui n'a rien à voir avec l'instant présent.
export function Stat({label,value}:{label:string;value:ReactNode}){return <div className="stat"><small>{label}</small><strong>{value}</strong></div>}

// Navigation d'administration : colonne latérale sur grand écran ; sur tablette et mobile, un
// menu déroulant compact (bouton « section courante ») — 17 entrées ne tiennent ni dans une barre
// d'onglets ni dans une colonne, et un défilement horizontal les rendrait introuvables.
export function AdminNav(){
  const {user}=useAuth(); const role=user?.role;
  const manages = role==="ADMIN"||role==="ORGANIZER";
  const [unread,setUnread]=useState(0);
  const [open,setOpen]=useState(false);
  const [searchParams]=useSearchParams();
  const location=useLocation();
  useEffect(()=>{if(role==="ORGANIZER")api<{count:number}>("/notifications/unread-count").then(r=>setUnread(r.count)).catch(()=>{})},[role]);
  useEffect(()=>setOpen(false),[location.pathname,location.search]);
  // Deux liens partagent le même chemin ("/restaurant") avec un ?tab= différent : NavLink ne
  // distingue pas les search params (bug identique à C18 sinon), donc l'état actif se calcule ici.
  const onRestaurant=location.pathname==="/restaurant";
  const restaurantTab=searchParams.get("tab");
  const items:{to:string;label:string;icon:ReactNode;show:boolean;end?:boolean;active?:boolean;count?:number;plain?:boolean}[]=[
    {to:"/admin",label:"Vue générale",icon:<LayoutDashboard size={18}/>,show:manages,end:true},
    {to:"/admin/applications",label:"Entretiens",icon:<UserCheck size={18}/>,show:role==="ADMIN"},
    {to:"/admin/availability",label:"Agenda",icon:<CalendarClock size={18}/>,show:role==="ADMIN"},
    {to:"/admin/events/new",label:"Créer une soirée",icon:<CalendarPlus size={18}/>,show:manages,end:true},
    {to:"/admin/events",label:"Mes événements",icon:<PartyPopper size={18}/>,show:manages,end:true},
    {to:"/admin/attendees",label:"Participants",icon:<Users size={18}/>,show:manages},
    {to:"/admin/finance",label:"Finances",icon:<Wallet size={18}/>,show:manages},
    {to:"/admin/staff",label:"Personnel d’accueil",icon:<UsersRound size={18}/>,show:manages},
    {to:"/restaurant?tab=subscription",label:"Abonnement",icon:<CreditCard size={18}/>,show:role==="ORGANIZER",plain:true,active:onRestaurant&&restaurantTab==="subscription"},
    {to:"/restaurant?tab=notifications",label:"Notifications",icon:<Bell size={18}/>,show:role==="ORGANIZER",plain:true,active:onRestaurant&&restaurantTab==="notifications",count:unread},
    {to:"/admin/scanner",label:"Scanner les billets",icon:<QrCode size={18}/>,show:true},
    {to:"/admin/restaurants",label:"Demandes restaurateurs",icon:<Store size={18}/>,show:role==="ADMIN"},
    {to:"/admin/stats",label:"Statistiques",icon:<BarChart3 size={18}/>,show:role==="ADMIN"},
    {to:"/admin/moderation",label:"Modération",icon:<Flag size={18}/>,show:role==="ADMIN"||role==="MODERATOR"},
    {to:"/admin/outbox",label:"Messages envoyés",icon:<Mail size={18}/>,show:role==="ADMIN"},
    {to:"/admin/testimonials",label:"Témoignages",icon:<MessageSquareQuote size={18}/>,show:role==="ADMIN"},
    {to:"/admin/blog",label:"Blog",icon:<FileText size={18}/>,show:role==="ADMIN"},
    {to:"/admin/settings",label:"Paramètres",icon:<Settings size={18}/>,show:role==="ADMIN"}
  ].filter(i=>i.show);
  const current=items.find(i=>i.plain?i.active:(i.end?location.pathname===i.to:location.pathname.startsWith(i.to)))?.label??"Administration";
  return <aside className={`admin-nav${open?" open":""}`} aria-label="Administration">
    <button type="button" className="admin-nav-toggle" aria-expanded={open} onClick={()=>setOpen(o=>!o)}><span>{current}</span><ChevronDown size={18} aria-hidden="true"/></button>
    <div className="admin-nav-links">
      {items.map(i=>i.plain
        ?<Link key={i.to} className={i.active?"active":undefined} to={i.to}>{i.icon}{i.label}{i.count?<span className="nav-count" aria-label={`${i.count} non lues`}>{i.count}</span>:null}</Link>
        :<NavLink key={i.to} end={i.end} to={i.to}>{i.icon}{i.label}</NavLink>)}
      <Link to="/"><ExternalLink size={18}/>Voir le site public</Link>
    </div>
  </aside>;
}
