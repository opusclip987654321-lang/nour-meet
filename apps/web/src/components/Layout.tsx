import { ChevronRight, Menu, X } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { api } from "../api";
import { STAFF_ROLES, useAuth } from "../auth";
import { Logo } from "./brand";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { CookieConsent } from "./CookieConsent";
import { CONSENT_CHANGED, analyticsAllowed, openConsentSettings } from "../lib/consent";

// Navigation publique : 3 entrées seulement (au-delà, le menu devient une liste à lire plutôt qu'un
// repère). « Mon espace » ou « Mon établissement » selon le compte, l'administration pour l'équipe.
function useNavLinks() {
  const { user } = useAuth();
  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  const links: { to: string; label: string }[] = isStaff
    ? [{ to: "/admin", label: "Administration" }, { to: "/events", label: "Événements" }]
    : [{ to: "/events", label: "Événements" }, { to: "/concept", label: "Comment ça marche" }, { to: "/blog", label: "Le journal" }];
  const account = !user ? null : isStaff ? null : user.hasRestaurant ? { to: "/restaurant", label: "Mon établissement" } : { to: "/dashboard", label: "Mon espace" };
  return { user, links, account };
}

function Header() {
  const { logout } = useAuth();
  const { user, links, account } = useNavLinks();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Menu mobile : fermé à chaque changement de page, fermable au clavier (Échap), défilement du
  // fond bloqué pendant l'ouverture pour éviter que la page ne bouge derrière le panneau.
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("menu-open"); };
  }, [open]);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Logo />
        <nav className="site-nav" aria-label="Navigation principale">
          {links.map(l => <NavLink key={l.to} to={l.to} end={l.to === "/admin"}>{l.label}</NavLink>)}
          {account && <NavLink to={account.to}>{account.label}</NavLink>}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          {user ? (
            <>
              <NotificationBell />
              <span className="member-name" title={user.displayName}>{user.displayName}</span>
              <button className="button ghost small desktop-only" onClick={logout}>Se déconnecter</button>
            </>
          ) : (
            <>
              <Link className="button ghost small desktop-only" to="/login">Se connecter</Link>
              <Link className="button small desktop-only" to="/events">Voir les soirées</Link>
            </>
          )}
          <button ref={toggleRef} type="button" className="icon-button menu-toggle" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setOpen(o => !o)}>
            {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <nav id="mobile-menu" className="mobile-menu" hidden={!open} aria-label="Menu">
        {links.map(l => <NavLink key={l.to} to={l.to} end={l.to === "/admin"}>{l.label}<ChevronRight size={20} aria-hidden="true" /></NavLink>)}
        {account && <NavLink to={account.to}>{account.label}<ChevronRight size={20} aria-hidden="true" /></NavLink>}
        {user ? (
          <>
            <button type="button" className="menu-link" onClick={logout}>Se déconnecter</button>
            <p className="menu-meta">Connecté en tant que {user.displayName}</p>
          </>
        ) : (
          <>
            <Link className="button full" to="/events">Voir les prochaines soirées</Link>
            <Link className="button secondary full" to="/login">Se connecter</Link>
          </>
        )}
      </nav>
    </header>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  // Connecté : l'espace du compte (ou l'administration pour l'équipe), jamais « Créer un compte ».
  const { user, account } = useNavLinks();
  const accountLink = !user ? { to: "/login", label: "Créer un compte" } : account ?? { to: "/admin", label: "Administration" };
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <Logo onNight />
          <p>Des soirées en petit comité dans des restaurants partenaires à Paris et en Île-de-France : speed dating avec sélection, networking en accès direct.</p>
        </div>
        <nav aria-labelledby="footer-discover">
          <h2 id="footer-discover">Découvrir</h2>
          <ul>
            <li><Link to="/events">Prochaines soirées</Link></li>
            <li><Link to="/concept">Comment ça marche</Link></li>
            <li><Link to="/blog">Le journal</Link></li>
            <li><Link to={accountLink.to}>{accountLink.label}</Link></li>
          </ul>
        </nav>
        <nav aria-labelledby="footer-pros">
          <h2 id="footer-pros">Restaurateurs</h2>
          <ul>
            <li><Link to="/restaurant">Accueillir des soirées</Link></li>
            <li><Link to="/legal/cgv">Conditions professionnelles</Link></li>
          </ul>
        </nav>
        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal">Informations</h2>
          <ul>
            <li><Link to="/legal/mentions-legales">Mentions légales</Link></li>
            <li><Link to="/legal/cgu">Conditions d’utilisation</Link></li>
            <li><Link to="/legal/cgv">Conditions de vente</Link></li>
            <li><Link to="/legal/confidentialite">Confidentialité</Link></li>
            <li><Link to="/legal/cookies">Cookies</Link></li>
            <li><button type="button" className="footer-link-button" onClick={openConsentSettings}>Gérer mes cookies</button></li>
          </ul>
        </nav>
      </div>
      <div className="site-footer-bottom">
        <span>© {year} Nūr Meet · Paris</span>
        <span>Service réservé aux personnes majeures · Contact : contact@nourmeet.com</span>
      </div>
    </footer>
  );
}

// C32-C34 (ordre correctif 2026-09-20) : un identifiant anonyme aléatoire (jamais une empreinte
// technique), posé une seule fois côté navigateur — le serveur n'écrit rien tant que
// ANALYTICS_ENABLED est désactivé (défaut), donc cet appel est sans effet hors activation explicite.
// utm_* n'est capturé qu'une fois par session (sessionStorage), pour attribuer toute la visite à sa
// source d'origine même après plusieurs pages vues sans paramètres dans l'URL.
// Corrections web 2026-09-24 (§15) : rien n'est posé ni envoyé sans consentement explicite à la mesure
// d'audience (voir lib/consent.ts et CookieConsent).
const trackPageview = (path: string) => {
  if (!analyticsAllowed()) return;
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

export function Layout({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  const location = useLocation();
  useEffect(() => { trackPageview(location.pathname); }, [location.pathname]);
  // La page où le consentement est donné compte aussi, sans attendre la navigation suivante.
  useEffect(() => {
    const onConsent = (e: Event) => { if ((e as CustomEvent).detail?.analytics) trackPageview(window.location.pathname); };
    window.addEventListener(CONSENT_CHANGED, onConsent);
    return () => window.removeEventListener(CONSENT_CHANGED, onConsent);
  }, []);
  // Chaque navigation repart du haut de la page (sauf ancre explicite) : sans cela, React Router
  // conserve la position de défilement de la page précédente.
  useEffect(() => { if (!location.hash) window.scrollTo(0, 0); }, [location.pathname, location.hash]);
  return (
    <>
      <a className="skip-link" href="#contenu">Aller au contenu</a>
      <Header />
      <main id="contenu" tabIndex={-1}>{children}</main>
      {footer && <Footer />}
      <CookieConsent />
    </>
  );
}
