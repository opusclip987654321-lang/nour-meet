import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth";
import { spacePath } from "../../lib/spaces";
import { BarChart3, CalendarClock, CalendarPlus, ChevronDown, CreditCard, ExternalLink, FileText, Flag, LayoutDashboard, Mail, MessageSquareQuote, PartyPopper, QrCode, Settings, Store, UserCheck, Users, UsersRound, Wallet } from "lucide-react";

// C35 : jamais de mention "mis à jour maintenant" statique — trompeur pour une période choisie
// par l'admin (ex. "cette année"), qui n'a rien à voir avec l'instant présent.
export function Stat({label,value}:{label:string;value:ReactNode}){return <div className="stat"><small>{label}</small><strong>{value}</strong></div>}

// Navigation d'administration : colonne latérale sur grand écran ; sur tablette et mobile, un
// menu déroulant compact (bouton « section courante ») — 17 entrées ne tiennent ni dans une barre
// d'onglets ni dans une colonne, et un défilement horizontal les rendrait introuvables.
export function AdminNav(){
  const {user}=useAuth(); const role=user?.role;
  const [open,setOpen]=useState(false);
  const [searchParams]=useSearchParams();
  const location=useLocation();
  useEffect(()=>setOpen(false),[location.pathname,location.search]);
  // Deux liens partagent le même chemin ("/restaurant") avec un ?tab= différent : NavLink ne
  // distingue pas les search params (bug identique à C18 sinon), donc l'état actif se calcule ici.
  const onRestaurant=location.pathname==="/restaurant";
  const restaurantTab=searchParams.get("tab");
  type Item={to:string;label:string;icon:ReactNode;show:boolean;end?:boolean;active?:boolean;count?:number;plain?:boolean};
  // Décision du 2026-09-25 : deux espaces strictement séparés. Le restaurateur ne voit que les
  // sections de son établissement (sous /restaurant) ; l'équipe Nūr Meet, celles de l'administration.
  const restaurantItems:Item[]=[
    {to:spacePath(role,"overview"),label:"Tableau de bord",icon:<LayoutDashboard size={18}/>,show:true,end:true},
    {to:"/restaurant",label:"Mon établissement",icon:<Store size={18}/>,show:true,plain:true,active:onRestaurant&&restaurantTab!=="subscription"},
    {to:"/restaurant?tab=subscription",label:"Abonnement",icon:<CreditCard size={18}/>,show:true,plain:true,active:onRestaurant&&restaurantTab==="subscription"},
    {to:spacePath(role,"newEvent"),label:"Créer une soirée",icon:<CalendarPlus size={18}/>,show:true,end:true},
    {to:spacePath(role,"events"),label:"Mes soirées",icon:<PartyPopper size={18}/>,show:true,end:true},
    {to:spacePath(role,"attendees"),label:"Participants",icon:<Users size={18}/>,show:true},
    {to:spacePath(role,"staff"),label:"Personnel d’accueil",icon:<UsersRound size={18}/>,show:true},
    {to:spacePath(role,"scanner"),label:"Scanner les billets",icon:<QrCode size={18}/>,show:true}
  ];
  const adminItems:Item[]=[
    {to:"/admin",label:"Vue générale",icon:<LayoutDashboard size={18}/>,show:role==="ADMIN",end:true},
    {to:"/admin/applications",label:"Entretiens",icon:<UserCheck size={18}/>,show:role==="ADMIN"},
    {to:"/admin/availability",label:"Agenda",icon:<CalendarClock size={18}/>,show:role==="ADMIN"},
    {to:"/admin/events/new",label:"Créer une soirée",icon:<CalendarPlus size={18}/>,show:role==="ADMIN",end:true},
    {to:"/admin/events",label:"Événements",icon:<PartyPopper size={18}/>,show:role==="ADMIN",end:true},
    {to:"/admin/attendees",label:"Participants",icon:<Users size={18}/>,show:role==="ADMIN"},
    {to:"/admin/finance",label:"Finances",icon:<Wallet size={18}/>,show:role==="ADMIN"},
    {to:"/admin/staff",label:"Personnel d’accueil",icon:<UsersRound size={18}/>,show:role==="ADMIN"},
    {to:"/admin/scanner",label:"Scanner les billets",icon:<QrCode size={18}/>,show:role==="ADMIN"},
    {to:"/admin/restaurants",label:"Restaurateurs",icon:<Store size={18}/>,show:role==="ADMIN"},
    {to:"/admin/stats",label:"Statistiques",icon:<BarChart3 size={18}/>,show:role==="ADMIN"},
    {to:"/admin/moderation",label:"Modération",icon:<Flag size={18}/>,show:role==="ADMIN"||role==="MODERATOR"},
    {to:"/admin/outbox",label:"Messages envoyés",icon:<Mail size={18}/>,show:role==="ADMIN"},
    {to:"/admin/testimonials",label:"Témoignages",icon:<MessageSquareQuote size={18}/>,show:role==="ADMIN"},
    {to:"/admin/blog",label:"Blog",icon:<FileText size={18}/>,show:role==="ADMIN"},
    {to:"/admin/settings",label:"Paramètres",icon:<Settings size={18}/>,show:role==="ADMIN"}
  ];
  const receptionItems:Item[]=[{to:"/scanner",label:"Scanner les billets",icon:<QrCode size={18}/>,show:true}];
  const items=(role==="ORGANIZER"?restaurantItems:role==="RECEPTION"?receptionItems:adminItems).filter(i=>i.show);
  const current=items.find(i=>i.plain?i.active:(i.end?location.pathname===i.to:location.pathname.startsWith(i.to)))?.label??(role==="ORGANIZER"?"Mon établissement":"Administration");
  return <aside className={`admin-nav${open?" open":""}`} aria-label={role==="ORGANIZER"?"Espace restaurateur":"Administration"}>
    <button type="button" className="admin-nav-toggle" aria-expanded={open} onClick={()=>setOpen(o=>!o)}><span>{current}</span><ChevronDown size={18} aria-hidden="true"/></button>
    <div className="admin-nav-links">
      {items.map(i=>i.plain
        ?<Link key={i.to} className={i.active?"active":undefined} to={i.to}>{i.icon}{i.label}{i.count?<span className="nav-count" aria-label={`${i.count} non lues`}>{i.count}</span>:null}</Link>
        :<NavLink key={i.to} end={i.end} to={i.to}>{i.icon}{i.label}</NavLink>)}
      <Link to="/"><ExternalLink size={18}/>Voir le site public</Link>
    </div>
  </aside>;
}
