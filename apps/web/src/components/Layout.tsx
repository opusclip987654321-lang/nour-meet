import { ReactNode, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { api } from "../api";
import { STAFF_ROLES, useAuth } from "../auth";
import { CGU, CGV, Cookies } from "../legal";
import { Logo } from "./ui";

function Header() {
  const { user, logout } = useAuth();
  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  return <header className="site-header"><Logo/><nav>{isStaff?<><NavLink to="/admin">Administration</NavLink><NavLink to="/">Voir le site public</NavLink></>:<><NavLink to="/">Accueil</NavLink><NavLink to="/events">Événements</NavLink><NavLink to="/concept">Le concept</NavLink><NavLink to="/blog">Blog</NavLink>{user && (user.hasRestaurant ? <NavLink to="/restaurant">Mon établissement</NavLink> : <NavLink to="/dashboard">Mon espace</NavLink>)}</>}</nav><div className="header-actions">{user ? <><span className="member-name">{user.displayName}</span><button className="link-button" onClick={logout}>Déconnexion</button></> : <Link className="button small" to="/login">Se connecter</Link>}</div></header>;
}
// C32-C34 (ordre correctif 2026-09-20) : un identifiant anonyme aléatoire (jamais une empreinte
// technique), posé une seule fois côté navigateur — le serveur n'écrit rien tant que
// ANALYTICS_ENABLED est désactivé (défaut), donc cet appel est sans effet hors activation explicite.
// utm_* n'est capturé qu'une fois par session (sessionStorage), pour attribuer toute la visite à sa
// source d'origine même après plusieurs pages vues sans paramètres dans l'URL.
const trackPageview = (path: string) => {
  try {
    let anonId = localStorage.getItem("nour_anon_id");
    if (!anonId) { anonId = crypto.randomUUID(); localStorage.setItem("nour_anon_id", anonId); }
    let utm = sessionStorage.getItem("nour_utm");
    if (utm === null) {
      const params = new URLSearchParams(window.location.search);
      const captured = { utmSource: params.get("utm_source"), utmMedium: params.get("utm_medium"), utmCampaign: params.get("utm_campaign") };
      utm = JSON.stringify(captured);
      sessionStorage.setItem("nour_utm", utm);
    }
    let referrerHost: string | null = null;
    try { referrerHost = document.referrer ? new URL(document.referrer).hostname : null; } catch { /* referrer illisible : ignoré */ }
    api("/analytics/pageview", { method: "POST", body: JSON.stringify({ path, anonId, referrerHost, ...JSON.parse(utm) }) }).catch(() => {});
  } catch { /* stockage navigateur indisponible (navigation privée...) : la mesure d'audience s'efface, jamais la page */ }
};
export function Layout({ children }: {children: ReactNode}) {
  const location=useLocation();
  useEffect(()=>{trackPageview(location.pathname)},[location.pathname]);
  return <><Header/><main>{children}</main><footer><Logo/><p>Paris et Île-de-France · Expérience privée · Données protégées</p><nav style={{ display: "flex", gap: 16 }}><Link to="/legal/mentions-legales">Mentions légales</Link><Link to="/legal/cgu">CGU</Link><Link to="/legal/cgv">CGV</Link><Link to="/legal/confidentialite">Confidentialité</Link><Link to="/legal/cookies">Cookies</Link></nav></footer></>;
}
