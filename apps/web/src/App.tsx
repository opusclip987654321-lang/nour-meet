import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import jsQR from "jsqr";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { EVENT_CATEGORIES, EVENT_ZONES, SCREENING_QUESTIONS, NETWORKING_QUESTIONS, eventRequiresScreening } from "@nour/shared";
import type { PublicEvent, SessionUser, ScreeningAnswers, NetworkingAnswers, Paginated } from "@nour/shared";
import { API_URL, api, getToken, setToken } from "./api";
import { MentionsLegales, CGU, CGV, Confidentialite, Cookies } from "./legal";

const imgUrl = (src: string) => src.startsWith("http") ? src : `${API_URL}${src}`;
// Avatar : vraie photo de profil si elle existe, sinon les initiales — jamais l'inverse, jamais un
// visage générique. Même composant partout (dashboard, messagerie, entretiens) pour que l'ajout
// d'une photo se reflète immédiatement à tous les endroits où le compte apparaît.
const Avatar = ({ name, photoUrl, size, className, verified }: { name?: string | null; photoUrl?: string | null; size?: "large"; className?: string; verified?: boolean }) => {
  const cls = `avatar${size ? ` ${size}` : ""}${className ? ` ${className}` : ""}`;
  const img = photoUrl ? <img className={cls} src={imgUrl(photoUrl)} alt="" /> : <div className={cls}>{(name ?? "?").slice(0, 2).toUpperCase()}</div>;
  if (!verified) return img;
  return <div className="avatar-wrap">{img}<span className="verified-badge" title="Profil vérifié">✓ Vérifié</span></div>;
};

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "");

type AuthState = { user: (SessionUser & {profile?: any}) | null; loading: boolean; refresh: () => Promise<void>; logout: () => void };
const AuthContext = createContext<AuthState>(null as never);
const useAuth = () => useContext(AuthContext);

const money = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const dayLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const APPLICATION_STATUS_LABEL: Record<string,string> = { PENDING_CALL: "En attente de choix d’un créneau", CALL_SCHEDULED: "Entretien programmé", CALL_COMPLETED: "Entretien réalisé", ACCEPTED: "Candidature acceptée", REFUSED: "Candidature refusée", PAYMENT_PENDING: "Acceptée · paiement à finaliser", CONFIRMED: "Place confirmée", CANCELLED: "Annulée", NO_SHOW: "Absence à l’entretien" };
const EVENT_STATUS_LABEL: Record<string,string> = { DRAFT: "Brouillon", PENDING_REVIEW: "En attente de validation", PUBLISHED: "Publié", FULL: "Complet", CANCELLED: "Annulé", COMPLETED: "Terminé" };
const RESTAURANT_STATUS_LABEL: Record<string,string> = { PENDING: "En attente", APPROVED: "Approuvé", REJECTED: "Refusé", SUSPENDED: "Suspendu" };

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { if (!getToken()) { setUser(null); setLoading(false); return; } try { setUser(await api("/me")); } catch { setToken(null); setUser(null); } finally { setLoading(false); } };
  useEffect(() => { refresh(); }, []);
  return <AuthContext.Provider value={{ user, loading, refresh, logout: () => { setToken(null); setUser(null); } }}>{children}</AuthContext.Provider>;
}

function Logo() { return <Link className="logo" to="/"><span>N</span><strong>NŪR <b>MEET</b></strong></Link>; }
const STAFF_ROLES = ["ADMIN","ORGANIZER","MODERATOR","RECEPTION"];
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
function Layout({ children }: {children: ReactNode}) {
  const location=useLocation();
  useEffect(()=>{trackPageview(location.pathname)},[location.pathname]);
  return <><Header/><main>{children}</main><footer><Logo/><p>Paris et Île-de-France · Expérience privée · Données protégées</p><nav style={{ display: "flex", gap: 16 }}><Link to="/legal/mentions-legales">Mentions légales</Link><Link to="/legal/cgu">CGU</Link><Link to="/legal/cgv">CGV</Link><Link to="/legal/confidentialite">Confidentialité</Link><Link to="/legal/cookies">Cookies</Link></nav></footer></>;
}
function Loading() { return <div className="state-page"><div className="spinner"/><h2>Chargement…</h2></div>; }
// C13/C14 (ordre correctif 2026-09-20) : liste de notifications partagée (participant, restaurateur,
// admin) — chronologique, lu/non lu, cliquable vers la destination métier exacte (linkPath), jamais
// un lien générique. Un clic marque lu puis navigue ; une notification sans linkPath reste affichée
// mais non cliquable plutôt que de pointer vers un lien mort.
function NotificationList({ items, onRead }: { items: any[]; onRead: (id: string) => void }) {
  const navigate = useNavigate();
  const open = async (n: any) => {
    if (!n.readAt) { try { await api(`/notifications/${n.id}/read`, { method: "POST" }); onRead(n.id); } catch { /* déjà lue ou introuvable */ } }
    if (n.linkPath) navigate(n.linkPath);
  };
  if (items.length === 0) return <div className="empty small"><span>◇</span><p>Aucune notification pour le moment.</p></div>;
  return <div className="stack">{items.map(n => {
    const Tag = n.linkPath ? "button" : "div";
    return <Tag key={n.id} type={n.linkPath ? "button" : undefined} className={`notification ${n.readAt ? "read" : "unread"}`} onClick={n.linkPath ? () => open(n) : undefined} style={n.linkPath ? { cursor: "pointer", textAlign: "left", border: 0, width: "100%", font: "inherit" } : undefined}>
      <i/><div><h3>{n.title}</h3><p>{n.body}</p><small>{dateTime(n.createdAt)}</small></div>
    </Tag>;
  })}</div>;
}
function Notice({ kind="info", children }: {kind?: "info"|"error"|"success", children: ReactNode}) { return <div className={`notice ${kind}`}>{children}</div>; }

// C23 (ordre correctif 2026-09-20) : un seul bouton principal, libellé 2-3 mots ("Invite un ami"),
// qui ouvre la feuille de partage native (WhatsApp, SMS, apps installées) si disponible, sinon
// retombe sur la copie du lien — jamais de boutons séparés Facebook/Instagram/TikTok, dont
// certains ne pouvaient de toute façon pas déclencher un vrai partage direct par URL.
function ShareButton({ event }: { event: PublicEvent }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const resolveUrl = async () => {
    let resolved = `${window.location.origin}/events/${event.slug}`;
    if (user) { try { resolved = (await api<{ url: string }>(`/events/${event.id}/share-link`, { method: "POST" })).url; } catch { /* lien public par défaut */ } }
    return resolved;
  };
  const share = async () => {
    setError("");
    const shareUrl = await resolveUrl();
    const text = `« ${event.title} » sur Nūr Meet.`;
    if (navigator.share) { try { await navigator.share({ title: event.title, text, url: shareUrl }); return; } catch { /* annulé ou indisponible, on retombe sur la copie */ } }
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("Impossible de copier le lien automatiquement."); }
  };
  return <div className="share-block">
    <button type="button" className="button secondary full" onClick={share}>Inviter un ami</button>
    {copied && <p className="fine share-copied">Lien copié !</p>}
    {error && <p className="fine share-copied">{error}</p>}
  </div>;
}
function Protected({ children, roles }: {children: ReactNode; roles?: string[]}) {
  const {user,loading}=useAuth();
  if(loading)return <Loading/>;
  if(!user)return <Navigate to="/login" replace/>;
  if(roles&&!roles.includes(user.role))return <Navigate to={STAFF_ROLES.includes(user.role)?"/admin":"/dashboard"} replace/>;
  return <>{children}</>;
}

// §15 : couleur, icône et badge distincts par type d'événement. La couleur vient de EVENT_CATEGORIES
// (partagée avec l'API/mobile) ; l'icône reste ici car elle dépend de JSX. Une catégorie ajoutée
// sans entrée ici retombe sur un simple point de sa couleur plutôt que de casser l'affichage.
const CATEGORY_ICON: Record<string, ReactNode> = {
  "Speed dating": <svg viewBox="0 0 24 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.6"/><circle cx="16" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.6"/></svg>,
  "Networking": <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true"><circle cx="6" cy="18" r="2.1" fill="currentColor"/><circle cx="18" cy="18" r="2.1" fill="currentColor"/><circle cx="12" cy="6" r="2.1" fill="currentColor"/><path d="M6 18 12 6 18 18" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
};
function CategoryBadge({ category, className }: {category: string; className?: string}) {
  const color = EVENT_CATEGORIES.find(c => c.name === category)?.color ?? "var(--gold)";
  const icon = CATEGORY_ICON[category] ?? <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>;
  return <span className={`category-badge${className ? ` ${className}` : ""}`} style={{ color, borderColor: color }}>{icon}{category}</span>;
}

// C24 : jamais de chiffre brut de capacité/quota — seulement ce que la disponibilité calculée
// côté serveur autorise à dire pour CE visiteur.
const availabilityLabel=(a:PublicEvent["availability"])=>a.kind==="unknown"?"Places selon catégorie":a.full?"Complet":`${a.remaining} place${a.remaining>1?"s":""} restante${a.remaining>1?"s":""}`;
function EventCard({ event }: {event: PublicEvent}) {
  const full=event.availability.kind!=="unknown"&&event.availability.full;
  const priceLabel=event.priceTiers.length>0?`À partir de ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:money(event.priceCents);
  return <article className="event-card"><Link to={`/events/${event.slug}`} className="event-art"><img src={imgUrl(event.imageUrl)} alt={event.title} loading="lazy"/><CategoryBadge category={event.category}/>{event.highlightTier==="priority"&&<span className="verified-badge" style={{position:"absolute",top:16,right:16}}>★ Mise en avant</span>}{event.highlightTier==="simple"&&<span className="category-badge" style={{position:"absolute",top:16,right:16,color:"#ddd",borderColor:"#555"}}>Partenaire</span>}{full&&<span className="full-badge">Complet</span>}</Link><div className="event-copy"><small>{dateTime(event.startsAt).toUpperCase()}</small><h3>{event.title}</h3><p>{event.district} · {availabilityLabel(event.availability)}</p><div><strong>{priceLabel}</strong><Link to={`/events/${event.slug}`}>Découvrir →</Link></div></div></article>;
}
function TestimonialsSection({ eventType }: { eventType?: string }) {
  const [items,setItems]=useState<any[]>([]);
  useEffect(()=>{api<any[]>(`/testimonials${eventType?`?eventType=${encodeURIComponent(eventType)}`:""}`).then(setItems).catch(()=>{})},[eventType]);
  if(items.length===0) return null;
  return <section className="section"><div className="section-title"><span className="eyebrow">ILS EN PARLENT</span><h2>Des rencontres qui comptent.</h2></div><div className="feature-grid">{items.map(t=><div key={t.id} className="testimonial-card"><div className="testimonial-head"><span className="testimonial-avatar">{t.displayName.slice(0,2).toUpperCase()}</span><div><b>{t.displayName}</b><span className="eyebrow">{t.eventType.toUpperCase()}</span></div></div><blockquote>« {t.text} »</blockquote>{t.rating&&<span className="fine">{"★".repeat(t.rating)}{"☆".repeat(5-t.rating)}</span>}</div>)}</div></section>;
}

function Home() {
  const [events,setEvents]=useState<PublicEvent[]>([]); useEffect(()=>{api<Paginated<PublicEvent>>("/events").then(r=>setEvents(r.items)).catch(()=>{})},[]);
  return <Layout><section className="hero"><div><span className="eyebrow">PARIS · ÎLE-DE-FRANCE</span><h1>Des rencontres<br/><em>qui comptent.</em></h1><p>Des événements élégants et confidentiels, pensés pour créer de vraies connexions dans un cadre respectueux.</p><div className="hero-actions"><Link className="button" to="/events">Voir les événements</Link><Link className="button secondary" to="/concept">Découvrir le concept</Link></div><div className="trust"><span>✓ Profils sélectionnés</span><span>✓ Lieux premium</span><span>✓ Cadre confidentiel</span></div></div><div className="hero-art"><div className="arch"><span>ن</span></div>{
/* G2 (cahier des charges consolidé 2026-09-20) : jamais de soirée fictive affichée comme réelle —
   si aucun événement n'est publié, un message neutre remplace la carte plutôt qu'un exemple inventé. */
}<div className="next-card">{events[0]?<><img className="next-thumb" src={imgUrl(events[0].imageUrl)} alt=""/><div><small>PROCHAINE SOIRÉE</small><strong>{events[0].title}</strong><span>{dateTime(events[0].startsAt)}</span></div></>:<><div className="avatar">N</div><div><small>PROCHAINE SOIRÉE</small><strong>Revenez bientôt</strong><span>De nouvelles soirées seront bientôt annoncées</span></div></>}</div></div></section><section id="concept" className="section"><div className="section-title"><span className="eyebrow">LE CONCEPT</span><h2>Du réel au numérique, avec votre consentement.</h2></div><div className="feature-grid"><div><b>01</b><h3>Candidature</h3><p>Chaque nouveau membre complète son profil et réserve un court appel.</p></div><div><b>02</b><h3>Rencontre</h3><p>Les événements réunissent 20 à 40 personnes dans un cadre privé.</p></div><div><b>03</b><h3>Contact choisi</h3><p>Un code personnel permet d’envoyer une demande. Le chat s’ouvre après acceptation.</p></div></div><Link to="/concept" className="fine">En savoir plus sur le concept →</Link></section>{events.length>0&&<section className="section"><div className="section-title row"><div><span className="eyebrow">À VENIR</span><h2>Les prochaines rencontres</h2></div><Link to="/events">Tout afficher →</Link></div><div className="event-grid">{events.slice(0,3).map(e=><EventCard key={e.id} event={e}/>)}</div></section>}<TestimonialsSection/></Layout>;
}

function Concept() {
  const [video,setVideo]=useState<{url:string;thumbnail:string;subtitles:string}|null>(null);
  // Les réglages vidéo sont publics par nature (contenu éditorial), mais /admin/settings est
  // réservé à l'administration : on lit les trois clés utiles depuis une petite route publique dédiée.
  useEffect(()=>{api<{url:string;thumbnail:string;subtitles:string}>("/concept-video").then(setVideo).catch(()=>{})},[]);
  return <Layout><section className="page"><span className="eyebrow">LE CONCEPT</span><h1>Comment fonctionne Nūr Meet.</h1>
    {video?.url?<video controls poster={video.thumbnail||undefined} className="concept-video"><source src={video.url}/>{video.subtitles&&<track kind="subtitles" src={video.subtitles} srcLang="fr" label="Français" default/>}Votre navigateur ne prend pas en charge la vidéo — voir le résumé écrit ci-dessous.</video>
    :<div className="concept-video-placeholder" style={{backgroundImage:`linear-gradient(180deg,#0b0b0cb0,#0b0b0ce6),url(${imgUrl("/static/defaults/speed-dating.jpg")})`}}><span>▶</span><p>La vidéo de présentation (60 à 90 secondes) sera bientôt disponible ici. En attendant, voici comment tout fonctionne :</p></div>}
    <div className="feature-grid" style={{marginTop:40}}>
      <div><b>01</b><h3>Speed dating, avec sélection</h3><p>Un questionnaire privé, un entretien téléphonique et une décision de notre équipe avant toute inscription : un cadre sérieux, pensé pour de vraies rencontres.</p></div>
      <div><b>02</b><h3>Networking, en accès direct</h3><p>Un questionnaire professionnel non bloquant, puis une inscription immédiate : idéal pour élargir son réseau sans étape supplémentaire.</p></div>
      <div><b>03</b><h3>Des profils sérieux, un cadre respectueux</h3><p>Chaque participant complète un profil et s’engage à respecter la charte de confidentialité et de respect mutuel de la communauté.</p></div>
      <div><b>04</b><h3>Paiement et billet</h3><p>La place n’est acquise qu’après paiement confirmé ; un billet avec QR code personnel est alors délivré pour l’entrée.</p></div>
      <div><b>05</b><h3>Déroulement de la soirée</h3><p>Accueil personnalisé, animation légère, temps libres, et la possibilité d’échanger un contact avec les personnes rencontrées.</p></div>
    </div>
  </section></Layout>;
}

// Architecture éditoriale (instructions définitives 2026-09-20) : couvre explicitement les
// rencontres amoureuses, l'amitié, la solitude et le networking professionnel.
const BLOG_CATEGORIES=["Rencontres amoureuses","Amitié","Solitude et vie sociale","Networking professionnel"];

function Blog() {
  const [articles,setArticles]=useState<any[]>([]);
  const [category,setCategory]=useState("");
  useEffect(()=>{api<any[]>(`/articles${category?`?category=${encodeURIComponent(category)}`:""}`).then(setArticles).catch(()=>{})},[category]);
  return <Layout><section className="page"><span className="eyebrow">LE BLOG</span><h1>Rencontres, amitié et vie sociale.</h1>
    <div className="filters"><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Tous les thèmes</option>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
    {articles.length===0?<div className="empty"><span>◇</span><h2>Aucun article pour le moment</h2></div>:<div className="event-grid">{articles.map(a=><Link key={a.id} to={`/blog/${a.slug}`} className="event-card"><div className="event-art">{a.imageUrl?<img src={imgUrl(a.imageUrl)} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span className="eyebrow">{a.category.toUpperCase()}</span>}</div><div className="event-copy"><small>{a.category.toUpperCase()}</small><h3>{a.title}</h3><p>{a.excerpt}</p></div></Link>)}</div>}
  </section></Layout>;
}

// §5 (cahier des charges 2026-09) : les articles doivent pouvoir renvoyer vers d'autres parties
// du site (ex. réserver une soirée), pas seulement exister pour le SEO. Convention légère de type
// Markdown "[libellé](/chemin)" dans le texte : un chemin commençant par "/" devient un lien interne
// (react-router, jamais de rechargement de page), tout le reste un lien externe classique.
const renderArticleParagraph = (text: string) => {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!match) return part;
    const [, label, url] = match;
    return url.startsWith("/") ? <Link key={i} to={url} className="link-button" style={{display:"inline"}}>{label}</Link> : <a key={i} href={url} target="_blank" rel="noreferrer">{label}</a>;
  });
};

function ArticlePage() {
  const {id}=useParams();
  const [article,setArticle]=useState<any>(null);
  const [notFound,setNotFound]=useState(false);
  useEffect(()=>{api<any>(`/articles/${id}`).then(setArticle).catch(()=>setNotFound(true))},[id]);
  useEffect(()=>{
    if(!article)return;
    document.title=article.metaTitle||`${article.title} — Nūr Meet`;
    let meta=document.querySelector('meta[name="description"]');
    if(!meta){meta=document.createElement("meta");meta.setAttribute("name","description");document.head.appendChild(meta)}
    meta.setAttribute("content",article.metaDescription||article.excerpt||"");
    // C31 : données structurées réelles (Article), jamais un graphique/schéma décoratif — uniquement
    // les champs dont on dispose vraiment (pas d'auteur générique inventé si l'article n'en a pas).
    const script=document.createElement("script");
    script.type="application/ld+json";
    script.text=JSON.stringify({
      "@context":"https://schema.org","@type":"Article",
      headline:article.title, description:article.excerpt??undefined,
      image:article.imageUrl?imgUrl(article.imageUrl):undefined,
      datePublished:article.publishedAt??undefined, dateModified:article.updatedAt??article.publishedAt??undefined,
      author:article.author?{"@type":"Person",name:article.author.displayName}:undefined,
      publisher:{"@type":"Organization",name:"Nūr Meet"}
    });
    document.head.appendChild(script);
    return ()=>{document.title="Nūr Meet";script.remove()};
  },[article]);
  if(notFound)return <Layout><div className="empty"><span>◇</span><h2>Article introuvable</h2></div></Layout>;
  if(!article)return <Layout><Loading/></Layout>;
  return <Layout><section className="page" style={{maxWidth:760}}>
    <span className="eyebrow">{article.category.toUpperCase()}</span>
    <h1>{article.title}</h1>
    {article.author&&<p className="fine">Par {article.author.displayName} · {new Date(article.publishedAt).toLocaleDateString("fr-FR")}</p>}
    {article.imageUrl&&<img src={imgUrl(article.imageUrl)} alt="" style={{width:"100%",borderRadius:14,margin:"20px 0"}}/>}
    <div className="article-body">{article.content.split("\n\n").map((p:string,i:number)=><p key={i}>{renderArticleParagraph(p)}</p>)}</div>
    {article.keywords?.length>0&&<div className="chips" style={{marginTop:30}}>{article.keywords.map((k:string)=><span key={k}>{k}</span>)}</div>}
  </section></Layout>;
}

function Events() {
  const [searchParams]=useSearchParams();
  // §5 (cahier des charges 2026-09) : permet au blog (et à tout autre lien externe) de renvoyer
  // directement vers les événements d'une catégorie précise, ex. /events?category=Speed%20dating.
  const [events,setEvents]=useState<PublicEvent[]>([]),[q,setQ]=useState(""),[category,setCategory]=useState(searchParams.get("category")??"");
  useEffect(()=>{api<Paginated<PublicEvent>>(`/events?${new URLSearchParams({...(q?{q}:{}),...(category?{category}:{})})}`).then(r=>setEvents(r.items))},[q,category]);
  return <Layout><section className="page"><span className="eyebrow">CALENDRIER</span><h1>Trouvez la rencontre qui vous ressemble.</h1><div className="filters"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher un événement"/><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Toutes les catégories</option>{EVENT_CATEGORIES.map(c=><option key={c.name}>{c.name}</option>)}</select></div>{events.length?<div className="event-grid">{events.map(e=><EventCard key={e.id} event={e}/>)}</div>:<div className="empty"><span>◇</span><h2>Aucun événement disponible</h2><p>Modifiez vos filtres ou revenez prochainement.</p></div>}</section></Layout>;
}

function CallCalendar({ slots, loading, onSelect, schedulingId }: { slots: any[]; loading: boolean; onSelect: (id: string) => void; schedulingId: string | null }) {
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const slot of slots) {
      const key = new Date(slot.startsAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [slots]);
  const days = useMemo(() => [...byDay.keys()], [byDay]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  useEffect(() => { if (days.length && !days.includes(activeDay ?? "")) setActiveDay(days[0]); }, [days.join(",")]);
  if (loading) return <div className="calendar-state"><div className="spinner small"/><span>Chargement des disponibilités…</span></div>;
  if (!slots.length) return <div className="calendar-state empty-slots"><span>◇</span><p>Aucun créneau disponible pour le moment. L’organisateur n’a pas encore publié de disponibilités pour cet événement.</p></div>;
  return <div className="calendar"><h3>Choisissez votre appel</h3><div className="calendar-days">{days.map(day => <button type="button" key={day} className={day===activeDay?"active":""} onClick={()=>setActiveDay(day)}><strong>{dayLabel(day)}</strong></button>)}</div><div className="calendar-slots">{(byDay.get(activeDay ?? "")??[]).map(s => <button type="button" key={s.id} disabled={schedulingId===s.id} onClick={()=>onSelect(s.id)}>{timeLabel(s.startsAt)}{schedulingId===s.id?<i className="mini-spinner"/>:null}</button>)}</div></div>;
}

function PaymentForm({ amountCents, onSuccess, onCancel }: { amountCents: number; onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setError("");
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (confirmError) { setError(confirmError.message ?? "Le paiement a été refusé."); setSubmitting(false); return; }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) { onSuccess(); return; }
    setError("Le paiement n’a pas pu être confirmé."); setSubmitting(false);
  };
  return <form onSubmit={submit} className="payment-form">
    <PaymentElement/>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="payment-actions">
      <button type="button" className="button secondary" onClick={onCancel} disabled={submitting}>Annuler</button>
      <button type="submit" className="button" disabled={!stripe || submitting}>{submitting?"Traitement…":`Payer ${money(amountCents)}`}</button>
    </div>
  </form>;
}

function PaymentModal({ applicationId, eventId, amountCents, onClose, onConfirmed, onWaitlisted }: { applicationId: string; eventId: string; amountCents: number; onClose: () => void; onConfirmed: () => void; onWaitlisted: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "confirming" | "success" | "timeout">("loading");

  useEffect(() => {
    // Ne garantit jamais une place avant cet appel précis (§5) : c'est ici, et seulement ici, qu'un
    // verrou technique court est posé — si la place vient d'être prise entre l'inscription et cet
    // instant, la personne rejoint automatiquement la liste d'attente plutôt que d'échouer sans suite.
    api<{ clientSecret: string }>(`/applications/${applicationId}/payment-intent`, { method: "POST" })
      .then(r => { setClientSecret(r.clientSecret); setPhase("ready"); })
      .catch((err: any) => { if (err?.waitlisted) { onWaitlisted(); onClose(); } else setError((err as Error).message); });
  }, [applicationId]);

  const handleSuccess = async () => {
    setPhase("confirming");
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const application = await api<any>(`/events/${eventId}/my-application`);
        if (application.status === "CONFIRMED") { setPhase("success"); setTimeout(onConfirmed, 1200); return; }
      } catch { /* on retente */ }
    }
    setPhase("timeout");
  };

  return <div className="modal-overlay" role="dialog" aria-modal="true">
    <div className="modal payment-modal">
      <div className="modal-head"><h2>Paiement sécurisé</h2><button type="button" className="link-button" onClick={onClose} aria-label="Fermer">×</button></div>
      <p className="payment-amount">Montant à régler : <b>{money(amountCents)}</b></p>
      {error && <Notice kind="error">{error}</Notice>}
      {phase === "loading" && <div className="calendar-state"><div className="spinner small"/><span>Chargement du module de paiement…</span></div>}
      {phase === "confirming" && <div className="calendar-state"><div className="spinner small"/><span>Confirmation du paiement…</span></div>}
      {phase === "success" && <Notice kind="success">Paiement confirmé ! Votre billet est prêt.</Notice>}
      {phase === "timeout" && <><Notice kind="error">Le paiement est en cours de confirmation. Actualisez la page dans un instant.</Notice><button className="button full" onClick={onClose}>Fermer</button></>}
      {phase === "ready" && clientSecret && <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#cba969" } } }}>
        <PaymentForm amountCents={amountCents} onSuccess={handleSuccess} onCancel={onClose}/>
      </Elements>}
    </div>
  </div>;
}

// Page de paiement autonome ouverte depuis l'app mobile dans un navigateur intégré (expo-web-
// browser) : Stripe n'a pas de module natif installable dans Expo Go (seuls les modules Expo
// officiels le sont, pas les SDK tiers), donc plutôt que de dupliquer PaymentModal en React Native
// et de forcer un client de développement natif, le mobile réutilise ici la page web déjà testée.
// L'authentification se fait par un jeton passé en paramètre d'URL (le mobile n'a pas de cookie ou
// de localStorage partagé avec le navigateur web) : il est stocké avant tout appel à l'API, jamais
// après, pour éviter toute course avec PaymentModal ci-dessus qui lit le jeton dès son montage.
// Cahier des charges consolidé final (2026-09-20, section 9.2) : la page n'accepte plus le jeton de
// session (30 jours) directement dans l'URL — seulement un jeton de paiement opaque, à usage unique
// et de courte durée, échangé ici contre un vrai jeton de session éphémère (voir
// POST /auth/payment-session-exchange). Jamais stocké ni journalisé tel quel.
function PayStandalone(){
  const { applicationId } = useParams();
  const [searchParams] = useSearchParams();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const session = searchParams.get("session");
    if (!session) { setError(true); setReady(true); return; }
    api<{ token: string }>("/auth/payment-session-exchange", { method: "POST", body: JSON.stringify({ token: session }) })
      .then(r => { setToken(r.token); setReady(true); })
      .catch(() => { setError(true); setReady(true); });
  }, []);
  if (!ready) return <div className="state-page"><div className="spinner"/></div>;
  if (error) return <div className="state-page"><h2>Lien de paiement invalide ou expiré.</h2><p>Retournez dans l’application et réessayez.</p></div>;
  if (done) return <div className="state-page"><h2>C’est terminé ici.</h2><p>Vous pouvez fermer cette fenêtre et retourner dans l’application Nūr Meet.</p></div>;
  const eventId = searchParams.get("eventId") ?? "";
  const amountCents = Number(searchParams.get("amount") ?? "0");
  return <div style={{ minHeight: "100vh", background: "#0b0b0c", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <PaymentModal applicationId={applicationId!} eventId={eventId} amountCents={amountCents} onClose={() => setDone(true)} onConfirmed={() => setDone(true)} onWaitlisted={() => setDone(true)}/>
  </div>;
}

// Arbitrage 12/E3 (cahier des charges consolidé 2026-09-20) : proposé uniquement une fois la place
// confirmée, jamais avant ou pendant le paiement, et entièrement facultatif — "Plus tard" ne bloque
// rien et ne réapparaît que lors d'une prochaine visite de cette page.
function NetworkingFollowUp({ applicationId }: { applicationId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (dismissed || done) return done ? <Notice kind="success">Merci, vos informations professionnelles ont été enregistrées.</Notice> : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    try { await api(`/applications/${applicationId}/networking-answers`, { method: "POST", body: JSON.stringify(answers) }); setDone(true); }
    catch { setDismissed(true); }
    finally { setSubmitting(false); }
  };
  return <form className="questionnaire" onSubmit={submit}>
    <p className="fine">Facultatif : quelques informations professionnelles pour mieux organiser la soirée.</p>
    {NETWORKING_QUESTIONS.map(q => <label key={q.key}>{q.label}<textarea value={answers[q.key] ?? ""} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })}/></label>)}
    <div className="decision-buttons">
      <button className="button" disabled={submitting}>{submitting ? "Envoi…" : "Envoyer"}</button>
      <button type="button" className="button secondary" onClick={() => setDismissed(true)}>Plus tard</button>
    </div>
  </form>;
}

function ApplicationStatusPanel({ application, event, onPaid, onWaitlisted }: { application: any; event: PublicEvent; onPaid: () => void; onWaitlisted: () => void }) {
  const [showPayment, setShowPayment] = useState(false);
  if (application.status === "REFUSED") return <Notice kind="error">Votre candidature n’a pas été retenue pour cet événement.</Notice>;
  if (application.status === "CANCELLED") return <Notice kind="error">Cette candidature a été annulée.</Notice>;
  if (application.status === "CONFIRMED") return <>
    <Notice kind="success">Votre place est confirmée. Retrouvez votre billet dans votre espace personnel.</Notice>
    {!eventRequiresScreening(event) && !application.networkingAnswer && <NetworkingFollowUp applicationId={application.id}/>}
  </>;
  // La candidature autorise à tenter le paiement, elle ne garantit jamais de place à elle seule
  // (§5) : le clic sur "Payer" est ce qui pose réellement le verrou, via PaymentModal.
  if (application.status === "PAYMENT_PENDING") return <div className="payment-block">
    <Notice kind="success">{application.reservation ? `Votre place est retenue quelques minutes (jusqu’au ${dateTime(application.reservation.expiresAt)}) : finalisez votre paiement.` : "Vous pouvez régler votre billet dès maintenant."}</Notice>
    <button className="button full" onClick={() => setShowPayment(true)}>Payer par carte · {money(event.priceCents)}</button>
    {showPayment && <PaymentModal applicationId={application.id} eventId={event.id} amountCents={event.priceCents} onClose={() => setShowPayment(false)} onConfirmed={() => { setShowPayment(false); onPaid(); }} onWaitlisted={onWaitlisted}/>}
  </div>;
  if (application.call) return <div className="call-scheduled"><span className="eyebrow">ENTRETIEN PROGRAMMÉ</span><strong>{dateTime(application.call.startsAt)}</strong><p>L’organisateur vous appellera à cette heure, puis vous serez informé(e) de sa décision.</p></div>;
  return null;
}

// Questionnaire obligatoire avant toute candidature (§4.1/§4.2) : 7 questions selon le parcours de
// l'événement, jamais une comparaison de catégorie (voir eventRequiresScreening). Les réponses
// speed dating sont privées ; les réponses networking ne bloquent jamais l'achat.
function QuestionnaireForm({ requiresScreening, submitting, onSubmit }: { requiresScreening: boolean; submitting: boolean; onSubmit: (answers: Record<string, string>) => void }) {
  const questions = requiresScreening ? SCREENING_QUESTIONS : NETWORKING_QUESTIONS;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(answers); };
  return <form className="questionnaire" onSubmit={submit}>
    <p className="fine">{requiresScreening ? "Vos réponses sont privées : elles servent uniquement à préparer votre entretien et la décision d’acceptation." : "Vos réponses ne bloquent jamais l’achat : elles aident seulement à mieux organiser la soirée."}</p>
    {questions.map(q => <label key={q.key}>{q.label}{q.key === "noteForOrganizer" && <span className="fine"> (facultatif)</span>}
      <textarea required={q.key !== "noteForOrganizer"} value={answers[q.key] ?? ""} onChange={e => setAnswers({ ...answers, [q.key]: e.target.value })}/>
    </label>)}
    <button className="button full" disabled={submitting}>{submitting ? "Envoi…" : "Envoyer ma candidature"}</button>
  </form>;
}

function EventDetail() {
  const {id}=useParams(); const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const [event,setEvent]=useState<PublicEvent|null>(null);
  const [application,setApplication]=useState<any>(null);
  const [loadingApplication,setLoadingApplication]=useState(true);
  const [notice,setNotice]=useState<{kind:"error"|"success"|"info";text:string}|null>(null);
  const [waitlistEntry,setWaitlistEntry]=useState<any>(null);
  const [altOffer,setAltOffer]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [showQuestionnaire,setShowQuestionnaire]=useState(false);

  useEffect(()=>{api<PublicEvent>(`/events/${id}`).then(setEvent)},[id]);

  // Partage attribué (§12) : le code de la personne qui a partagé le lien est capturé une seule
  // fois, dès la visite, puis conservé pour la candidature — jamais recalculé après coup.
  const shareCode=searchParams.get("ref");
  useEffect(()=>{
    if(!shareCode)return;
    sessionStorage.setItem(`nour_ref_${id}`,shareCode);
    api(`/share-links/${shareCode}/click`,{method:"POST"}).catch(()=>{});
  },[shareCode,id]);

  useEffect(()=>{
    if(!user||!event){setLoadingApplication(false);return}
    let ignore=false; setLoadingApplication(true);
    api<any>(`/events/${event.id}/my-application`).then(a=>!ignore&&setApplication(a)).catch(()=>!ignore&&setApplication(null)).finally(()=>!ignore&&setLoadingApplication(false));
    api<any>(`/events/${event.id}/waitlist/me`).then(w=>!ignore&&setWaitlistEntry(w)).catch(()=>!ignore&&setWaitlistEntry(null));
    api<any[]>("/me/alternative-offers").then(list=>{if(ignore)return;setAltOffer(list.find(o=>o.originalEventId===event.id&&o.status==="PENDING")??null)}).catch(()=>{});
    return ()=>{ignore=true};
  },[user,event?.id]);

  if(!event)return <Layout><Loading/></Layout>;

  const requiresScreening = eventRequiresScreening(event);
  const profileValidated = !!user?.profile?.validatedAt;
  // C24 : plus de lecture directe de quotas bruts — la disponibilité déjà calculée côté serveur
  // pour ce visiteur (event.availability) porte toute l'information nécessaire à l'écran.
  const categoryUnknown = event.availability.kind==="unknown";
  const bucketFull = event.availability.kind!=="unknown" && event.availability.full;
  const canCancel = application && !["REFUSED","CANCELLED"].includes(application.status);

  const refreshApplication=()=>api<any>(`/events/${event.id}/my-application`).then(setApplication).catch(()=>{});
  const markWaitlisted=()=>{api<any>(`/events/${event.id}/waitlist/me`).then(setWaitlistEntry).catch(()=>{});setNotice({kind:"info",text:"Cet événement est complet pour votre catégorie : vous avez été placé(e) sur liste d’attente."})};

  // La candidature ne garantit jamais de place (§5) : elle enregistre le questionnaire (spéciale
  // dating uniquement) et autorise seulement à tenter le paiement ensuite (voir
  // ApplicationStatusPanel → PaymentModal). Arbitrage 12/E3 : un événement networking ne pose plus
  // aucune question professionnelle à ce stade — voir le formulaire facultatif post-paiement dans
  // ApplicationStatusPanel.
  const apply=async(answers?:Record<string,string>)=>{
    setBusy(true);setNotice(null);
    try{
      // Bug historique (cahier des charges consolidé 2026-09-20) : le clic est enregistré sous la
      // clé de l'URL (slug), mais la candidature relisait sous l'id réel de l'événement — deux
      // valeurs différentes qui ne coïncident jamais, donc l'attribution était silencieusement
      // perdue. On relit désormais sous la même clé que celle utilisée à l'écriture (id ci-dessus).
      const storedRef=sessionStorage.getItem(`nour_ref_${id}`)??undefined;
      const body=requiresScreening?{screeningAnswers:answers,shareCode:storedRef}:{shareCode:storedRef};
      const result=await api<any>(`/events/${event.id}/apply`,{method:"POST",body:JSON.stringify(body)});
      setApplication(result.application);setShowQuestionnaire(false);
      setNotice({kind:"success",text:"Candidature envoyée : vous pouvez maintenant régler votre billet."});
    }
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const joinWaitlist=async()=>{
    setBusy(true);setNotice(null);
    try{setWaitlistEntry(await api<any>(`/events/${event.id}/waitlist`,{method:"POST"}));setNotice({kind:"success",text:"Vous êtes inscrit(e) sur la liste d’attente."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const leaveWaitlist=async()=>{
    setBusy(true);setNotice(null);
    try{await api(`/events/${event.id}/waitlist`,{method:"DELETE"});setWaitlistEntry(null);setNotice({kind:"success",text:"Vous avez quitté la liste d’attente."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  // Écran de confirmation clair sur le montant remboursé (§7), jamais un simple "annulé" muet :
  // le calcul (plus de 24h → intégral, 24h ou moins → aucun remboursement de plein droit) est
  // renvoyé par le serveur, jamais recalculé ou supposé côté interface.
  const cancelApplication=async()=>{
    if(!application)return;
    setBusy(true);setNotice(null);
    try{
      const result=await api<{refunded:boolean;refundedAmountCents:number|null;eligible:boolean|null}>(`/me/applications/${application.id}/cancel`,{method:"POST"});
      const text=result.refunded?`Candidature annulée. ${money(result.refundedAmountCents!)} ont été remboursés intégralement.`
        :result.eligible===false?"Candidature annulée. Conformément à notre politique, aucun remboursement n’est possible pour une annulation à 24 heures ou moins de l’événement."
        :"Votre candidature a été annulée.";
      setNotice({kind:"success",text});await refreshApplication();setWaitlistEntry(null);
    }
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const respondAltOffer=async(accept:boolean)=>{
    if(!altOffer)return;
    setBusy(true);setNotice(null);
    try{await api(`/alternative-offers/${altOffer.id}/respond`,{method:"POST",body:JSON.stringify({accept})});setAltOffer(null);setNotice({kind:"success",text:accept?"Place réservée sur l’événement alternatif : consultez votre espace personnel pour payer.":"Proposition refusée."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  const perkLabels=[event.perks.drink&&"Boisson incluse",event.perks.starter&&"Entrée incluse",event.perks.main&&"Plat inclus",event.perks.dessert&&"Dessert inclus"].filter(Boolean) as string[];
  return <Layout><section className="event-hero" style={{backgroundImage:`linear-gradient(180deg,#0b0b0cb0,#0b0b0ce6),url(${imgUrl(event.imageUrl)})`}}><CategoryBadge category={event.category} className="inline"/> <span className={`flow-badge ${requiresScreening?"screening":"direct"}`}>{requiresScreening?"◆ Sélection":"● Accès direct"}</span><h1>{event.title}</h1><p>{event.description}</p></section>{event.photos.length>0&&<section className="event-gallery">{event.photos.map((url,i)=><img key={i} src={imgUrl(url)} alt=""/>)}</section>}<section className="event-layout"><article><div className="facts"><div><small>DATE</small><b>{dateTime(event.startsAt)}</b></div><div><small>LIEU</small><b>{event.district}</b></div>{(event.minAge||event.maxAge)&&<div><small>TRANCHE D’ÂGE</small><b>{event.minAge&&event.maxAge?`${event.minAge}-${event.maxAge} ans`:event.minAge?`${event.minAge} ans et plus`:`Jusqu’à ${event.maxAge} ans`}</b></div>}<div><small>ORGANISATEUR</small><b>{event.organizer.name}</b></div></div><h2>Une expérience pensée pour de vraies rencontres</h2><p>Accueil personnalisé, animation légère, temps libres et respect de la confidentialité.</p>{(perkLabels.length>0||event.perks.description)&&<div className="event-perks">{perkLabels.map(l=><span key={l}>{l}</span>)}{event.perks.description&&<span>{event.perks.description}</span>}</div>}<ul><li>{requiresScreening?"Profils sélectionnés":"Inscription directe"}</li><li>QR code d’entrée unique</li><li>Code de contact privé</li><li>Équipe présente sur place</li></ul><div className="cancellation-policy"><small>POLITIQUE D’ANNULATION</small><p>Annulation gratuite jusqu’à 24 heures avant l’événement : remboursement intégral automatique. Passé ce délai, aucun remboursement n’est possible de plein droit.</p></div></article><aside className="booking"><ShareButton event={event}/><small>{event.priceTiers.length>0?"TARIFS":"À PARTIR DE"}</small>{event.priceTiers.length>0?<div className="quota-rows">{event.priceTiers.map(t=><div key={t.category} className="quota-row"><span>{t.category==="HOMME"?"Hommes":"Femmes"}</span><b>{money(t.amountCents)}</b></div>)}</div>:<strong>{money(event.priceCents)}</strong>}<div><span>Disponibilité</span><b>{availabilityLabel(event.availability)}</b></div>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}{application&&<p className="fine status-line">Statut : <b>{APPLICATION_STATUS_LABEL[application.status]??application.status}</b></p>}
    {altOffer&&<div className="alt-offer"><span className="eyebrow">ÉVÉNEMENT ALTERNATIF PROPOSÉ</span><h3>{altOffer.alternativeEvent.title}</h3><p>{dateTime(altOffer.alternativeEvent.startsAt)} · {altOffer.alternativeEvent.district}</p><p><b>{money(altOffer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busy} onClick={()=>respondAltOffer(true)}>Accepter</button><button className="button secondary" disabled={busy} onClick={()=>respondAltOffer(false)}>Refuser</button></div></div>}
    {!user?<Link className="button full" to="/login">Se connecter pour vous inscrire</Link>
    :loadingApplication?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
    :application?<>
      <ApplicationStatusPanel application={application} event={event} onPaid={refreshApplication} onWaitlisted={markWaitlisted}/>
      {waitlistEntry?<div className="waitlist-status"><span className="eyebrow">LISTE D’ATTENTE</span><p>Position {waitlistEntry.rank??waitlistEntry.position}{waitlistEntry.offeredAt?" — une place vous a été proposée, consultez votre espace personnel":""}</p><button className="button secondary small" disabled={busy} onClick={leaveWaitlist}>Quitter la liste d’attente</button></div>
      :(categoryUnknown?<Notice kind="error">Complétez votre catégorie dans votre profil pour rejoindre la liste d’attente.</Notice>:(bucketFull&&canCancel&&<button className="button secondary full" disabled={busy} onClick={joinWaitlist}>Rejoindre la liste d’attente</button>))}
      {canCancel&&<button className="button danger full" disabled={busy} onClick={cancelApplication}>Annuler mon inscription</button>}
    </>
    :user.hasRestaurant?<Notice kind="info">Votre compte restaurateur vous permet de découvrir les événements proposés, mais ne permet pas d’y participer.</Notice>
    :requiresScreening&&!profileValidated?<Notice kind="error">Votre profil doit d’abord être validé lors d’un entretien avec Nour Meet avant de vous inscrire à un speed dating. <Link to="/dashboard">Demander mon entretien →</Link></Notice>
    :categoryUnknown?<Notice kind="error">Complétez votre catégorie (homme/femme) dans votre profil avant de vous inscrire à cet événement.</Notice>
    :requiresScreening&&showQuestionnaire?<QuestionnaireForm requiresScreening={requiresScreening} submitting={busy} onSubmit={apply}/>
    :<>{bucketFull&&<Notice kind="info">Cet événement est complet pour votre catégorie, mais vous pouvez tout de même candidater : une liste d’attente et une éventuelle proposition alternative vous seront proposées au moment de payer.</Notice>}<button className="button full" disabled={busy} onClick={()=>requiresScreening?setShowQuestionnaire(true):apply()}>{requiresScreening?"Candidater":busy?"…":"S’inscrire"}</button></>}
    <p className="fine">{requiresScreening?"Le paiement est proposé immédiatement après le questionnaire ; la place n’est acquise qu’une fois le paiement confirmé.":"Le paiement est proposé immédiatement après l’inscription ; la place n’est acquise qu’une fois le paiement confirmé."}</p></aside></section></Layout>;
}

// Comptes de test créés par prisma/seed.ts (voir ce fichier pour le détail de chaque état) : ces
// boutons ne sont affichés que lorsque le serveur tourne en mode SMS simulé (jamais en production,
// même si quelqu'un forçait NODE_ENV=production avec SMS_MODE=mock, ce que env.ts refuse déjà).
const QUICK_LOGIN_GROUPS: {title:string; items:{label:string; phone:string}[]}[] = [
  { title: "Administration", items: [
    { label: "Administrateur (Walid)", phone: "+33600000001" },
    { label: "Modérateur", phone: "+33600000031" },
    { label: "Personnel d'accueil", phone: "+33600000030" },
  ] },
  { title: "Restaurateurs", items: [
    { label: "Restaurateur approuvé (Maison Amana)", phone: "+33600000002" },
    { label: "Restaurateur en attente d'approbation", phone: "+33600000010" },
  ] },
  { title: "Participants (comptes de test)", items: [
    { label: "Homme validé", phone: "+33600000020" },
    { label: "Homme non validé", phone: "+33600000021" },
    { label: "Femme validée", phone: "+33600000022" },
    { label: "Femme non validée", phone: "+33600000023" },
    { label: "Refusé (délai de 3 mois en cours)", phone: "+33600000024" },
    { label: "Entretien demandé, aucun créneau réservé", phone: "+33600000025" },
  ] },
  { title: "Comptes de démonstration réels", items: [
    { label: "Sofia (participante, historique complet)", phone: "+33612345678" },
    { label: "Karim (participant, historique complet)", phone: "+33687654321" },
  ] },
];

function Login() {
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[step,setStep]=useState<1|2|3>(1),[error,setError]=useState(""),[devCode,setDevCode]=useState<string|null>(null); const {refresh}=useAuth(); const navigate=useNavigate();
  const [smsMode,setSmsMode]=useState<string|null>(null); const [quickLoginBusy,setQuickLoginBusy]=useState<string|null>(null);
  useEffect(()=>{api<{smsMode:string}>("/health").then(r=>setSmsMode(r.smsMode)).catch(()=>{})},[]);
  // isNewUser (renvoyé une seule fois, à la création du compte) déclenche l'écran de choix
  // participant/restaurateur (§5) avant toute navigation ; un compte déjà existant navigue tout de
  // suite comme avant, sans jamais revoir cet écran.
  const afterVerify=async(result:{token:string;isNewUser?:boolean;user:{role:string}})=>{
    setToken(result.token);await refresh();
    if(result.isNewUser){setStep(3);return}
    navigate(STAFF_ROLES.includes(result.user.role)?"/admin":"/dashboard");
  };
  const submit=async(e:FormEvent)=>{e.preventDefault();setError("");try{if(step===1){const result=await api<{delivery:"mock"|"sms";devCode?:string}>("/auth/request-otp",{method:"POST",body:JSON.stringify({phone})});setDevCode(result.devCode??null);setStep(2)}else{await afterVerify(await api<{token:string;isNewUser?:boolean;user:{role:string}}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone,code})}))}}catch(err){setError((err as Error).message)}};
  const quickLogin=async(label:string,quickPhone:string)=>{setError("");setQuickLoginBusy(label);try{await api("/auth/request-otp",{method:"POST",body:JSON.stringify({phone:quickPhone})});await afterVerify(await api<{token:string;isNewUser?:boolean;user:{role:string}}>("/auth/verify-otp",{method:"POST",body:JSON.stringify({phone:quickPhone,code:"123456"})}))}catch(err){setError((err as Error).message)}finally{setQuickLoginBusy(null)}};
  const quickLoginNew=()=>quickLogin("Nouveau compte","+336"+Math.floor(10_000_000+Math.random()*89_999_999));
  if(step===3)return <Layout><section className="auth-page"><div className="auth-visual" style={{backgroundImage:`linear-gradient(180deg,#0b0b0c40,#0b0b0cd8),url(${imgUrl("/static/defaults/auth-terrace.jpg")})`}}><blockquote>« Une belle rencontre commence par un cadre de confiance. »</blockquote></div><div className="auth-form"><span className="eyebrow">BIENVENUE</span><h1>Que souhaitez-vous faire sur Nūr Meet ?</h1><p>Ce choix détermine votre espace ; il ne peut être fait qu’une seule fois, à la création du compte.</p><div className="role-choice"><button type="button" className="button full" onClick={()=>navigate("/dashboard")}>Participer aux événements</button><button type="button" className="button secondary full" onClick={()=>navigate("/restaurant")}>Je suis restaurateur</button></div></div></section></Layout>;
  return <Layout><section className="auth-page"><div className="auth-visual" style={{backgroundImage:`linear-gradient(180deg,#0b0b0c40,#0b0b0cd8),url(${imgUrl("/static/defaults/auth-terrace.jpg")})`}}><blockquote>« Une belle rencontre commence par un cadre de confiance. »</blockquote></div><form className="auth-form" onSubmit={submit}><span className="eyebrow">CONNEXION SÉCURISÉE</span><h1>{step===1?"Votre numéro ouvre la porte.":"Entrez le code reçu."}</h1><p>{step===1?"Aucun mot de passe à mémoriser.":`Code envoyé au ${phone}`}</p>{error&&<Notice kind="error">{error}</Notice>}{step===1?<label>Numéro de téléphone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+33612345678" autoComplete="tel" inputMode="tel" required/></label>:<label>Code à six chiffres<input className="otp-input" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••••" autoComplete="one-time-code" inputMode="numeric" required/></label>}<button className="button full">{step===1?"Recevoir mon code":"Vérifier le code"}</button>{devCode&&<div className="demo-box"><b>Mode local — aucun SMS facturé</b><span>Code de développement : {devCode}</span></div>}{smsMode==="mock"&&<div className="quick-login"><b>Mode local — connexion rapide (jamais en production)</b>{QUICK_LOGIN_GROUPS.map(group=><div key={group.title}><small>{group.title}</small><div className="quick-login-grid">{group.items.map(item=><button type="button" key={item.phone} disabled={!!quickLoginBusy} onClick={()=>quickLogin(item.label,item.phone)}>{quickLoginBusy===item.label?"…":item.label}</button>)}</div></div>)}<div><small>Autre</small><div className="quick-login-grid"><button type="button" disabled={!!quickLoginBusy} onClick={quickLoginNew}>{quickLoginBusy==="Nouveau compte"?"…":"Nouveau compte (jamais inscrit)"}</button></div></div></div>}</form></section></Layout>;
}

function ProfileEditor({onSaved}:{onSaved:()=>void}) {
  const {user}=useAuth(); const [form,setForm]=useState({displayName:user?.displayName??"",email:user?.email??"",birthDate:user?.profile?.birthDate?String(user.profile.birthDate).slice(0,10):"",city:user?.profile?.city??"",profession:user?.profile?.profession??"",interests:(user?.profile?.interests??[]).join(", "),bio:user?.profile?.bio??"",quotaCategory:user?.profile?.quotaCategory??""});const [message,setMessage]=useState("");
  const [photoBusy,setPhotoBusy]=useState(false);
  const save=async(e:FormEvent)=>{e.preventDefault();await api("/me/profile",{method:"PATCH",body:JSON.stringify({...form,email:form.email||null,quotaCategory:form.quotaCategory||null,interests:form.interests.split(",").map((x:string)=>x.trim()).filter(Boolean)})});setMessage("Profil enregistré.");onSaved()};
  const uploadPhoto=async(file:File)=>{
    setPhotoBusy(true);setMessage("");
    try{const body=new FormData();body.append("file",file);await api("/me/profile-photo",{method:"POST",body});onSaved()}
    catch(err){setMessage((err as Error).message)}
    finally{setPhotoBusy(false)}
  };
  const removePhoto=async()=>{
    setPhotoBusy(true);setMessage("");
    try{await api("/me/profile-photo",{method:"DELETE"});onSaved()}
    catch(err){setMessage((err as Error).message)}
    finally{setPhotoBusy(false)}
  };
  return <form className="panel form-grid" onSubmit={save}><div className="panel-title"><h2>Mon profil</h2><span>Informations privées</span></div>{message&&<Notice kind="success">{message}</Notice>}
    <div className="wide profile-photo-editor"><Avatar name={user?.displayName} photoUrl={user?.profile?.photoUrl} size="large" verified={!!user?.profile?.validatedAt}/><div>
      <label className="button small secondary">{photoBusy?"Envoi…":user?.profile?.photoUrl?"Changer la photo":"Ajouter une photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={photoBusy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadPhoto(f);e.target.value=""}}/></label>
      {user?.profile?.photoUrl&&<button type="button" className="link-button" disabled={photoBusy} onClick={removePhoto}>Retirer</button>}
      <p className="fine left">JPEG, PNG ou WEBP · 5 Mo maximum. Visible par les personnes avec qui vous échangez.</p>
    </div></div>
    <label>Prénom ou pseudonyme<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label><label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Date de naissance<input type="date" value={form.birthDate} onChange={e=>setForm({...form,birthDate:e.target.value})}/></label><label>Ville<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label><label>Profession<input value={form.profession} onChange={e=>setForm({...form,profession:e.target.value})}/></label><label>Centres d’intérêt<input value={form.interests} onChange={e=>setForm({...form,interests:e.target.value})}/></label><label>Sexe<div className="chip-toggle">{([["","Non renseigné"],["HOMME","Homme"],["FEMME","Femme"]] as const).map(([value,label])=><button key={value} type="button" className={"chip"+(form.quotaCategory===value?" active":"")} onClick={()=>setForm({...form,quotaCategory:value})}>{label}</button>)}</div></label><label className="wide">Biographie<textarea value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})}/></label><button className="button">Enregistrer</button></form>;
}

// Droits RGPD (§20) : export en un clic, et suppression en deux étapes (jamais un seul clic pour
// une action irréversible) qui déconnecte immédiatement puisque le compte n'est plus utilisable.
function PrivacyPanel() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const download = async () => {
    setBusy(true); setNotice(null);
    try {
      const data = await api<object>("/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `nour-meet-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setNotice({ kind: "error", text: (err as Error).message }) }
    finally { setBusy(false) }
  };

  const confirmDeletion = async () => {
    setBusy(true); setNotice(null);
    try { await api("/me/request-deletion", { method: "POST" }); logout() }
    catch (err) { setNotice({ kind: "error", text: (err as Error).message }); setBusy(false) }
  };

  return <div className="panel">
    <div className="panel-title"><h2>Mes données</h2><span>RGPD</span></div>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <p className="fine left">Téléchargez une copie de tout ce que nous détenons sur votre compte (profil, candidatures, réservations, paiements), ou demandez la suppression de votre compte.</p>
    <div className="decision-buttons">
      <button type="button" className="button secondary" disabled={busy} onClick={download}>Télécharger mes données</button>
      {!confirming
        ? <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(true)}>Supprimer mon compte</button>
        : <button type="button" className="button danger" disabled={busy} onClick={confirmDeletion}>Confirmer la suppression définitive</button>}
    </div>
    {confirming && <p className="fine left">Vos coordonnées et informations personnelles seront anonymisées ; les paiements déjà effectués restent conservés à des fins comptables et légales. Cette action est irréversible. Si vous avez une réservation active pour un événement à venir, annulez-la d’abord.</p>}
  </div>;
}

const emptyRestaurantForm={name:"",managerName:"",siret:"",description:"",district:"",address:"",phone:"",desiredCapacity:"",desiredSchedule:"",averagePricePerPersonCents:"",defaultMinParticipants:"",priceIncludesDrink:false,priceIncludesStarter:false,priceIncludesMain:false,priceIncludesDessert:false,priceNotes:"",proposesCategoryPricing:false,allowsPrivatization:false,specialConditions:""};
function RestaurantApplication() {
  const [restaurant,setRestaurant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState(emptyRestaurantForm);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [submitting,setSubmitting]=useState(false);

  const load=()=>api<any>("/restaurants/me").then(r=>{setRestaurant(r);setForm({...emptyRestaurantForm,name:r.name??"",managerName:r.managerName??"",siret:r.siret??"",description:r.description??"",district:r.district??"",address:r.address??"",phone:r.phone??"",desiredCapacity:r.desiredCapacity??"",desiredSchedule:r.desiredSchedule??"",averagePricePerPersonCents:r.averagePricePerPersonCents!=null?String(r.averagePricePerPersonCents/100):"",defaultMinParticipants:r.defaultMinParticipants??"",priceIncludesDrink:!!r.priceIncludesDrink,priceIncludesStarter:!!r.priceIncludesStarter,priceIncludesMain:!!r.priceIncludesMain,priceIncludesDessert:!!r.priceIncludesDessert,priceNotes:r.priceNotes??"",proposesCategoryPricing:!!r.proposesCategoryPricing,allowsPrivatization:!!r.allowsPrivatization,specialConditions:r.specialConditions??""})}).catch(()=>setRestaurant(null)).finally(()=>setLoading(false));
  useEffect(()=>{load()},[]);

  const payload=()=>({...form,desiredCapacity:form.desiredCapacity?Number(form.desiredCapacity):undefined,defaultMinParticipants:form.defaultMinParticipants?Number(form.defaultMinParticipants):undefined,averagePricePerPersonCents:form.averagePricePerPersonCents?Math.round(Number(form.averagePricePerPersonCents)*100):undefined});

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{await api("/restaurants/apply",{method:"POST",body:JSON.stringify(payload())});setNotice({kind:"success",text:"Votre demande a été envoyée."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };
  const saveProfile=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{await api("/restaurants/me",{method:"PATCH",body:JSON.stringify(payload())});setNotice({kind:"success",text:"Fiche mise à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };
  const uploadPhoto=async(file:File)=>{
    const body=new FormData();body.append("file",file);
    try{await api("/restaurants/me/photos",{method:"POST",body});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const removePhoto=async(photoId:string)=>{try{await api(`/restaurants/me/photos/${photoId}`,{method:"DELETE"});await load()}catch(err){setNotice({kind:"error",text:(err as Error).message})}};

  const priceFields=(f:typeof form,set:(f:typeof form)=>void)=><>
    <label>Places pour la soirée<input type="number" min={1} value={f.desiredCapacity} onChange={e=>set({...f,desiredCapacity:e.target.value})}/></label>
    <label>Jours et horaires souhaités<input value={f.desiredSchedule} onChange={e=>set({...f,desiredSchedule:e.target.value})} placeholder="Vendredi et samedi soir"/></label>
    <label>Prix moyen par personne (€)<input type="number" min={0} step="0.01" value={f.averagePricePerPersonCents} onChange={e=>set({...f,averagePricePerPersonCents:e.target.value})}/></label>
    <label>Minimum de participants habituel<input type="number" min={1} value={f.defaultMinParticipants} onChange={e=>set({...f,defaultMinParticipants:e.target.value})}/></label>
    <label className="wide">Le prix comprend habituellement<div className="chips-input"><label><input type="checkbox" checked={f.priceIncludesDrink} onChange={e=>set({...f,priceIncludesDrink:e.target.checked})}/> Boisson</label><label><input type="checkbox" checked={f.priceIncludesStarter} onChange={e=>set({...f,priceIncludesStarter:e.target.checked})}/> Entrée</label><label><input type="checkbox" checked={f.priceIncludesMain} onChange={e=>set({...f,priceIncludesMain:e.target.checked})}/> Plat</label><label><input type="checkbox" checked={f.priceIncludesDessert} onChange={e=>set({...f,priceIncludesDessert:e.target.checked})}/> Dessert</label></div></label>
    <label className="wide">Précisions sur le contenu du prix<textarea value={f.priceNotes} onChange={e=>set({...f,priceNotes:e.target.value})}/></label>
    <label><input type="checkbox" checked={f.proposesCategoryPricing} onChange={e=>set({...f,proposesCategoryPricing:e.target.checked})}/> Je propose des tarifs par catégorie (homme/femme)</label>
    <label><input type="checkbox" checked={f.allowsPrivatization} onChange={e=>set({...f,allowsPrivatization:e.target.checked})}/> Privatisation possible</label>
    <label className="wide">Conditions particulières<textarea value={f.specialConditions} onChange={e=>set({...f,specialConditions:e.target.value})}/></label>
  </>;

  if(loading) return <Loading/>;
  if(restaurant?.status==="PENDING") return <div className="panel"><Notice kind="info">Votre demande pour « {restaurant.name} » est en cours d’examen.</Notice></div>;
  if(restaurant?.status==="APPROVED") return <div className="stack">
    <div className="panel"><Notice kind="success">Votre établissement « {restaurant.name} » est approuvé. <Link to="/admin">Accéder à mon espace restaurateur →</Link></Notice>
      {restaurant.subscription&&<p className="fine">Abonnement « {restaurant.subscription.plan.name} » — {(restaurant.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois — statut : <b>{restaurant.subscription.status}</b> — {restaurant.currentMonthEventsPublished}{restaurant.subscription.plan.monthlyEventQuota==null?" événements publiés ce mois-ci (illimité)":`/${restaurant.subscription.plan.monthlyEventQuota} événements publiés ce mois-ci`}.</p>}
    </div>
    <form className="panel form-grid" onSubmit={saveProfile}>
      <div className="panel-title"><h2>Fiche établissement</h2><span>Visible par l’administration</span></div>
      {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
      {priceFields(form,setForm)}
      <button className="button" disabled={submitting}>{submitting?"Enregistrement…":"Enregistrer"}</button>
    </form>
    <div className="panel">
      <div className="panel-title"><h2>Galerie</h2><span>{(restaurant.photos??[]).length}/8 photos</span></div>
      <div className="event-photo-grid">{(restaurant.photos??[]).map((p:any)=><div key={p.id} className="event-photo"><img src={imgUrl(p.url)} alt=""/><button type="button" className="link-button" onClick={()=>removePhoto(p.id)}>Retirer</button></div>)}</div>
      <label className="fine">Ajouter une photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>e.target.files?.[0]&&uploadPhoto(e.target.files[0])}/></label>
    </div>
  </div>;

  return <form className="panel form-grid" onSubmit={submit}>
    <div className="panel-title"><h2>Devenir restaurateur</h2><span>Ouvrir un compte professionnel</span></div>
    {restaurant?.status==="REJECTED"&&<Notice kind="error">Votre précédente demande n’a pas été retenue{restaurant.rejectionReason?` : ${restaurant.rejectionReason}`:"."} Vous pouvez soumettre une nouvelle demande.</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <label>Nom de l’établissement<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label>Nom du responsable<input required value={form.managerName} onChange={e=>setForm({...form,managerName:e.target.value})}/></label>
    <label>SIRET (14 chiffres)<input required pattern="\d{14}" title="14 chiffres" value={form.siret} onChange={e=>setForm({...form,siret:e.target.value.replace(/\D/g,"").slice(0,14)})}/></label>
    <label>Téléphone professionnel<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
    <label>Quartier / ville<input value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
    <label>Adresse<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
    <label className="wide">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    {priceFields(form,setForm)}
    <p className="fine wide">Le SIRET est déclaratif : Nour ne réalise pas de vérification officielle auprès d’un registre. La galerie de photos se complète après approbation.</p>
    <button className="button" disabled={submitting}>{submitting?"Envoi…":"Envoyer ma demande"}</button>
  </form>;
}

// Espace dédié aux comptes restaurateurs (candidature en cours ou déjà approuvée) : plus un onglet
// du dashboard participant (§5), car un restaurateur n'a plus le droit d'y accéder aux fonctions de
// participation. Un compte en attente d'approbation garde par ailleurs un accès normal au reste du
// site public (événements, concept, blog) ; seule la participation elle-même est bloquée côté serveur.
// C01/C13 (ordre correctif 2026-09-20) : cette page reste accessible AUSSI après approbation (rôle
// ORGANIZER) — jusqu'ici /restaurant n'acceptait que PARTICIPANT et redirigeait tout restaurateur
// déjà approuvé vers /admin, le laissant sans aucun moyen d'atteindre son abonnement ou ses
// notifications propres. Onglets Abonnement/Notifications pilotables par ?tab= (ex. depuis une
// notification cliquable) une fois qu'un dossier restaurateur existe (en attente ou approuvé).
function RestaurantSpace() {
  const [searchParams]=useSearchParams();
  const [restaurant,setRestaurant]=useState<any>(undefined);
  const [tab,setTab]=useState(searchParams.get("tab")??"establishment");
  const [unread,setUnread]=useState(0);
  const loadRestaurant=()=>api<any>("/restaurants/me").then(setRestaurant).catch(()=>setRestaurant(null));
  useEffect(()=>{loadRestaurant()},[]);
  // C14 : une notification cliquée navigue vers /restaurant?tab=X sans démonter ce composant (même
  // route) — sans cette synchronisation, l'onglet affiché resterait celui d'avant le clic.
  useEffect(()=>{const t=searchParams.get("tab");if(t)setTab(t)},[searchParams]);
  useEffect(()=>{if(restaurant)api<{count:number}>("/notifications/unread-count").then(r=>setUnread(r.count)).catch(()=>{})},[restaurant,tab]);
  if(restaurant===undefined)return <Layout><Loading/></Layout>;
  const hasTabs=restaurant&&(restaurant.status==="PENDING"||restaurant.status==="APPROVED");
  return <Layout><section className="page"><span className="eyebrow">ESPACE RESTAURATEUR</span><h1>Mon établissement</h1>
    {hasTabs&&<div className="filters">
      <button type="button" className={tab==="establishment"?"button small":"button small secondary"} onClick={()=>setTab("establishment")}>Mon établissement</button>
      <button type="button" className={tab==="subscription"?"button small":"button small secondary"} onClick={()=>setTab("subscription")}>Abonnement</button>
      <button type="button" className={tab==="notifications"?"button small":"button small secondary"} onClick={()=>setTab("notifications")}>🔔 Notifications{unread>0?` (${unread})`:""}</button>
    </div>}
    {(!hasTabs||tab==="establishment")&&<RestaurantApplication/>}
    {hasTabs&&tab==="subscription"&&<RestaurantSubscriptionPanel restaurant={restaurant} onChanged={loadRestaurant}/>}
    {hasTabs&&tab==="notifications"&&<RestaurantNotificationsPanel onUnreadChange={setUnread}/>}
  </section></Layout>;
}
// C01-C09 (instructions définitives 2026-09-20) : vraie page abonnement — deux formules, bascule
// mensuel/annuel, tunnel Stripe Checkout réel (carte obligatoire, essai 7 jours géré par Stripe),
// résiliation programmée en fin de période, portail de facturation. Accessible dès PENDING.
function RestaurantSubscriptionPanel({restaurant,onChanged}:{restaurant:any;onChanged:()=>void}){
  const [searchParams]=useSearchParams();
  const [plans,setPlans]=useState<any[]>([]);
  const [period,setPeriod]=useState<"MONTHLY"|"ANNUAL">("MONTHLY");
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(
    searchParams.get("checkout")==="success"?{kind:"success",text:"Moyen de paiement enregistré. Votre essai de 7 jours a commencé."}:
    searchParams.get("checkout")==="cancel"?{kind:"error",text:"Souscription annulée avant la fin du paiement."}:null
  );
  useEffect(()=>{api<any[]>("/plans").then(setPlans).catch(()=>{})},[]);
  const subscription=restaurant.subscription;
  const checkout=async(planId:string)=>{
    setBusy(planId);setNotice(null);
    try{const {url}=await api<{url:string}>("/restaurants/me/subscription/checkout",{method:"POST",body:JSON.stringify({planId,billingPeriod:period})});window.location.href=url}
    catch(err){setNotice({kind:"error",text:(err as Error).message});setBusy(null)}
  };
  const cancel=async()=>{
    setBusy("cancel");setNotice(null);
    try{await api("/restaurants/me/subscription/cancel",{method:"POST"});setNotice({kind:"success",text:"Résiliation programmée : vos avantages restent actifs jusqu’à la fin de la période déjà payée."});onChanged()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const openPortal=async()=>{
    setBusy("portal");setNotice(null);
    try{const {url}=await api<{url:string}>("/restaurants/me/subscription/portal",{method:"POST"});window.location.href=url}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  return <div className="stack">
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {subscription?<div className="panel">
      <div className="panel-title"><h2>Mon abonnement</h2><span>{SUBSCRIPTION_STATUS_LABEL[subscription.status]??subscription.status}</span></div>
      <p className="fine left">Formule <b>{subscription.plan.name}</b> ({subscription.billingPeriod==="ANNUAL"?"annuel":"mensuel"}) — {subscription.cancelAtPeriodEnd?"résiliation programmée, ":""}
        {subscription.status==="CANCELLED"?"résilié":`échéance le ${new Date(subscription.currentPeriodEnd).toLocaleDateString("fr-FR")}`}.</p>
      <p className="fine left">Quota ce mois-ci : {restaurant.currentMonthEventsPublished}{subscription.plan.monthlyEventQuota==null?" événements publiés (illimité)":`/${subscription.plan.monthlyEventQuota} événements publiés`}.</p>
      <div className="decision-buttons">
        {subscription.stripeCustomerId&&<button type="button" className="button secondary" disabled={!!busy} onClick={openPortal}>Gérer mon moyen de paiement</button>}
        {!subscription.cancelAtPeriodEnd&&subscription.status!=="CANCELLED"&&<button type="button" className="button danger" disabled={!!busy} onClick={cancel}>Résilier</button>}
      </div>
    </div>:<>
      <div className="filters"><button type="button" className={period==="MONTHLY"?"button small":"button small secondary"} onClick={()=>setPeriod("MONTHLY")}>Mensuel</button><button type="button" className={period==="ANNUAL"?"button small":"button small secondary"} onClick={()=>setPeriod("ANNUAL")}>Annuel (2 mois offerts)</button></div>
      <div className="feature-grid">{plans.map(p=><div key={p.id}>
        <b style={{color:"var(--gold)"}}>{p.name}</b>
        <h3>{money(period==="ANNUAL"?p.annualPriceCents:p.monthlyPriceCents)}{period==="ANNUAL"?"/an":"/mois"}</h3>
        <p>{p.monthlyEventQuota==null?"Événements illimités":`${p.monthlyEventQuota} événements publiés par mois`}</p>
        <p>{p.highlightTier==="priority"?"Mise en avant prioritaire des soirées et de l’établissement":p.highlightTier==="simple"?"Mise en avant simple des soirées et de l’établissement":""}</p>
        <p className="fine">Essai gratuit de 7 jours, carte requise, résiliable avant l’échéance.</p>
        <button type="button" className="button full" disabled={!!busy} onClick={()=>checkout(p.id)}>{busy===p.id?"…":"Choisir cette formule"}</button>
      </div>)}</div>
      <p className="fine">Le choix de la formule est indépendant de la publication de vos soirées, qui reste soumise à validation admin.</p>
    </>}
  </div>;
}
const SUBSCRIPTION_STATUS_LABEL:Record<string,string>={TRIALING:"Essai en cours",ACTIVE:"Actif",PAST_DUE:"Paiement en échec",CANCELLED:"Résilié",INCOMPLETE:"Incomplet"};
function RestaurantNotificationsPanel({onUnreadChange}:{onUnreadChange:(n:number)=>void}){
  const [items,setItems]=useState<any[]>([]);
  const load=()=>api<any[]>("/notifications").then(setItems);
  useEffect(()=>{load()},[]);
  return <div className="panel"><div className="panel-title"><h2>Notifications</h2></div>
    <NotificationList items={items} onRead={id=>{setItems(items.map(n=>n.id===id?{...n,readAt:new Date().toISOString()}:n));onUnreadChange(items.filter(n=>!n.readAt&&n.id!==id).length)}}/>
  </div>;
}

function GlobalInterviewPanel() {
  const {user}=useAuth();
  const [status,setStatus]=useState<any>(undefined);
  const [motivation,setMotivation]=useState("");
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [schedulingId,setSchedulingId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);

  const load=()=>api<any>("/me/global-interview").then(setStatus).catch(()=>setStatus(null));
  useEffect(()=>{load()},[]);

  useEffect(()=>{
    if(!status||status.status!=="PENDING_CALL"||status.call){setSlots([]);return}
    let ignore=false; setLoadingSlots(true);
    api<any[]>("/interview-slots").then(s=>!ignore&&setSlots(s)).catch(()=>!ignore&&setSlots([])).finally(()=>!ignore&&setLoadingSlots(false));
    return ()=>{ignore=true};
  },[status?.status,status?.call]);

  const request=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{await api("/me/global-interview",{method:"POST",body:JSON.stringify({motivation})});setMotivation("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const schedule=async(slotId:string)=>{
    setSchedulingId(slotId);setNotice(null);
    try{const result=await api<any>(`/applications/${status.id}/schedule`,{method:"POST",body:JSON.stringify({slotId})});setStatus({...status,status:"CALL_SCHEDULED",call:result.slot});setNotice({kind:"success",text:"Votre entretien est confirmé."})}
    catch(err){setNotice({kind:"error",text:(err as Error).message});api<any[]>("/interview-slots").then(setSlots).catch(()=>{})}
    finally{setSchedulingId(null)}
  };
  const cancel=async()=>{
    setBusy(true);setNotice(null);
    try{await api(`/me/applications/${status.id}/cancel`,{method:"POST"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  const requestForm=<form onSubmit={request}><label>Votre motivation<textarea required minLength={30} value={motivation} onChange={e=>setMotivation(e.target.value)} placeholder="Expliquez en quelques lignes ce que vous recherchez…"/></label><button className="button" disabled={busy}>{busy?"Envoi…":"Demander mon entretien"}</button></form>;

  if(status===undefined) return <Loading/>;
  return <div className="panel form-grid">
    <div className="panel-title"><h2>Entretien de validation du profil</h2><span>Obligatoire une fois avant de pouvoir vous inscrire à un événement</span></div>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {user?.profile?.validatedAt?<Notice kind="success">Votre profil est validé : vous pouvez vous inscrire directement aux événements.</Notice>
    :!status||status.status==null?requestForm
    :status.status==="REFUSED"?(
      status.retryAvailableAt && new Date(status.retryAvailableAt)>new Date()
        ? <><Notice kind="error">Votre profil n’a pas été validé{status.notes?` : ${status.notes}`:"."}</Notice><p className="fine">Vous pourrez redemander un entretien à partir du {new Date(status.retryAvailableAt).toLocaleDateString("fr-FR")}.</p></>
        : <>{status.notes&&<Notice kind="error">{status.notes}</Notice>}{requestForm}</>
    )
    :status.status==="PENDING_CALL"&&!status.call?<><CallCalendar slots={slots} loading={loadingSlots} onSelect={schedule} schedulingId={schedulingId}/><button type="button" className="button secondary small" disabled={busy} onClick={cancel}>Annuler ma demande</button></>
    :status.call?<div className="call-scheduled"><span className="eyebrow">ENTRETIEN PROGRAMMÉ</span><strong>{dateTime(status.call.startsAt)}</strong><p>Nour Meet vous appellera à cette heure, puis vous serez informé(e) de la décision.</p><button type="button" className="button secondary small" disabled={busy} onClick={cancel}>Annuler</button></div>
    :null}
  </div>;
}

function Dashboard() {
  const {user,refresh}=useAuth(); const [searchParams]=useSearchParams();
  // C14 (ordre correctif 2026-09-20) : permet aux notifications de renvoyer vers un onglet précis,
  // ex. /dashboard?tab=tickets, plutôt qu'un lien générique vers l'espace participant.
  const [apps,setApps]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[notifications,setNotifications]=useState<any[]>([]),[offers,setOffers]=useState<any[]>([]),[tab,setTab]=useState(searchParams.get("tab")??"reservations"),[payingFor,setPayingFor]=useState<{applicationId:string;eventId:string;amountCents:number}|null>(null),[busyId,setBusyId]=useState<string|null>(null),[message,setMessage]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/me/applications"),api<any[]>("/me/tickets"),api<any[]>("/notifications"),api<any[]>("/me/alternative-offers")]).then(([a,t,n,o])=>{setApps(a);setTickets(t);setNotifications(n);setOffers(o)}); useEffect(()=>{load()},[]);
  useEffect(()=>{const t=searchParams.get("tab");if(t)setTab(t)},[searchParams]);
  // Un compte restaurateur n'a rien à faire dans l'espace participant (§5) : on le renvoie vers sa
  // propre fiche établissement plutôt que de lui laisser voir un tableau de bord vide. Ce contrôle
  // vient après tous les hooks du composant : jamais avant, pour ne pas en varier le nombre au fil des
  // rendus (règle des Hooks).
  if(user?.hasRestaurant)return <Navigate to="/restaurant" replace/>;
  const pendingOffers=offers.filter(o=>o.status==="PENDING");
  const cancelApplication=async(appId:string)=>{
    setBusyId(appId);setMessage(null);
    try{
      const result=await api<{refunded:boolean;refundedAmountCents:number|null;eligible:boolean|null}>(`/me/applications/${appId}/cancel`,{method:"POST"});
      const text=result.refunded?`Candidature annulée. ${money(result.refundedAmountCents!)} ont été remboursés intégralement.`
        :result.eligible===false?"Candidature annulée. Conformément à notre politique, aucun remboursement n’est possible pour une annulation à 24 heures ou moins de l’événement."
        :"Candidature annulée.";
      setMessage({kind:"success",text});await load();
    }
    catch(err){setMessage({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  // Cahier des charges consolidé final (2026-09-20, section 3) : une soirée gratuite ne passe jamais
  // par Stripe (aucun PaymentIntent à 0 €) — confirmation directe, billet immédiat si une place est
  // réellement disponible, sinon liste d'attente comme pour un événement payant.
  const confirmFree=async(appId:string)=>{
    setBusyId(appId);setMessage(null);
    try{
      const result=await api<{free:boolean;confirmed:boolean}>(`/applications/${appId}/payment-intent`,{method:"POST"});
      setMessage({kind:"success",text:result.confirmed?"Votre billet gratuit est confirmé.":"Votre place a déjà été confirmée."});await load();
    }catch(err){setMessage({kind:"error",text:(err as Error).message});await load()}
    finally{setBusyId(null)}
  };
  const respondOffer=async(offerId:string, accept:boolean)=>{
    setBusyId(offerId);setMessage(null);
    try{await api(`/alternative-offers/${offerId}/respond`,{method:"POST",body:JSON.stringify({accept})});setMessage({kind:"success",text:accept?"Place réservée : réglez votre billet avant expiration.":"Proposition refusée."});await load()}
    catch(err){setMessage({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const eventApps=apps.filter(a=>a.eventId);
  const ticketsLabel=tickets.length===1?"Mon billet":"Mes billets";
  const tabs=[["interview",user?.profile?.validatedAt?"Entretien ✓":"Entretien"],["reservations","Réservations"],["tickets",ticketsLabel],["profile","Profil"],["notifications","Notifications"]];
  const titles:Record<string,string>={interview:"Entretien de validation",reservations:"Mes événements",tickets:ticketsLabel,profile:"Mon profil",notifications:"Notifications"};
  return <Layout><section className="dashboard-shell"><aside><div className="profile-card"><Avatar name={user?.displayName} photoUrl={user?.profile?.photoUrl} size="large" verified={!!user?.profile?.validatedAt}/><h3>{user?.displayName}</h3><span>{user?.profile?.validatedAt?"Profil validé":"Profil à compléter"}</span></div>{tabs.map(([id,label])=><button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}<span>›</span></button>)}</aside><div className="dashboard-content"><span className="eyebrow">ESPACE PARTICIPANT</span><h1>{titles[tab]}</h1>{message&&<Notice kind={message.kind}>{message.text}</Notice>}{tab==="interview"&&<GlobalInterviewPanel/>}{tab==="reservations"&&<div className="stack">{eventApps.length===0?<div className="empty small"><span>◇</span><p>Aucune inscription pour le moment.</p></div>:eventApps.map(a=>{const offersForEvent=pendingOffers.filter(o=>o.originalEventId===a.eventId);return <article className="reservation" key={a.id}><img className="reservation-photo" src={imgUrl(a.event.imageUrl)} alt=""/><div><div className="admin-event-meta"><CategoryBadge category={a.event.category} className="inline"/><small>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</small></div><h3>{a.event.title}</h3><p>{dateTime(a.event.startsAt)} · {a.event.district}</p>{a.call&&a.status==="CALL_SCHEDULED"&&<p className="call-hint">Entretien : {dateTime(a.call.startsAt)}</p>}{offersForEvent.map(offer=><article className="alt-offer nested" key={offer.id}><span className="eyebrow">ÉVÉNEMENT ALTERNATIF PROPOSÉ</span><h3>{offer.alternativeEvent.title}</h3><p>{dateTime(offer.alternativeEvent.startsAt)} · {offer.alternativeEvent.district}</p><p><b>{money(offer.alternativeEvent.priceCents)}</b></p><div className="decision-buttons"><button className="button" disabled={busyId===offer.id} onClick={()=>respondOffer(offer.id,true)}>Accepter</button><button className="button secondary" disabled={busyId===offer.id} onClick={()=>respondOffer(offer.id,false)}>Pas intéressé</button></div></article>)}</div><div className="reservation-actions">{a.status==="PAYMENT_PENDING"&&(a.event.priceCents===0?<button className="button" disabled={busyId===a.id} onClick={()=>confirmFree(a.id)}>{busyId===a.id?"…":"Confirmer ma place (gratuit)"}</button>:<button className="button" onClick={()=>setPayingFor({applicationId:a.id,eventId:a.event.id,amountCents:a.event.priceCents})}>Payer par carte · {money(a.event.priceCents)}</button>)}{!["REFUSED","CANCELLED"].includes(a.status)&&<button className="button secondary small" disabled={busyId===a.id} onClick={()=>cancelApplication(a.id)}>Annuler ma participation</button>}</div></article>;})}</div>}{tab==="tickets"&&<div className="ticket-grid">{tickets.map(t=><article className="ticket" key={t.id}><div><div className="admin-event-meta"><CategoryBadge category={t.reservation.event.category} className="inline"/></div><span className="eyebrow">{dateTime(t.reservation.event.startsAt)}</span><h2>{t.reservation.event.title}</h2>{t.reservation.event.controllerRestaurant&&<p>{t.reservation.event.controllerRestaurant.name}</p>}<p>{t.reservation.event.district}</p></div><img src={t.qrDataUrl} alt={`QR code du billet ${t.code}`}/><b>{t.code}</b></article>)}</div>}{tab==="profile"&&<div className="stack"><ProfileEditor onSaved={refresh}/><PrivacyPanel/></div>}{tab==="notifications"&&<NotificationList items={notifications} onRead={id=>setNotifications(notifications.map(n=>n.id===id?{...n,readAt:new Date().toISOString()}:n))}/>}</div></section>
  {payingFor&&<PaymentModal applicationId={payingFor.applicationId} eventId={payingFor.eventId} amountCents={payingFor.amountCents} onClose={()=>setPayingFor(null)} onConfirmed={()=>{setPayingFor(null);load()}} onWaitlisted={()=>{setPayingFor(null);load()}}/>}
  </Layout>;
}

const emptyDashboardFilters={eventId:"",category:"",status:"",city:"",minAge:"",maxAge:""};
function Admin() {
  const {user}=useAuth();
  const showStats = user?.role==="ADMIN"||user?.role==="ORGANIZER";
  const [periodDays,setPeriodDays]=useState(30);
  const [filters,setFilters]=useState(emptyDashboardFilters);
  const [events,setEvents]=useState<any[]>([]);
  useEffect(()=>{if(showStats)api<any[]>("/admin/events").then(setEvents).catch(()=>{})},[showStats]);
  const [stats,setStats]=useState<any>(null);
  useEffect(()=>{
    if(!showStats)return;
    const params=new URLSearchParams({since:new Date(Date.now()-periodDays*86_400_000).toISOString()});
    if(filters.eventId)params.set("eventId",filters.eventId);
    if(filters.category)params.set("category",filters.category);
    if(filters.status)params.set("status",filters.status);
    if(filters.city)params.set("city",filters.city);
    if(filters.minAge)params.set("minAge",filters.minAge);
    if(filters.maxAge)params.set("maxAge",filters.maxAge);
    api(`/admin/dashboard?${params}`).then(setStats);
  },[showStats,periodDays,filters]);
  if(!showStats) return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">{user?.role==="MODERATOR"?"MODÉRATION":"ACCUEIL"}</span><h1>Bienvenue, {user?.displayName}</h1><p className="fine">{user?.role==="MODERATOR"?"Utilisez le menu pour traiter les signalements.":"Utilisez le menu pour scanner les billets de l’établissement."}</p></div></section></Layout>;
  const SUBSCRIPTION_STATUS_LABEL:Record<string,string>={TRIALING:"Essai",ACTIVE:"Actifs",PAST_DUE:"Impayés",CANCELLED:"Résiliés",INCOMPLETE:"Incomplets"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><div className="admin-heading"><div><span className="eyebrow">{user?.role==="ADMIN"?"SUPER-ADMINISTRATION":"ESPACE RESTAURATEUR"}</span><h1>Tableau de bord {user?.role==="ADMIN"?"général":"de mon établissement"}</h1></div><select value={periodDays} onChange={e=>setPeriodDays(Number(e.target.value))}><option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option></select></div>
  <div className="filters">
    <select value={filters.eventId} onChange={e=>setFilters({...filters,eventId:e.target.value})}><option value="">Tous les événements</option>{events.map((ev:any)=><option key={ev.id} value={ev.id}>{ev.title}</option>)}</select>
    <select value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="">Toutes les catégories</option>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select>
    <select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Tous statuts</option>{Object.entries(EVENT_STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
    <input value={filters.city} onChange={e=>setFilters({...filters,city:e.target.value})} placeholder="Ville"/>
    <input type="number" min={0} value={filters.minAge} onChange={e=>setFilters({...filters,minAge:e.target.value})} placeholder="Âge min"/>
    <input type="number" min={0} value={filters.maxAge} onChange={e=>setFilters({...filters,maxAge:e.target.value})} placeholder="Âge max"/>
    {JSON.stringify(filters)!==JSON.stringify(emptyDashboardFilters)&&<button type="button" className="button small secondary" onClick={()=>setFilters(emptyDashboardFilters)}>Réinitialiser</button>}
  </div>
  {!stats?<Loading/>:<><div className="stat-grid">
    <Stat label="Candidatures (30j)" value={stats.applications}/>
    {stats.acceptanceRate!=null&&<Stat label="Taux d’acceptation (entretien)" value={`${stats.acceptanceRate}%`}/>}
    <Stat label="Événements à venir" value={stats.upcomingEvents}/>
    <Stat label="Événements au total" value={stats.events}/>
    <Stat label="Places restantes" value={stats.remainingSpots}/>
    <Stat label="Billets vendus (30j)" value={stats.ticketsSold}/>
    <Stat label="Sur liste d’attente" value={stats.waitlisted}/>
    <Stat label="Revenus (30j)" value={money(stats.revenueCents)}/>
    {stats.openReports!=null&&<Stat label="Signalements ouverts" value={stats.openReports}/>}
    {stats.pendingInterviews!=null&&<Stat label="Entretiens en attente" value={stats.pendingInterviews}/>}
    {stats.upcomingInterviews!=null&&<Stat label="Entretiens à venir" value={stats.upcomingInterviews}/>}
    {stats.pendingRestaurantApplications!=null&&<Stat label="Demandes restaurateurs" value={stats.pendingRestaurantApplications}/>}
    {stats.pendingPayments!=null&&<Stat label="Paiements en attente" value={stats.pendingPayments}/>}
    {stats.failedPayments!=null&&<Stat label="Paiements échoués" value={stats.failedPayments}/>}
    {stats.shareClicks!=null&&<Stat label="Clics de partage" value={stats.shareClicks}/>}
    {stats.shareAttributedApplications!=null&&<Stat label="Inscriptions attribuées" value={stats.shareAttributedApplications}/>}
    {stats.shareAttributedPurchases!=null&&<Stat label="Ventes attribuées" value={stats.shareAttributedPurchases}/>}
    {stats.subscriptionsByStatus?.map((s:any)=><Stat key={s.status} label={`Abonnements ${SUBSCRIPTION_STATUS_LABEL[s.status]??s.status}`} value={s.count}/>)}
  </div><div className="admin-grid"><div className="panel chart"><div className="panel-title"><h2>Activité sur 30 jours</h2><span>Données de démonstration</span></div><div className="bars">{[32,50,42,68,60,82,75,94,70,85,97,88].map((n,i)=><i key={i} style={{height:`${n}%`}}/>)}</div></div><div className="panel quick"><h2>Actions rapides</h2>{user?.role==="ADMIN"&&<Link to="/admin/applications">Traiter les entretiens <span>→</span></Link>}<Link to="/admin/attendees">Voir les participants <span>→</span></Link><Link to="/admin/scanner">Scanner un billet <span>→</span></Link>{user?.role==="ADMIN"&&<Link to="/admin/restaurants">Demandes restaurateurs <span>→</span></Link>}{user?.role==="ADMIN"&&<Link to="/admin/finance">Voir les finances <span>→</span></Link>}<Link to="/events">Voir les événements <span>→</span></Link></div></div></>}</div></section></Layout>;
}
// C35 : jamais de mention "mis à jour maintenant" statique — trompeur pour une période choisie
// par l'admin (ex. "cette année"), qui n'a rien à voir avec l'instant présent.
function Stat({label,value}:{label:string;value:ReactNode}){return <div className="stat"><small>{label.toUpperCase()}</small><strong>{value}</strong></div>}
function AdminNav(){
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

function AdminGlobalInterviews() {
  const [items,setItems]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[message,setMessage]=useState(""); const load=()=>api<any[]>("/admin/global-interviews").then(v=>{setItems(v);if(selected)setSelected(v.find(x=>x.id===selected.id))});useEffect(()=>{load()},[]);
  const decide=async(accept:boolean)=>{await api(`/admin/global-interviews/${selected.id}/decision`,{method:"POST",body:JSON.stringify({accept,notes:accept?undefined:"Profil non retenu pour le moment."})});setMessage(accept?"Profil validé.":"Profil non validé.");await load()};
  const revokeValidation=async()=>{await api(`/admin/profiles/${selected.user.id}/revoke-validation`,{method:"POST"});setMessage("Validation retirée.");await load()};
  const [rescheduling,setRescheduling]=useState(false),[slots,setSlots]=useState<any[]>([]);
  const openReschedule=async()=>{setSlots(await api<any[]>("/interview-slots"));setRescheduling(true)};
  const reschedule=async(slotId:string)=>{await api(`/admin/global-interviews/${selected.id}/reschedule`,{method:"POST",body:JSON.stringify({slotId})});setMessage("Entretien reprogrammé.");setRescheduling(false);await load()};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Entretiens de validation</h1><p className="fine">Un seul entretien global valide le profil d’un participant, indépendamment de tout événement.</p>{message&&<Notice kind="success">{message}</Notice>}<div className="applications-layout"><div className="panel table"><div className="table-row head"><span>Personne</span><span>Statut</span></div>{items.map(a=><button key={a.id} onClick={()=>{setSelected(a);setRescheduling(false)}} className={`table-row ${selected?.id===a.id?"selected":""}`}><span><b>{a.user.displayName}</b><small>{a.user.phone}</small></span><span>{APPLICATION_STATUS_LABEL[a.status]??a.status.replaceAll("_"," ")}</span></button>)}</div><aside className="panel candidate-detail">{selected?<><Avatar name={selected.user.displayName} photoUrl={selected.user.profile?.photoUrl} size="large" verified={!!selected.user.profile?.validatedAt}/><h2>{selected.user.displayName}</h2><p>{selected.user.profile?.profession} · {selected.user.profile?.city}</p><hr/><small>MOTIVATION</small><blockquote>{selected.motivation}</blockquote><small>CENTRES D’INTÉRÊT</small><div className="chips">{selected.user.profile?.interests.map((x:string)=><span key={x}>{x}</span>)}</div><small>ENTRETIEN</small><p>{selected.call?dateTime(selected.call.startsAt):"Aucun créneau réservé pour le moment"}</p>{!["ACCEPTED","REFUSED"].includes(selected.status)&&<div className="decision-buttons"><button className="button" onClick={()=>decide(true)}>Valider le profil</button><button className="button danger" onClick={()=>decide(false)}>Refuser</button></div>}{!!selected.user.profile?.validatedAt&&<button type="button" className="button secondary small" onClick={revokeValidation}>Retirer le badge Vérifié</button>}{selected.call&&!["ACCEPTED","REFUSED"].includes(selected.status)&&(rescheduling?<div className="stack">{slots.length===0?<p className="fine left">Aucun créneau disponible pour le moment.</p>:slots.map((s:any)=><button key={s.id} type="button" className="button small secondary full" onClick={()=>reschedule(s.id)}>{dateTime(s.startsAt)}</button>)}<button type="button" className="button small secondary full" onClick={()=>setRescheduling(false)}>Annuler</button></div>:<button type="button" className="button small secondary full" onClick={openReschedule}>Reprogrammer l’entretien</button>)}</>:<div className="empty"><h3>Sélectionnez un entretien</h3></div>}</aside></div></div></section></Layout>;
}

function AdminCreateEvent() {
  const {user}=useAuth();
  const navigate=useNavigate();
const [form,setForm]=useState({title:"",slug:"",category:EVENT_CATEGORIES[0].name,flow:"" as ""|"SCREENING"|"DIRECT",description:"",startsAt:"",endsAt:"",district:"",address:"",zone:EVENT_ZONES[0],minAge:"",maxAge:"",capacity:20,priceCents:3000,includesDrink:false,includesStarter:false,includesMain:false,includesDessert:false,perksDescription:"",minParticipants:"",minParticipantsDeadline:""});
  const [submitting,setSubmitting]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [restaurantInfo,setRestaurantInfo]=useState<any>(null);
  useEffect(()=>{if(user?.role==="ORGANIZER")api<any>("/restaurants/me").then(setRestaurantInfo).catch(()=>{})},[user?.role]);
  const slugify=(t:string)=>t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

  const submit=async(e:FormEvent)=>{
    e.preventDefault();setSubmitting(true);setNotice(null);
    try{
      await api("/admin/events",{method:"POST",body:JSON.stringify({...form,flow:form.flow||undefined,minAge:form.minAge?Number(form.minAge):undefined,maxAge:form.maxAge?Number(form.maxAge):undefined,minParticipants:form.minParticipants?Number(form.minParticipants):undefined,minParticipantsDeadline:form.minParticipantsDeadline?new Date(form.minParticipantsDeadline).toISOString():undefined,startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString()})});
      setNotice({kind:"success",text:user?.role==="ORGANIZER"?"Brouillon créé. Ajoutez vos photos puis soumettez-le à validation.":"Événement créé."});
      setTimeout(()=>navigate("/admin/events"),1200);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setSubmitting(false)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Créer une soirée</h1><p className="fine left">{user?.role==="ORGANIZER"?"Votre soirée démarre en brouillon : ajoutez ensuite vos photos puis soumettez-la à validation.":"Vous publiez directement vos propres événements."}</p>
    {user?.role==="ORGANIZER"&&restaurantInfo?.subscription&&<Notice kind="info">Abonnement « {restaurantInfo.subscription.plan.name} » ({(restaurantInfo.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois) — {restaurantInfo.currentMonthEventsPublished}{restaurantInfo.subscription.plan.monthlyEventQuota==null?" événements publiés ce mois-ci (illimité)":`/${restaurantInfo.subscription.plan.monthlyEventQuota} événements publiés ce mois-ci`}. Un brouillon ne consomme le quota qu’à sa première publication.</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={submit}>
      <label>Titre<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value,slug:form.slug?form.slug:slugify(e.target.value)})}/></label>
      <label>Identifiant (slug)<input required pattern="[a-z0-9-]+" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
      {user?.role==="ADMIN"&&<label>Parcours d’inscription<select value={form.flow} onChange={e=>setForm({...form,flow:e.target.value as ""|"SCREENING"|"DIRECT"})}><option value="">Suggéré selon la catégorie</option><option value="SCREENING">Sélection (entretien requis)</option><option value="DIRECT">Accès direct (paiement immédiat)</option></select></label>}
      <label>Zone<select value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}>{EVENT_ZONES.map(z=><option key={z} value={z}>{z}</option>)}</select></label>
      <div className="time-row"><label>Âge minimum (facultatif)<input type="number" min={18} max={99} value={form.minAge} onChange={e=>setForm({...form,minAge:e.target.value})}/></label><label>Âge maximum (facultatif)<input type="number" min={18} max={99} value={form.maxAge} onChange={e=>setForm({...form,maxAge:e.target.value})}/></label></div>
      <label className="wide">Description<textarea required minLength={20} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <div className="time-row"><label>Début<input required type="datetime-local" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label><label>Fin<input required type="datetime-local" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label></div>
      <label>Quartier / ville<input required value={form.district} onChange={e=>setForm({...form,district:e.target.value})}/></label>
      <label>Adresse<input required value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>
      <div className="time-row"><label>Capacité totale<input required type="number" min={5} max={500} value={form.capacity} onChange={e=>setForm({...form,capacity:Number(e.target.value)})}/></label><label>Prix (centimes)<input required type="number" min={0} value={form.priceCents} onChange={e=>setForm({...form,priceCents:Number(e.target.value)})}/></label></div>
      <div className="wide"><small>PRESTATIONS RÉELLEMENT INCLUSES</small><div className="perks-checks">
        <label><input type="checkbox" checked={form.includesDrink} onChange={e=>setForm({...form,includesDrink:e.target.checked})}/> Boisson</label>
        <label><input type="checkbox" checked={form.includesStarter} onChange={e=>setForm({...form,includesStarter:e.target.checked})}/> Entrée</label>
        <label><input type="checkbox" checked={form.includesMain} onChange={e=>setForm({...form,includesMain:e.target.checked})}/> Plat</label>
        <label><input type="checkbox" checked={form.includesDessert} onChange={e=>setForm({...form,includesDessert:e.target.checked})}/> Dessert</label>
      </div></div>
      <label className="wide">Précisions sur les prestations<textarea value={form.perksDescription} onChange={e=>setForm({...form,perksDescription:e.target.value})} placeholder="Ex. : coupe de champagne à l’arrivée, buffet salé…"/></label>
      <div className="time-row"><label>Minimum de participants (facultatif)<input type="number" min={1} value={form.minParticipants} onChange={e=>setForm({...form,minParticipants:e.target.value})}/></label>{form.minParticipants&&<label>Date limite de décision<input required type="datetime-local" value={form.minParticipantsDeadline} onChange={e=>setForm({...form,minParticipantsDeadline:e.target.value})}/></label>}</div>
      <p className="fine wide">Les quotas hommes/femmes (Speed dating), les tarifs différenciés et la galerie photo se règlent après création, depuis « Mes événements ».</p>
      <button className="button" disabled={submitting}>{submitting?"Création…":"Créer la soirée"}</button>
    </form>
  </div></section></Layout>;
}

function AdminEventPhotos() {
  const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const highlightId=searchParams.get("highlight");
  const [events,setEvents]=useState<any[]>([]);
  const [uploadingFor,setUploadingFor]=useState<string|null>(null);
  const [actingOn,setActingOn]=useState<string|null>(null);
  const [rejectNoteFor,setRejectNoteFor]=useState<string|null>(null);
  const [rejectNote,setRejectNote]=useState("");
  const [quotaEditFor,setQuotaEditFor]=useState<string|null>(null);
  const [quotaForm,setQuotaForm]=useState({homme:0,femme:0});
  const [cancelConfirmFor,setCancelConfirmFor]=useState<string|null>(null);
  const [editFor,setEditFor]=useState<string|null>(null);
  const [editForm,setEditForm]=useState({title:"",description:"",capacity:0,startsAt:"",endsAt:"",includesDrink:false,includesStarter:false,includesMain:false,includesDessert:false,perksDescription:""});
  const [pricingFor,setPricingFor]=useState<string|null>(null);
  const [pricingForm,setPricingForm]=useState({mode:"flat" as "flat"|"differentiated",amountCents:0,homme:0,femme:0});
  const [historyFor,setHistoryFor]=useState<string|null>(null);
  const [historyItems,setHistoryItems]=useState<any[]>([]);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/events").then(setEvents);
  useEffect(()=>{load()},[]);
  // C14 (ordre correctif 2026-09-20) : une notification "soirée approuvée/à valider/..." doit ouvrir
  // CETTE soirée, pas seulement la liste — /admin/events?highlight=<id> défile jusqu'à sa carte et
  // la met en évidence brièvement plutôt que de forcer le restaurateur à la rechercher lui-même.
  useEffect(()=>{
    if(!highlightId||events.length===0)return;
    const el=document.getElementById(`event-${highlightId}`);
    if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.add("highlighted");setTimeout(()=>el.classList.remove("highlighted"),3000)}
  },[highlightId,events]);

  const toLocalInput=(iso:string)=>new Date(iso).toISOString().slice(0,16);

  const openQuotaEditor=(ev:any)=>{
    const homme=ev.quotas?.find((q:any)=>q.category==="HOMME")?.capacity??0;
    const femme=ev.quotas?.find((q:any)=>q.category==="FEMME")?.capacity??0;
    setQuotaForm({homme,femme});setQuotaEditFor(ev.id);
  };
  const saveQuotas=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/quotas`,{method:"POST",body:JSON.stringify(quotaForm)});setNotice({kind:"success",text:"Quotas mis à jour."});setQuotaEditFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const cancelEvent=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{const res=await api<any>(`/admin/events/${eventId}/cancel`,{method:"POST"});setNotice({kind:"success",text:`Événement annulé.${res.refundedCount?` ${res.refundedCount} billet(s) remboursé(s) intégralement.`:""}`});setCancelConfirmFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const decideMinParticipants=async(eventId:string, action:"MAINTAIN"|"CANCEL")=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/min-participants-decision`,{method:"POST",body:JSON.stringify({action})});setNotice({kind:"success",text:action==="MAINTAIN"?"Événement maintenu.":"Événement annulé, billets remboursés."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const upload=async(eventId:string, file:File)=>{
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setNotice({kind:"error",text:"Format non pris en charge (jpeg, png ou webp uniquement)."});return}
    if(file.size>5*1024*1024){setNotice({kind:"error",text:"Image trop volumineuse (5 Mo maximum)."});return}
    setUploadingFor(eventId);setNotice(null);
    try{
      const form=new FormData();form.append("file",file);
      await api(`/admin/events/${eventId}/image`,{method:"POST",body:form});
      setNotice({kind:"success",text:"Photo mise à jour."});
      await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setUploadingFor(null)}
  };
  const uploadGalleryPhoto=async(eventId:string, file:File)=>{
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setNotice({kind:"error",text:"Format non pris en charge (jpeg, png ou webp uniquement)."});return}
    if(file.size>5*1024*1024){setNotice({kind:"error",text:"Image trop volumineuse (5 Mo maximum)."});return}
    setUploadingFor(eventId);setNotice(null);
    try{const form=new FormData();form.append("file",file);await api(`/admin/events/${eventId}/photos`,{method:"POST",body:form});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setUploadingFor(null)}
  };
  const removeGalleryPhoto=async(eventId:string, photoId:string)=>{
    setNotice(null);
    try{await api(`/admin/events/${eventId}/photos/${photoId}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const submitForReview=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/submit-for-review`,{method:"POST"});setNotice({kind:"success",text:"Événement soumis à validation."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const reviewDecision=async(eventId:string, accept:boolean, note?:string)=>{
    setActingOn(eventId);setNotice(null);
    try{await api(`/admin/events/${eventId}/review-decision`,{method:"POST",body:JSON.stringify({accept,note})});setNotice({kind:"success",text:accept?"Événement publié.":"Événement renvoyé en brouillon."});setRejectNoteFor(null);setRejectNote("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const openEditor=(ev:any)=>{
    setEditForm({title:ev.title,description:ev.description,capacity:ev.capacity,startsAt:toLocalInput(ev.startsAt),endsAt:toLocalInput(ev.endsAt),includesDrink:ev.includesDrink,includesStarter:ev.includesStarter,includesMain:ev.includesMain,includesDessert:ev.includesDessert,perksDescription:ev.perksDescription??""});
    setEditFor(ev.id);
  };
  // Cahier des charges consolidé final (2026-09-20) : une soirée publiée ne peut plus être déplacée
  // — le serveur refuse désormais la requête (409) plutôt que de créer une proposition à approuver.
  const saveEdit=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{
      await api<any>(`/admin/events/${eventId}`,{method:"PATCH",body:JSON.stringify({...editForm,startsAt:new Date(editForm.startsAt).toISOString(),endsAt:new Date(editForm.endsAt).toISOString()})});
      setNotice({kind:"success",text:"Modifications enregistrées."});
      setEditFor(null);await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const openPricing=(ev:any)=>{
    const homme=ev.priceTiers?.find((t:any)=>t.category==="HOMME")?.amountCents;
    const femme=ev.priceTiers?.find((t:any)=>t.category==="FEMME")?.amountCents;
    setPricingForm({mode:homme!=null&&femme!=null?"differentiated":"flat",amountCents:ev.priceCents,homme:homme??ev.priceCents,femme:femme??ev.priceCents});
    setPricingFor(ev.id);
  };
  const savePricing=async(eventId:string)=>{
    setActingOn(eventId);setNotice(null);
    try{
      const body=pricingForm.mode==="flat"?{mode:"flat",amountCents:pricingForm.amountCents}:{mode:"differentiated",homme:pricingForm.homme,femme:pricingForm.femme};
      await api(`/admin/events/${eventId}/pricing`,{method:"POST",body:JSON.stringify(body)});
      setNotice({kind:"success",text:"Tarifs mis à jour."});setPricingFor(null);await load();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  const toggleHistory=async(eventId:string)=>{
    if(historyFor===eventId){setHistoryFor(null);return}
    setHistoryFor(eventId);
    try{setHistoryItems(await api<any[]>(`/admin/events/${eventId}/history`))}catch{setHistoryItems([])}
  };
  const HISTORY_LABEL:Record<string,string>={CREATE_EVENT:"Création",SUBMIT_EVENT_FOR_REVIEW:"Soumis à validation",APPROVE_EVENT:"Publié",REJECT_EVENT:"Renvoyé en brouillon",UPDATE_EVENT:"Modifié",SET_EVENT_PRICING:"Tarifs modifiés",SET_EVENT_QUOTAS:"Quotas modifiés",ADD_EVENT_PHOTO:"Photo ajoutée",CANCEL_EVENT:"Annulé",APPROVE_DATE_CHANGE:"Changement de date approuvé",REJECT_DATE_CHANGE:"Changement de date refusé"};

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Mes événements</h1><p className="fine left">Formats acceptés : JPEG, PNG, WEBP · 5 Mo maximum. Sans photo personnalisée, l’illustration de la catégorie est utilisée.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="event-photo-grid">{events.map(ev=><div key={ev.id} id={`event-${ev.id}`} className="panel event-photo-card"><img src={imgUrl(ev.imageUrl)} alt={ev.title}/><div><b>{ev.title}</b><div className="admin-event-meta"><CategoryBadge category={ev.category} className="inline"/><small>{EVENT_STATUS_LABEL[ev.status]??ev.status}</small></div>
      <label className="button small secondary">{uploadingFor===ev.id?"Envoi…":"Changer la photo principale"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id} onChange={e=>{const f=e.target.files?.[0];if(f)upload(ev.id,f);e.target.value=""}}/></label>

      <div className="gallery-editor"><small>GALERIE ({ev.photos?.length??0}/5)</small><div className="gallery-thumbs">{(ev.photos??[]).map((p:any)=><div key={p.id} className="gallery-thumb"><img src={imgUrl(p.url)} alt=""/><button type="button" onClick={()=>removeGalleryPhoto(ev.id,p.id)} aria-label="Supprimer la photo">×</button></div>)}</div><label className="button small secondary" style={{opacity:(ev.photos?.length??0)>=5?0.5:1}}>{uploadingFor===ev.id?"Envoi…":"Ajouter une photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploadingFor===ev.id||(ev.photos?.length??0)>=5} onChange={e=>{const f=e.target.files?.[0];if(f)uploadGalleryPhoto(ev.id,f);e.target.value=""}}/></label></div>

      {user?.role==="ORGANIZER"&&ev.status==="DRAFT"&&<button className="button small" disabled={actingOn===ev.id} onClick={()=>submitForReview(ev.id)}>{actingOn===ev.id?"Envoi…":"Soumettre à validation"}</button>}
      {user?.role==="ADMIN"&&ev.status==="PENDING_REVIEW"&&<div className="review-actions">
        <button className="button small" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,true)}>Publier</button>
        {rejectNoteFor===ev.id?<div className="reject-note"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Motif (optionnel)"/><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>reviewDecision(ev.id,false,rejectNote)}>Confirmer le refus</button></div>:<button className="button small danger" onClick={()=>setRejectNoteFor(ev.id)}>Renvoyer en brouillon</button>}
      </div>}


      {editFor===ev.id?<div className="event-edit-form">
        <label>Titre<input value={editForm.title} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></label>
        <label>Description<textarea value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></label>
        <div className="time-row"><label>Capacité<input type="number" min={5} value={editForm.capacity} onChange={e=>setEditForm({...editForm,capacity:Number(e.target.value)})}/></label></div>
        <div className="time-row"><label>Début<input type="datetime-local" disabled={ev.status==="PUBLISHED"||ev.status==="FULL"} value={editForm.startsAt} onChange={e=>setEditForm({...editForm,startsAt:e.target.value})}/></label><label>Fin<input type="datetime-local" disabled={ev.status==="PUBLISHED"||ev.status==="FULL"} value={editForm.endsAt} onChange={e=>setEditForm({...editForm,endsAt:e.target.value})}/></label></div>
        {(ev.status==="PUBLISHED"||ev.status==="FULL")&&<p className="fine left">Une soirée publiée ne peut plus être déplacée : annulez-la puis créez-en une nouvelle à la date souhaitée.</p>}
        <small>PRESTATIONS RÉELLEMENT INCLUSES</small>
        <div className="perks-checks">
          <label><input type="checkbox" checked={editForm.includesDrink} onChange={e=>setEditForm({...editForm,includesDrink:e.target.checked})}/> Boisson</label>
          <label><input type="checkbox" checked={editForm.includesStarter} onChange={e=>setEditForm({...editForm,includesStarter:e.target.checked})}/> Entrée</label>
          <label><input type="checkbox" checked={editForm.includesMain} onChange={e=>setEditForm({...editForm,includesMain:e.target.checked})}/> Plat</label>
          <label><input type="checkbox" checked={editForm.includesDessert} onChange={e=>setEditForm({...editForm,includesDessert:e.target.checked})}/> Dessert</label>
        </div>
        <label>Précisions sur les prestations<textarea value={editForm.perksDescription} onChange={e=>setEditForm({...editForm,perksDescription:e.target.value})} placeholder="Ex. : coupe de champagne à l’arrivée, buffet salé…"/></label>
        <div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveEdit(ev.id)}>Enregistrer</button><button className="button small secondary" onClick={()=>setEditFor(null)}>Annuler</button></div>
      </div>:<button className="button small secondary" onClick={()=>openEditor(ev)}>Modifier les informations</button>}

      {pricingFor===ev.id?<div className="event-edit-form">
        <div className="time-row"><label><input type="radio" checked={pricingForm.mode==="flat"} onChange={()=>setPricingForm({...pricingForm,mode:"flat"})}/> Tarif unique</label><label><input type="radio" checked={pricingForm.mode==="differentiated"} onChange={()=>setPricingForm({...pricingForm,mode:"differentiated"})}/> Tarif différencié homme/femme</label></div>
        {pricingForm.mode==="flat"?<label>Prix (centimes)<input type="number" min={0} value={pricingForm.amountCents} onChange={e=>setPricingForm({...pricingForm,amountCents:Number(e.target.value)})}/></label>
        :<><div className="time-row"><label>Hommes (centimes)<input type="number" min={0} value={pricingForm.homme} onChange={e=>setPricingForm({...pricingForm,homme:Number(e.target.value)})}/></label><label>Femmes (centimes)<input type="number" min={0} value={pricingForm.femme} onChange={e=>setPricingForm({...pricingForm,femme:Number(e.target.value)})}/></label></div><p className="fine left">La conformité juridique d’un tarif différencié selon le sexe doit être vérifiée avant toute mise en production. Tant que « Tarification homme/femme » reste désactivée dans Réglages, ces montants sont enregistrés mais n’ont aucun effet : tout le monde paie le tarif unique.</p></>}
        <div className="decision-buttons"><button className="button small" disabled={actingOn===ev.id} onClick={()=>savePricing(ev.id)}>Enregistrer les tarifs</button><button className="button small secondary" onClick={()=>setPricingFor(null)}>Annuler</button></div>
      </div>:<button className="button small secondary" onClick={()=>openPricing(ev)}>{ev.priceTiers?.length?"Modifier les tarifs":"Définir un tarif différencié"}</button>}

      {ev.category==="Speed dating"&&<div className="quota-editor">
        {quotaEditFor===ev.id?<><div className="time-row"><label>Hommes<input type="number" min={0} value={quotaForm.homme} onChange={e=>setQuotaForm({...quotaForm,homme:Number(e.target.value)})}/></label><label>Femmes<input type="number" min={0} value={quotaForm.femme} onChange={e=>setQuotaForm({...quotaForm,femme:Number(e.target.value)})}/></label></div><button className="button small" disabled={actingOn===ev.id} onClick={()=>saveQuotas(ev.id)}>Enregistrer les quotas</button></>
        :<button className="button small secondary" onClick={()=>openQuotaEditor(ev)}>{ev.quotas?.length?"Modifier les quotas":"Définir des quotas"}</button>}
        {ev.quotas?.length>0&&<p className="fine left">{ev.quotas.map((q:any)=>`${q.category==="HOMME"?"Hommes":"Femmes"} : ${q.heldCount}/${q.capacity}`).join(" · ")}</p>}
      </div>}

      <button type="button" className="button small secondary" onClick={()=>toggleHistory(ev.id)}>{historyFor===ev.id?"Masquer l’historique":"Voir l’historique"}</button>
      {historyFor===ev.id&&<div className="stack"><ul className="history-list">{historyItems.map(h=><li key={h.id}><small>{dateTime(h.createdAt)}</small> — {HISTORY_LABEL[h.action]??h.action}</li>)}</ul></div>}

      {ev.minParticipantsNotifiedAt&&!ev.minParticipantsOutcome&&<div className="reject-note"><span className="fine left">Minimum de {ev.minParticipants} participants non atteint : maintenir ou annuler ?</span><button className="button small" disabled={actingOn===ev.id} onClick={()=>decideMinParticipants(ev.id,"MAINTAIN")}>Maintenir</button><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>decideMinParticipants(ev.id,"CANCEL")}>Annuler (remboursement intégral)</button></div>}
      {ev.status!=="CANCELLED"&&(cancelConfirmFor===ev.id?<div className="reject-note"><span className="fine left">Confirmer l’annulation de cet événement ?</span><button className="button small danger" disabled={actingOn===ev.id} onClick={()=>cancelEvent(ev.id)}>Confirmer l’annulation</button></div>:<button className="button small danger" onClick={()=>setCancelConfirmFor(ev.id)}>Annuler l’événement</button>)}
    </div></div>)}</div>
  </div></section></Layout>;
}

function AdminRestaurants() {
  const [items,setItems]=useState<any[]>([]);
  const [plans,setPlans]=useState<any[]>([]);
  const [filter,setFilter]=useState("PENDING");
  const [actingOn,setActingOn]=useState<string|null>(null);
  const [reasonFor,setReasonFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [notesFor,setNotesFor]=useState<string|null>(null);
  const [notes,setNotes]=useState("");
  const [subFor,setSubFor]=useState<string|null>(null);
  const [subForm,setSubForm]=useState({planId:"",status:"ACTIVE"});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [planEdits,setPlanEdits]=useState<Record<string,{monthlyPriceCents:string;monthlyEventQuota:string}>>({});
  const [newPlan,setNewPlan]=useState({name:"",monthlyPriceCents:"",monthlyEventQuota:""});
  const load=()=>api<any[]>(`/admin/restaurants?status=${filter}`).then(setItems);
  const loadPlans=()=>api<any[]>("/admin/plans").then(v=>{setPlans(v);setPlanEdits(Object.fromEntries(v.map(p=>[p.id,{monthlyPriceCents:String(p.monthlyPriceCents/100),monthlyEventQuota:p.monthlyEventQuota==null?"":String(p.monthlyEventQuota)}])))});
  useEffect(()=>{load();loadPlans().catch(()=>{})},[filter]);
  const savePlan=async(id:string)=>{
    const edit=planEdits[id];setNotice(null);
    try{await api(`/admin/plans/${id}`,{method:"PATCH",body:JSON.stringify({monthlyPriceCents:Math.round(Number(edit.monthlyPriceCents)*100),monthlyEventQuota:edit.monthlyEventQuota===""?null:Number(edit.monthlyEventQuota)})});setNotice({kind:"success",text:"Formule mise à jour."});await loadPlans()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const togglePlanActive=async(p:any)=>{
    try{await api(`/admin/plans/${p.id}`,{method:"PATCH",body:JSON.stringify({active:!p.active})});await loadPlans()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const createPlan=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    try{await api("/admin/plans",{method:"POST",body:JSON.stringify({name:newPlan.name,monthlyPriceCents:Math.round(Number(newPlan.monthlyPriceCents)*100),monthlyEventQuota:newPlan.monthlyEventQuota===""?null:Number(newPlan.monthlyEventQuota)})});setNewPlan({name:"",monthlyPriceCents:"",monthlyEventQuota:""});setNotice({kind:"success",text:"Formule créée."});await loadPlans()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const decide=async(id:string, accept:boolean, rejectReason?:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/decision`,{method:"POST",body:JSON.stringify({accept,reason:rejectReason})});setNotice({kind:"success",text:accept?"Restaurateur approuvé. Un essai d’abonnement a été activé.":"Demande refusée."});setReasonFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const saveNotes=async(id:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/notes`,{method:"PATCH",body:JSON.stringify({adminNotes:notes})});setNotice({kind:"success",text:"Notes internes enregistrées."});setNotesFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };
  const saveSubscription=async(id:string)=>{
    setActingOn(id);setNotice(null);
    try{await api(`/admin/restaurants/${id}/subscription`,{method:"POST",body:JSON.stringify(subForm)});setNotice({kind:"success",text:"Abonnement mis à jour."});setSubFor(null);await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setActingOn(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Demandes restaurateurs</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="panel" style={{marginBottom:20}}>
      <div className="panel-title"><h2>Formules d’abonnement</h2><span>Prix mensuel HT · quota vide = illimité · tarif annuel = mensuel × 12 × 0,8</span></div>
      <div className="stack">{plans.map(p=><div key={p.id} className="time-row" style={{alignItems:"center"}}>
        <span>{p.name}{!p.active&&" (désactivée)"}</span>
        <label>€/mois<input type="number" min={0} step="1" value={planEdits[p.id]?.monthlyPriceCents??""} onChange={e=>setPlanEdits({...planEdits,[p.id]:{...planEdits[p.id],monthlyPriceCents:e.target.value}})}/></label>
        <label>Quota mensuel (vide=illimité)<input type="number" min={1} placeholder="illimité" value={planEdits[p.id]?.monthlyEventQuota??""} onChange={e=>setPlanEdits({...planEdits,[p.id]:{...planEdits[p.id],monthlyEventQuota:e.target.value}})}/></label>
        <small className="fine">Annuel : {(Math.round(Number(planEdits[p.id]?.monthlyPriceCents||0)*100*12*0.8)/100).toFixed(0)} €/an</small>
        <button type="button" className="button small" onClick={()=>savePlan(p.id)}>Enregistrer</button>
        <button type="button" className="button small secondary" onClick={()=>togglePlanActive(p)}>{p.active?"Désactiver":"Réactiver"}</button>
      </div>)}</div>
      <form className="time-row" onSubmit={createPlan} style={{marginTop:14,alignItems:"center"}}>
        <input placeholder="Nom de la nouvelle formule" value={newPlan.name} onChange={e=>setNewPlan({...newPlan,name:e.target.value})} required/>
        <input type="number" min={0} placeholder="€/mois" value={newPlan.monthlyPriceCents} onChange={e=>setNewPlan({...newPlan,monthlyPriceCents:e.target.value})} required/>
        <input type="number" min={1} placeholder="Quota (vide=illimité)" value={newPlan.monthlyEventQuota} onChange={e=>setNewPlan({...newPlan,monthlyEventQuota:e.target.value})}/>
        <button className="button small">Créer la formule</button>
      </form>
    </div>
    <div className="filters"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="PENDING">En attente</option><option value="APPROVED">Approuvés</option><option value="REJECTED">Refusés</option><option value="SUSPENDED">Suspendus</option></select></div>
    {items.length===0?<div className="empty"><span>◇</span><h2>Aucune demande</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request">
      <div>
        <h3>{r.name}</h3>
        <p>{r.owner.displayName} · <a href={`tel:${r.phone||r.owner.phone}`}>{r.phone||r.owner.phone}</a>{r.owner.email?<> · <a href={`mailto:${r.owner.email}`}>Contacter par e-mail</a></>:null}</p>
        <p className="fine left">Responsable : {r.managerName??"—"} · SIRET {r.siret??"—"}</p>
        {r.district&&<p className="fine left">{r.address}, {r.district}</p>}
        {r.description&&<p className="fine left">{r.description}</p>}
        <p className="fine left">Places souhaitées : {r.desiredCapacity??"—"} · Créneaux : {r.desiredSchedule??"—"} · Prix moyen/pers. : {r.averagePricePerPersonCents!=null?money(r.averagePricePerPersonCents):"—"} · Minimum habituel : {r.defaultMinParticipants??"—"}</p>
        <p className="fine left">Inclus : {[r.priceIncludesDrink&&"boisson",r.priceIncludesStarter&&"entrée",r.priceIncludesMain&&"plat",r.priceIncludesDessert&&"dessert"].filter(Boolean).join(", ")||"—"}{r.proposesCategoryPricing?" · tarifs par catégorie proposés":""}{r.allowsPrivatization?" · privatisation possible":""}</p>
        {r.specialConditions&&<p className="fine left">Conditions particulières : {r.specialConditions}</p>}
        {r.photos?.length>0&&<div className="event-photo-grid">{r.photos.map((p:any)=><img key={p.id} src={imgUrl(p.url)} alt="" style={{height:100,borderRadius:8,objectFit:"cover"}}/>)}</div>}
        <small>{RESTAURANT_STATUS_LABEL[r.status]}</small>
        {r.status==="APPROVED"&&<p className="fine left">Abonnement : {r.subscription?`${r.subscription.plan.name} (${(r.subscription.plan.monthlyPriceCents/100).toFixed(0)} €/mois) — ${r.subscription.status}`:"aucun"} <button type="button" className="link-button" onClick={()=>{setSubFor(r.id);setSubForm({planId:r.subscription?.planId??plans[0]?.id??"",status:r.subscription?.status??"ACTIVE"})}}>modifier</button></p>}
        {subFor===r.id&&<div className="time-row"><select value={subForm.planId} onChange={e=>setSubForm({...subForm,planId:e.target.value})}>{plans.map(p=><option key={p.id} value={p.id}>{p.name} ({(p.monthlyPriceCents/100).toFixed(0)} €/mois, {p.monthlyEventQuota==null?"illimité":`${p.monthlyEventQuota} évt.`})</option>)}</select><select value={subForm.status} onChange={e=>setSubForm({...subForm,status:e.target.value})}><option value="TRIALING">Essai</option><option value="ACTIVE">Actif</option><option value="PAST_DUE">Impayé</option><option value="CANCELLED">Résilié</option><option value="INCOMPLETE">Incomplet</option></select><button className="button small" disabled={actingOn===r.id} onClick={()=>saveSubscription(r.id)}>Enregistrer</button></div>}
        <p className="fine left">Notes internes : {r.adminNotes||"—"} <button type="button" className="link-button" onClick={()=>{setNotesFor(r.id);setNotes(r.adminNotes??"")}}>modifier</button></p>
        {notesFor===r.id&&<div className="time-row"><textarea value={notes} onChange={e=>setNotes(e.target.value)}/><button className="button small" disabled={actingOn===r.id} onClick={()=>saveNotes(r.id)}>Enregistrer</button></div>}
      </div>
      {r.status==="PENDING"&&<div className="decision-buttons">
      <button className="button" disabled={actingOn===r.id} onClick={()=>decide(r.id,true)}>Accepter</button>
      {reasonFor===r.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif (optionnel)"/><button className="button danger" disabled={actingOn===r.id} onClick={()=>decide(r.id,false,reason)}>Confirmer le refus</button></div>:<button className="button danger" onClick={()=>setReasonFor(r.id)}>Refuser</button>}
    </div>}</article>)}</div>}
  </div></section></Layout>;
}

// §6 (cahier des charges 2026-09) : tableau exclusivement super-admin — la route serveur elle-même
// (roles(UserRole.ADMIN) seul) refuse déjà tout autre rôle ; cette page n'est de toute façon jamais
// listée ni routée pour un restaurateur ou modérateur (voir AdminNav et App()).
// C33 : préréglages de période. Chaque préréglage calcule aussi la période précédente de même
// durée, pour la comparaison — jamais une comparaison approximative ou inventée.
const STATS_PRESETS: [string, () => {since:string;until:string;compareSince:string;compareUntil:string}][] = [
  ["Aujourd’hui", () => { const d=new Date().toISOString().slice(0,10); const y=new Date(Date.now()-86_400_000).toISOString().slice(0,10); return {since:d,until:d,compareSince:y,compareUntil:y}; }],
  ["Hier", () => { const y=new Date(Date.now()-86_400_000).toISOString().slice(0,10); const y2=new Date(Date.now()-2*86_400_000).toISOString().slice(0,10); return {since:y,until:y,compareSince:y2,compareUntil:y2}; }],
  ["7 derniers jours", () => { const until=new Date().toISOString().slice(0,10); const since=new Date(Date.now()-7*86_400_000).toISOString().slice(0,10); const compareUntil=new Date(Date.now()-7*86_400_000).toISOString().slice(0,10); const compareSince=new Date(Date.now()-14*86_400_000).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }],
  ["30 derniers jours", () => { const until=new Date().toISOString().slice(0,10); const since=new Date(Date.now()-30*86_400_000).toISOString().slice(0,10); const compareUntil=new Date(Date.now()-30*86_400_000).toISOString().slice(0,10); const compareSince=new Date(Date.now()-60*86_400_000).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }],
  ["Ce mois-ci", () => { const now=new Date(); const since=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10); const until=now.toISOString().slice(0,10); const compareUntil=new Date(now.getFullYear(),now.getMonth(),0).toISOString().slice(0,10); const compareSince=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }],
  ["Cette année", () => { const now=new Date(); const since=new Date(now.getFullYear(),0,1).toISOString().slice(0,10); const until=now.toISOString().slice(0,10); const compareUntil=new Date(now.getFullYear()-1,11,31).toISOString().slice(0,10); const compareSince=new Date(now.getFullYear()-1,0,1).toISOString().slice(0,10); return {since,until,compareSince,compareUntil}; }]
];
function StatDelta({current,previous,invert}:{current:number;previous:number|null|undefined;invert?:boolean}){
  if(previous==null)return null;
  const diff=previous===0?(current>0?100:0):Math.round(((current-previous)/previous)*100);
  const good=invert?diff<=0:diff>=0;
  return <span style={{fontSize:11,color:good?"var(--green)":"var(--red)",marginLeft:6}}>{diff>0?"+":""}{diff}%</span>;
}
function AdminStats() {
  const [stats,setStats]=useState<any>(null);
  const [range,setRange]=useState(STATS_PRESETS[3][1]());
  const [scope,setScope]=useState<"all"|"participants"|"restaurants">("all");
  const load=()=>api<any>(`/admin/stats?since=${range.since}&until=${range.until}&compareSince=${range.compareSince}&compareUntil=${range.compareUntil}`).then(setStats);
  useEffect(()=>{load()},[range]);
  const exportFile=async(ext:"csv"|"xlsx")=>{
    const response=await fetch(`${API_URL}/admin/stats/export.${ext}?since=${range.since}&until=${range.until}`,{headers:{Authorization:`Bearer ${getToken()}`}});
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`statistiques-${range.since}-${range.until}.${ext}`;a.click();URL.revokeObjectURL(url);
  };
  if(!stats)return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><Loading/></div></section></Layout>;
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Statistiques</h1>
    <div className="filters">{STATS_PRESETS.map(([label,fn])=><button key={label} type="button" className="button small secondary" onClick={()=>setRange(fn())}>{label}</button>)}</div>
    <div className="filters"><label>Depuis<input type="date" value={range.since} onChange={e=>setRange({...range,since:e.target.value})}/></label><label>Jusqu’au<input type="date" value={range.until} onChange={e=>setRange({...range,until:e.target.value})}/></label>
      <select value={scope} onChange={e=>setScope(e.target.value as any)}><option value="all">Participants + restaurateurs</option><option value="participants">Participants</option><option value="restaurants">Restaurateurs</option></select>
      <button type="button" className="button small secondary" onClick={()=>exportFile("csv")}>Exporter les ventes (CSV)</button>
      <button type="button" className="button small secondary" onClick={()=>exportFile("xlsx")}>Exporter tout (Excel)</button>
    </div>
    {(stats.alerts.cancellationRate24h>=stats.alerts.cancellationThreshold||stats.alerts.subscriptionsExpiringSoon>0||stats.alerts.blockedPayments24h>0||stats.alerts.pendingRefundRequests>0||stats.alerts.underfilledEventsPending>0)&&<Notice kind="error">
      {stats.alerts.cancellationRate24h>=stats.alerts.cancellationThreshold&&<>Taux d’annulation sur 24h : {stats.alerts.cancellationRate24h}% (seuil {stats.alerts.cancellationThreshold}%). </>}
      {stats.alerts.subscriptionsExpiringSoon>0&&<>{stats.alerts.subscriptionsExpiringSoon} abonnement{stats.alerts.subscriptionsExpiringSoon>1?"s":""} restaurateur{stats.alerts.subscriptionsExpiringSoon>1?"s":""} arrivent à échéance bientôt. </>}
      {stats.alerts.blockedPayments24h>0&&<>{stats.alerts.blockedPayments24h} paiement{stats.alerts.blockedPayments24h>1?"s":""} bloqué{stats.alerts.blockedPayments24h>1?"s":""} sur 24h. </>}
      {stats.alerts.pendingRefundRequests>0&&<>{stats.alerts.pendingRefundRequests} demande{stats.alerts.pendingRefundRequests>1?"s":""} de remboursement en attente. </>}
      {stats.alerts.underfilledEventsPending>0&&<>{stats.alerts.underfilledEventsPending} soirée{stats.alerts.underfilledEventsPending>1?"s":""} sous le seuil de participants, décision attendue.</>}
    </Notice>}
    {!stats.analyticsEnabled&&<Notice kind="info">Mesure d’audience désactivée (visiteurs, sources, entonnoir haut) : à activer dans Réglages après mise en place d’un consentement conforme.</Notice>}

    {(scope==="all"||scope==="participants")&&<>
      <div className="panel-title"><h2>Audience</h2></div>
      {stats.audience.instrumented?<div className="stat-grid">
        <Stat label="Visites" value={stats.audience.totalViews}/>
        <Stat label="Visiteurs uniques" value={stats.audience.uniqueVisitors}/>
      </div>:<p className="fine left">Non instrumenté (mesure d’audience désactivée).</p>}
      {stats.audience.instrumented&&stats.audience.bySource.length>0&&<p className="fine left">Sources : {stats.audience.bySource.map((s:any)=>`${s.source} (${s.visits})`).join(" · ")}</p>}

      <div className="panel-title"><h2>Tunnel participant</h2></div>
      <div className="stat-grid">
        {stats.funnelParticipant.top.instrumented&&<><Stat label="Visiteurs accueil" value={stats.funnelParticipant.top.homeVisitors}/><Stat label="Visiteurs catalogue" value={stats.funnelParticipant.top.catalogVisitors}/></>}
        <Stat label="Entretiens demandés" value={stats.funnelParticipant.interviewsRequested}/>
        <Stat label="Profils validés" value={stats.funnelParticipant.interviewsAccepted}/>
        <Stat label="Taux d’acceptation" value={stats.funnelParticipant.interviewAcceptanceRate!=null?`${stats.funnelParticipant.interviewAcceptanceRate}%`:"—"}/>
        <Stat label="Candidatures à un événement" value={stats.funnelParticipant.applicationsCreated}/>
        <Stat label="Paiements réussis" value={stats.funnelParticipant.paymentsSucceeded}/>
        <Stat label="Taux de succès paiement" value={stats.funnelParticipant.paymentSuccessRate!=null?`${stats.funnelParticipant.paymentSuccessRate}%`:"—"}/>
        <Stat label="Billets confirmés" value={stats.funnelParticipant.ticketsConfirmed}/>
        <Stat label="Annulations" value={stats.funnelParticipant.cancellationsCount}/>
        <Stat label="Entrées liste d’attente" value={stats.funnelParticipant.waitlistCount}/>
      </div>
    </>}

    {(scope==="all"||scope==="restaurants")&&<>
      <div className="panel-title"><h2>Tunnel restaurateur</h2></div>
      <div className="stat-grid"><Stat label="Nouvelles demandes" value={stats.funnelRestaurant.newRequests}/><Stat label="Approuvées" value={stats.funnelRestaurant.approved}/><Stat label="Abonnements souscrits" value={stats.funnelRestaurant.subscriptionsStarted}/><Stat label="Événements créés" value={stats.funnelRestaurant.eventsCreated}/><Stat label="Événements publiés" value={stats.funnelRestaurant.eventsPublished}/></div>
    </>}

    <div className="panel-title"><h2>Finance</h2></div>
    <div className="stat-grid">
      <Stat label="Revenu billetterie" value={<>{money(stats.finance.ticketRevenueCents)}<StatDelta current={stats.finance.ticketRevenueCents} previous={stats.previous?.finance.ticketRevenueCents}/></>}/>
      <Stat label="Remboursé" value={`${money(stats.finance.refundedCents)} (${stats.finance.refundedCount})`}/>
      <Stat label="MRR abonnements" value={money(stats.finance.subscriptionMonthlyRevenueCents)}/>
      <Stat label="Abonnements actifs" value={stats.finance.activeSubscriptionsCount}/>
      <Stat label="Impayés (PAST_DUE)" value={stats.finance.pastDueCount}/>
    </div>
    <p className="fine left">Abonnements par statut : {stats.finance.subscriptionsByStatus.map((s:any)=>`${s.status} (${s.count})`).join(" · ")||"—"}</p>

    <div className="panel-title"><h2>Blog</h2></div>
    {stats.blog.instrumented?<div className="stat-grid"><Stat label="Lectures" value={stats.blog.reads}/><Stat label="Lecteurs uniques" value={stats.blog.uniqueReaders}/></div>:<p className="fine left">Non instrumenté (mesure d’audience désactivée).</p>}

    <div className="panel-title"><h2>Search Console</h2></div>
    <p className="fine left">{stats.searchConsole.connected?"Connecté.":"Non configuré — aucune donnée Search Console à afficher."}</p>

    <div className="panel-title"><h2>Partage</h2></div>
    <div className="stat-grid"><Stat label="Nouveaux participants" value={stats.audienceLegacy.newParticipants}/><Stat label="Clics de partage (total)" value={stats.audienceLegacy.shareClicks}/><Stat label="Candidatures via partage" value={stats.audienceLegacy.shareAttributedApplications}/><Stat label="Achats via partage" value={stats.audienceLegacy.shareAttributedPurchases}/></div>
  </div></section></Layout>;
}

function AdminFinance() {
  const {user}=useAuth();
  const [entries,setEntries]=useState<any[]>([]);
  const [summary,setSummary]=useState<any>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>Promise.all([api<any[]>("/admin/finance/ledger"),api<any>("/admin/finance/summary")]).then(([l,s])=>{setEntries(l);setSummary(s)});
  useEffect(()=>{load()},[]);

  const markPaid=async(id:string)=>{
    setBusy(id);setNotice(null);
    try{await api(`/admin/finance/ledger/${id}/mark-paid`,{method:"POST",body:JSON.stringify({})});setNotice({kind:"success",text:"Marqué comme reversé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">{user?.role==="ADMIN"?"SUPER-ADMINISTRATION":"ESPACE RESTAURATEUR"}</span><h1>Finances</h1><p className="fine left">Aucun virement n’est jamais déclenché automatiquement par la plateforme : « Marquer comme reversé » n’est qu’un registre, à cocher après un virement fait vous-même.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {summary&&<div className="stat-grid">
      {summary.nourOwnRevenueCents!=null&&<Stat label="CA propre Nūr (événements en direct)" value={money(summary.nourOwnRevenueCents)}/>}
      {summary.subscriptionMonthlyRevenueCents!=null&&<Stat label="Abonnements restaurateurs (mensuel)" value={`${money(summary.subscriptionMonthlyRevenueCents)} · ${summary.activeSubscriptionsCount} actifs`}/>}
      <Stat label="Volume brut billets restaurateurs" value={money(summary.grossTicketVolumeCents)}/>
      <Stat label="Commission Nour (héritée 30/70)" value={money(summary.commissionCents)}/>
      <Stat label="Dû au(x) restaurant(s) (modèle 30/70)" value={money(summary.restaurantDueCents)}/>
      <Stat label="Déjà reversé (modèle 30/70)" value={money(summary.paidOutCents)}/>
      <Stat label="Remboursé (modèle 30/70)" value={money(summary.refundedCents)}/>
      <Stat label="Frais Stripe (modèle 30/70)" value={money(summary.feesCents)}/>
      {summary.stripeBalance&&<Stat label="Solde Stripe (test) disponible / en attente" value={`${money(summary.stripeBalance.availableCents)} / ${money(summary.stripeBalance.pendingCents)}`}/>}
      {summary.disputesCount!=null&&<Stat label="Litiges Stripe en cours" value={summary.disputesCount>0?`${summary.disputesCount} · ${money(summary.disputesAmountCents)}`:"Aucun"}/>}
    </div>}
    {summary&&!summary.commissionLedgerEnabled&&<p className="fine left">Le registre commission 30/70 est désactivé depuis le passage à l’abonnement mensuel : « Commission », « Dû » et « Déjà reversé » ne couvrent que les ventes historiques sous l’ancien modèle, pas les événements récents sous abonnement. Le volume brut reste, lui, toujours à jour.</p>}
    {entries.length===0?<div className="empty"><span>◇</span><h2>Aucune vente pour le moment</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Événement</span><span>Brut</span><span>Commission</span><span>Dû restaurant</span><span>Statut</span></div>
      {entries.map(e=><div key={e.id} className="table-row"><span><b>{e.event.title}</b>{user?.role==="ADMIN"&&<small>{e.restaurant.name}</small>}</span><span>{money(e.grossAmountCents)}</span><span>{money(e.commissionAmountCents)} ({e.commissionRate}%)</span><span>{money(e.restaurantDueCents)}{e.refundedAmountCents>0&&<small className="fine"> · remboursé</small>}</span><span>{e.paidOutAt?<small className="fine">Reversé le {new Date(e.paidOutAt).toLocaleDateString("fr-FR")}</small>:user?.role==="ADMIN"?<button className="button small" disabled={busy===e.id} onClick={()=>markPaid(e.id)}>Marquer comme reversé</button>:<small className="fine">{e.readyToPayOut?"Prêt à reverser":"En attente"}</small>}</span></div>)}
    </div>}
  </div></section></Layout>;
}

function AdminAvailability() {
  const [slots,setSlots]=useState<any[]>([]);
  const [loadingSlots,setLoadingSlots]=useState(false);
  const [form,setForm]=useState({date:"",startTime:"18:00",endTime:"20:00",durationMinutes:20});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [generating,setGenerating]=useState(false);

  const loadSlots=()=>{setLoadingSlots(true);api<any[]>("/admin/interview-slots").then(setSlots).catch(()=>setSlots([])).finally(()=>setLoadingSlots(false))};
  useEffect(()=>{loadSlots()},[]);

  const generate=async(e:FormEvent)=>{
    e.preventDefault();setNotice(null);
    if(!form.date){setNotice({kind:"error",text:"Choisissez une date"});return}
    setGenerating(true);
    try{
      const res=await api<{created:number;skipped:number}>("/admin/interview-slots/generate",{method:"POST",body:JSON.stringify(form)});
      setNotice({kind:"success",text:`${res.created} créneau(x) ajouté(s)${res.skipped?`, ${res.skipped} déjà existant(s) ignoré(s)`:""}.`});
      loadSlots();
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setGenerating(false)}
  };
  const remove=async(slotId:string)=>{
    setNotice(null);
    try{await api(`/admin/interview-slots/${slotId}`,{method:"DELETE"});loadSlots()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };

  const byDay=useMemo(()=>{
    const map=new Map<string,any[]>();
    for(const s of slots){const key=new Date(s.startsAt).toDateString();if(!map.has(key))map.set(key,[]);map.get(key)!.push(s)}
    return map;
  },[slots]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Agenda des entretiens</h1><p className="fine">Un seul agenda pour toute la plateforme : un seul entretien possible à la fois.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="availability-layout">
      <form className="panel availability-form" onSubmit={generate}>
        <div className="panel-title"><h2>Ajouter des créneaux</h2></div>
        <label>Date<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
        <div className="time-row"><label>Début<input type="time" required value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>Fin<input type="time" required value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label></div>
        <label>Durée par entretien (minutes)<input type="number" min={5} max={180} required value={form.durationMinutes} onChange={e=>setForm({...form,durationMinutes:Number(e.target.value)})}/></label>
        <button className="button full" disabled={generating}>{generating?"Génération…":"Générer les créneaux"}</button>
      </form>
      <div className="panel availability-list">
        <div className="panel-title"><h2>Créneaux existants</h2><span>{slots.length} créneau(x)</span></div>
        {loadingSlots?<div className="calendar-state"><div className="spinner small"/><span>Chargement…</span></div>
        :slots.length===0?<div className="empty small"><span>◇</span><p>Aucun créneau créé.</p></div>
        :<div className="stack">{[...byDay.entries()].map(([day,daySlots])=><div key={day} className="availability-day"><small>{new Date(day).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}</small><div className="slot-chip-grid">{daySlots.map(s=><div key={s.id} className={`slot-chip ${s.application?"booked":""}`}><span>{timeLabel(s.startsAt)}</span>{s.application?<small>{s.application.user.displayName}</small>:<button type="button" onClick={()=>remove(s.id)} aria-label="Supprimer le créneau">×</button>}</div>)}</div></div>)}</div>}
      </div>
    </div>
  </div></section></Layout>;
}

function AdminAttendees() {
  const [events,setEvents]=useState<any[]>([]);
  const [eventId,setEventId]=useState("");
  const [reservations,setReservations]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [requestingFor,setRequestingFor]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);

  useEffect(()=>{api<any[]>("/admin/events").then(evts=>{setEvents(evts);if(evts[0])setEventId(evts[0].id)})},[]);
  const load=()=>{
    if(!eventId)return;
    setLoading(true);
    api<any[]>(`/admin/events/${eventId}/reservations`).then(setReservations).catch(()=>setReservations([])).finally(()=>setLoading(false));
  };
  useEffect(()=>{load()},[eventId]);

  const requestRefund=async(paymentId:string)=>{
    setBusy(paymentId);setNotice(null);
    try{await api(`/admin/payments/${paymentId}/refund-request`,{method:"POST",body:JSON.stringify({reason})});setNotice({kind:"success",text:"Demande envoyée au super-admin."});setRequestingFor(null);setReason("");await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  const STATUS_LABEL:Record<string,string>={PENDING:"En attente",SUCCEEDED:"Payé",FAILED:"Échoué",REFUNDED:"Remboursé"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Participants</h1><p className="fine">Informations nécessaires à l’organisation de votre événement uniquement.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="filters"><select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(ev=><option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></div>
    {loading?<Loading/>:reservations.length===0?<div className="empty"><span>◇</span><h2>Aucun participant pour le moment</h2></div>:<div className="panel table"><div className="table-row head"><span>Participant</span><span>Catégorie</span><span>Paiement</span><span>Billet</span></div>{reservations.map(r=><div key={r.id} className="table-row"><span><b>{r.user.displayName}</b>{r.user.phone&&<small>{r.user.phone}</small>}</span><span>{r.quotaCategory??"—"}</span><span>{r.payment?STATUS_LABEL[r.payment.status]??r.payment.status:"—"}{r.payment?.status==="SUCCEEDED"&&!r.payment.refundRequestedAt&&(requestingFor===r.payment.id?<div className="reject-note"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motif du remboursement"/><button className="button small danger" disabled={busy===r.payment.id||!reason} onClick={()=>requestRefund(r.payment.id)}>Envoyer la demande</button></div>:<button type="button" className="button small secondary" onClick={()=>setRequestingFor(r.payment.id)}>Demander un remboursement</button>)}{r.payment?.refundRequestedAt&&<small className="fine">Remboursement demandé</small>}</span><span>{r.ticket?.status==="USED"?"Utilisé":r.ticket?.status==="VALID"?"Valide":r.cancelledAt?"Annulé":"En attente"}</span></div>)}</div>}
  </div></section></Layout>;
}

function AdminStaff() {
  const [items,setItems]=useState<any[]>([]);
  const [form,setForm]=useState({phone:"",displayName:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const load=()=>api<any[]>("/admin/staff").then(setItems).catch(()=>setItems([]));
  useEffect(()=>{load()},[]);
  const add=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{await api("/admin/staff",{method:"POST",body:JSON.stringify(form)});setForm({phone:"",displayName:""});setNotice({kind:"success",text:"Accès accueil activé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const revoke=async(id:string)=>{
    setBusy(true);setNotice(null);
    try{await api(`/admin/staff/${id}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ADMINISTRATION</span><h1>Personnel d’accueil</h1><p className="fine">Ces comptes peuvent uniquement scanner les billets de votre établissement. Ils n’ont accès à aucune candidature, aucun client ni aucune donnée financière.</p>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={add}>
      <label>Téléphone<input required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+33612345678"/></label>
      <label>Nom<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="Prénom Nom"/></label>
      <button className="button" disabled={busy}>{busy?"…":"Donner l’accès accueil"}</button>
    </form>
    {items.length===0?<div className="empty small"><span>◇</span><p>Aucun personnel d’accueil pour le moment.</p></div>:<div className="stack">{items.map(s=><article key={s.id} className="panel restaurant-request"><div><h3>{s.displayName}</h3><p>{s.phone}</p></div><button className="button danger" disabled={busy} onClick={()=>revoke(s.id)}>Retirer l’accès</button></article>)}</div>}
  </div></section></Layout>;
}

function AdminOutbox() {
  const [items,setItems]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{api<any[]>("/admin/outbox").then(setItems).finally(()=>setLoading(false))},[]);
  const STATUS_LABEL:Record<string,string>={QUEUED:"En file d’attente",SENT:"Envoyé",FAILED:"Échec d’envoi"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Notifications SMS / e-mail</h1><p className="fine left">« Envoyé » signifie accepté par le fournisseur réel (Resend pour l’e-mail). Le SMS hors connexion reste simulé pour l’instant : il n’est jamais présenté comme envoyé.</p>
    {loading?<Loading/>:items.length===0?<div className="empty"><span>◇</span><h2>Aucun message pour le moment</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Destinataire</span><span>Message</span><span>Statut</span></div>
      {items.map(m=><div key={m.id} className="table-row"><span><b>{m.channel}</b><small>{m.recipient}</small></span><span>{m.subject&&<b>{m.subject} — </b>}{m.body}</span><span>{STATUS_LABEL[m.status]??m.status}{m.error&&<small className="fine left">{m.error}</small>}</span></div>)}
    </div>}
  </div></section></Layout>;
}

function AdminSettings() {
  const [items,setItems]=useState<any[]>([]);
  const [editing,setEditing]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/settings").then(setItems);
  useEffect(()=>{load()},[]);

  const save=async(key:string)=>{
    setBusy(key);setNotice(null);
    const raw=editing[key];
    let value:unknown=raw;
    if(typeof items.find(i=>i.key===key)?.value==="boolean") value=raw==="true";
    else if(typeof items.find(i=>i.key===key)?.value==="number") value=Number(raw);
    try{await api(`/admin/settings/${key}`,{method:"PATCH",body:JSON.stringify({value})});setNotice({kind:"success",text:`${key} mis à jour.`});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Paramètres applicatifs</h1><p className="fine left">Valeurs provisoires du cahier des charges (verrou de paiement, quotas, drapeaux de fonction, contenu de la page « Le concept »…), modifiables ici sans redéploiement. Chaque modification est journalisée.</p>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="panel table">
      <div className="table-row head"><span>Paramètre</span><span>Valeur</span><span>Par défaut</span></div>
      {items.map(it=><div key={it.key} className="table-row settings-row"><span><b>{it.key}</b><small>{it.description}</small></span><span><input value={editing[it.key]??String(it.value)} onChange={e=>setEditing({...editing,[it.key]:e.target.value})}/></span><span><small className="fine">{String(it.default)}</small><button className="button small" disabled={busy===it.key} onClick={()=>save(it.key)}>Enregistrer</button></span></div>)}
    </div>
  </div></section></Layout>;
}

function AdminTestimonials() {
  const [items,setItems]=useState<any[]>([]);
  const [form,setForm]=useState({displayName:"",eventType:"Speed dating",text:"",rating:5,status:"DRAFT" as "DRAFT"|"PUBLISHED",position:0});
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const load=()=>api<any[]>("/admin/testimonials").then(setItems);
  useEffect(()=>{load()},[]);

  const create=async(e:FormEvent)=>{
    e.preventDefault();setBusy("new");setNotice(null);
    try{await api("/admin/testimonials",{method:"POST",body:JSON.stringify(form)});setForm({displayName:"",eventType:"Speed dating",text:"",rating:5,status:"DRAFT",position:0});setNotice({kind:"success",text:"Témoignage créé."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const toggleStatus=async(t:any)=>{
    setBusy(t.id);setNotice(null);
    try{await api(`/admin/testimonials/${t.id}`,{method:"PATCH",body:JSON.stringify({status:t.status==="PUBLISHED"?"DRAFT":"PUBLISHED"})});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const remove=async(id:string)=>{
    setBusy(id);setNotice(null);
    try{await api(`/admin/testimonials/${id}`,{method:"DELETE"});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Témoignages</h1><p className="fine left">Jamais publié automatiquement, même soumis par un participant : chaque témoignage reste en brouillon tant qu’il n’est pas explicitement publié ici.</p>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <form className="panel form-grid" onSubmit={create}>
      <div className="panel-title"><h2>Nouveau témoignage</h2></div>
      <label>Prénom ou pseudonyme<input required value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})}/></label>
      <label>Type d’événement<select value={form.eventType} onChange={e=>setForm({...form,eventType:e.target.value})}>{EVENT_CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
      <label>Note (1 à 5, facultatif)<input type="number" min={1} max={5} value={form.rating} onChange={e=>setForm({...form,rating:Number(e.target.value)})}/></label>
      <label className="wide">Texte<textarea required minLength={10} value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/></label>
      <button className="button" disabled={busy==="new"}>Créer (en brouillon)</button>
    </form>
    <div className="stack">{items.map(t=><article key={t.id} className="panel restaurant-request"><div><h3>{t.displayName}</h3><p className="fine left">{t.eventType}{t.rating?` · ${"★".repeat(t.rating)}`:""}</p><p className="fine left">{t.text}</p><small>{t.status==="PUBLISHED"?"Publié":"Brouillon"}</small></div><div className="decision-buttons"><button className="button small" disabled={busy===t.id} onClick={()=>toggleStatus(t)}>{t.status==="PUBLISHED"?"Dépublier":"Publier"}</button><button className="button small danger" disabled={busy===t.id} onClick={()=>remove(t.id)}>Supprimer</button></div></article>)}</div>
  </div></section></Layout>;
}

const ARTICLE_STATUS_LABEL:Record<string,string>={DRAFT:"Brouillon",IN_REVIEW:"En validation",APPROVED:"Validé",PUBLISHED:"Publié",ARCHIVED:"Archivé"};

function AdminBlog() {
  const [items,setItems]=useState<any[]>([]);
  const [status,setStatus]=useState("");
  const [genForm,setGenForm]=useState({topic:"",category:BLOG_CATEGORIES[0]});
  const [newForm,setNewForm]=useState({title:"",category:BLOG_CATEGORIES[0]});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [queue,setQueue]=useState<{count:number;next:{title:string;category:string}[]}|null>(null);
  const navigate=useNavigate();
  const load=()=>api<any[]>(`/admin/articles${status?`?status=${status}`:""}`).then(setItems);
  useEffect(()=>{load();api<{count:number;next:{title:string;category:string}[]}>("/admin/articles/queue").then(setQueue).catch(()=>{})},[status]);
  const slugify=(t:string)=>t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

  const generate=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{const article=await api<{id:string}>("/admin/articles/generate",{method:"POST",body:JSON.stringify(genForm)});navigate(`/admin/blog/${article.id}`)}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };
  const createManual=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setNotice(null);
    try{
      const article=await api<{id:string}>("/admin/articles",{method:"POST",body:JSON.stringify({title:newForm.title,slug:`${slugify(newForm.title)}-${Date.now().toString().slice(-5)}`,category:newForm.category,content:"À rédiger.",keywords:[]})});
      navigate(`/admin/blog/${article.id}`);
    }catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(false)}
  };

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>Blog</h1><p className="fine left">Aucun article — écrit à la main ou généré par IA — n’est jamais publié sans validation humaine explicite.</p>
    {queue&&queue.count>0&&<Notice kind="info">{queue.count} article{queue.count>1?"s":""} en réserve, proposé{queue.count>1?"s":""} ici à raison d’un par jour une fois en production. Prochain : « {queue.next[0]?.title} » ({queue.next[0]?.category}).</Notice>}
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="admin-grid">
      <form className="panel form-grid" onSubmit={createManual}>
        <div className="panel-title"><h2>Nouvel article</h2></div>
        <label>Titre<input required value={newForm.title} onChange={e=>setNewForm({...newForm,title:e.target.value})}/></label>
        <label>Thème<select value={newForm.category} onChange={e=>setNewForm({...newForm,category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <button className="button small" disabled={busy}>Créer et modifier</button>
      </form>
      <form className="panel form-grid" onSubmit={generate}>
        <div className="panel-title"><h2>Générer un brouillon (IA)</h2></div>
        <label>Sujet<input required value={genForm.topic} onChange={e=>setGenForm({...genForm,topic:e.target.value})} placeholder="Ex. : bien communiquer après une dispute"/></label>
        <label>Thème<select value={genForm.category} onChange={e=>setGenForm({...genForm,category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <button className="button small secondary" disabled={busy}>Générer un brouillon</button>
      </form>
    </div>
    <div className="filters"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(ARTICLE_STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
    {items.length===0?<div className="empty"><span>◇</span><h2>Aucun article</h2></div>:<div className="panel table">
      <div className="table-row head"><span>Titre</span><span>Thème</span><span>Statut</span></div>
      {items.map(a=><Link key={a.id} to={`/admin/blog/${a.id}`} className="table-row"><span><b>{a.title}</b>{a.aiGenerated&&<small>Généré par IA</small>}</span><span>{a.category}</span><span>{ARTICLE_STATUS_LABEL[a.status]}</span></Link>)}
    </div>}
  </div></section></Layout>;
}

function AdminArticleEditor() {
  const {id}=useParams();
  const navigate=useNavigate();
  const [article,setArticle]=useState<any>(null);
  const [form,setForm]=useState({title:"",slug:"",excerpt:"",content:"",category:"",keywords:"",metaTitle:"",metaDescription:""});
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [preview,setPreview]=useState(false);
  const [socialCopy,setSocialCopy]=useState<any[]|null>(null);
  const [scheduleAt,setScheduleAt]=useState("");
  const [rejectNote,setRejectNote]=useState("");

  const load=()=>api<any>(`/admin/articles/${id}`).then(a=>{setArticle(a);setForm({title:a.title,slug:a.slug,excerpt:a.excerpt??"",content:a.content,category:a.category,keywords:(a.keywords??[]).join(", "),metaTitle:a.metaTitle??"",metaDescription:a.metaDescription??""})});
  useEffect(()=>{load()},[id]);

  const save=async(e:FormEvent)=>{
    e.preventDefault();setBusy("save");setNotice(null);
    try{await api(`/admin/articles/${id}`,{method:"PATCH",body:JSON.stringify({...form,keywords:form.keywords.split(",").map(k=>k.trim()).filter(Boolean)})});setNotice({kind:"success",text:"Enregistré."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const action=async(path:string,body?:unknown)=>{
    setBusy(path);setNotice(null);
    try{await api(`/admin/articles/${id}/${path}`,{method:"POST",body:body?JSON.stringify(body):undefined});setNotice({kind:"success",text:"Mis à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const uploadImage=async(file:File)=>{
    const body=new FormData();body.append("file",file);
    try{await api(`/admin/articles/${id}/image`,{method:"POST",body});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
  };
  const generateSocial=async()=>{
    setBusy("social");setNotice(null);
    try{setSocialCopy(await api<any[]>(`/admin/articles/${id}/social-copy`,{method:"POST"}))}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusy(null)}
  };
  const remove=async()=>{setBusy("delete");try{await api(`/admin/articles/${id}`,{method:"DELETE"});navigate("/admin/blog")}catch(err){setNotice({kind:"error",text:(err as Error).message});setBusy(null)}};

  if(!article)return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><Loading/></div></section></Layout>;
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main">
    <div className="admin-heading"><div><span className="eyebrow">SUPER-ADMINISTRATION</span><h1>{article.title}</h1><p className="fine left">Statut : <b>{ARTICLE_STATUS_LABEL[article.status]}</b>{article.aiGenerated&&" · généré par IA"}</p></div><button type="button" className="button small secondary" onClick={()=>setPreview(!preview)}>{preview?"Modifier":"Aperçu"}</button></div>
    {notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {preview?<div className="panel" style={{maxWidth:760}}>
      <span className="eyebrow">{form.category.toUpperCase()}</span><h2 style={{fontFamily:"'Playfair Display',serif"}}>{form.title}</h2>
      {article.imageUrl&&<img src={imgUrl(article.imageUrl)} alt="" style={{width:"100%",borderRadius:14,margin:"20px 0"}}/>}
      <div className="article-body">{form.content.split("\n\n").map((p,i)=><p key={i}>{renderArticleParagraph(p)}</p>)}</div>
    </div>:<form className="panel form-grid" onSubmit={save}>
      <label>Titre<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label>Identifiant (slug)<input required pattern="[a-z0-9-]+" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label>Thème<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label>Mots-clés (séparés par des virgules)<input value={form.keywords} onChange={e=>setForm({...form,keywords:e.target.value})}/></label>
      <label className="wide">Extrait<textarea value={form.excerpt} onChange={e=>setForm({...form,excerpt:e.target.value})}/></label>
      <label className="wide">Contenu (un paragraphe par ligne vide)<textarea required style={{minHeight:260}} value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/></label>
      <label>Titre SEO (facultatif)<input value={form.metaTitle} onChange={e=>setForm({...form,metaTitle:e.target.value})}/></label>
      <label>Méta-description SEO (facultatif)<input value={form.metaDescription} onChange={e=>setForm({...form,metaDescription:e.target.value})}/></label>
      <label className="fine wide">Image principale{article.imageUrl&&<img src={imgUrl(article.imageUrl)} alt="" style={{width:220,borderRadius:8,display:"block",margin:"8px 0"}}/>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>e.target.files?.[0]&&uploadImage(e.target.files[0])}/></label>
      <button className="button" disabled={busy==="save"}>Enregistrer</button>
    </form>}
    <div className="panel" style={{marginTop:20}}>
      <div className="panel-title"><h2>Circuit de validation</h2></div>
      <div className="decision-buttons">
        {article.status==="DRAFT"&&<button className="button" disabled={!!busy} onClick={()=>action("submit-for-review")}>Soumettre à validation</button>}
        {article.status==="IN_REVIEW"&&<><button className="button" disabled={!!busy} onClick={()=>action("decision",{accept:true})}>Valider</button><div className="reject-note"><input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Motif du renvoi (optionnel)"/><button className="button danger" disabled={!!busy} onClick={()=>action("decision",{accept:false,note:rejectNote})}>Renvoyer en brouillon</button></div></>}
        {article.status==="APPROVED"&&<><button className="button" disabled={!!busy} onClick={()=>action("publish")}>Publier maintenant</button><div className="time-row"><input type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/><button className="button secondary" disabled={!!busy||!scheduleAt} onClick={()=>action("schedule",{publishAt:new Date(scheduleAt).toISOString()})}>Programmer</button></div></>}
        {article.status==="PUBLISHED"&&<button className="button secondary" disabled={!!busy} onClick={()=>action("archive")}>Archiver</button>}
        <button className="button danger" disabled={!!busy} onClick={remove}>Supprimer</button>
      </div>
      {article.scheduledAt&&<p className="fine left">Publication programmée le {new Date(article.scheduledAt).toLocaleString("fr-FR")}.</p>}
    </div>
    <div className="panel" style={{marginTop:20}}>
      <div className="panel-title"><h2>Propositions sociales (IA)</h2><button type="button" className="button small secondary" disabled={busy==="social"} onClick={generateSocial}>Générer</button></div>
      {socialCopy&&<div className="stack">{socialCopy.map((s,i)=><div key={i} className="notice"><b>{s.platform}</b><p>{s.text}</p></div>)}</div>}
    </div>
    {article.reviewLogs?.length>0&&<div className="panel" style={{marginTop:20}}>
      <div className="panel-title"><h2>Journal de validation</h2></div>
      {article.reviewLogs.map((l:any)=><p key={l.id} className="fine left">{new Date(l.createdAt).toLocaleString("fr-FR")} — {ARTICLE_STATUS_LABEL[l.fromStatus]} → {ARTICLE_STATUS_LABEL[l.toStatus]}{l.note?` : ${l.note}`:""}</p>)}
    </div>}
  </div></section></Layout>;
}

function AdminModeration() {
  const {user}=useAuth();
  const [items,setItems]=useState<any[]>([]);
  const [mods,setMods]=useState<any[]>([]);
  const [modForm,setModForm]=useState({phone:"",displayName:""});
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [busyId,setBusyId]=useState<string|null>(null);
  const load=()=>api<any[]>("/admin/reports").then(setItems);
  const loadMods=()=>api<any[]>("/admin/moderators").then(setMods);
  useEffect(()=>{load();if(user?.role==="ADMIN")loadMods()},[user?.role]);
  const decide=async(id:string,status:string)=>{
    setBusyId(id);setNotice(null);
    try{await api(`/admin/reports/${id}/decision`,{method:"POST",body:JSON.stringify({status})});setNotice({kind:"success",text:"Signalement mis à jour."});await load()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const addMod=async(e:FormEvent)=>{
    e.preventDefault();setBusyId("mod");setNotice(null);
    try{await api("/admin/moderators",{method:"POST",body:JSON.stringify(modForm)});setModForm({phone:"",displayName:""});await loadMods()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const revokeMod=async(id:string)=>{
    setBusyId(id);setNotice(null);
    try{await api(`/admin/moderators/${id}`,{method:"DELETE"});await loadMods()}
    catch(err){setNotice({kind:"error",text:(err as Error).message})}
    finally{setBusyId(null)}
  };
  const STATUS_LABEL:Record<string,string>={OPEN:"Ouvert",REVIEWING:"En cours d’examen",RESOLVED:"Résolu",DISMISSED:"Classé sans suite"};
  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">MODÉRATION</span><h1>Signalements</h1>{notice&&<Notice kind={notice.kind}>{notice.text}</Notice>}
    {user?.role==="ADMIN"&&<div className="panel form-grid"><div className="panel-title"><h2>Modérateurs</h2><span>Personnes autorisées à traiter les signalements</span></div>
      {mods.length>0&&<div className="stack">{mods.map(m=><div key={m.id} className="table-row"><span><b>{m.displayName}</b> · {m.phone}</span><button type="button" className="button danger small" disabled={busyId===m.id} onClick={()=>revokeMod(m.id)}>Retirer</button></div>)}</div>}
      <form className="time-row wide" onSubmit={addMod}><input required placeholder="+33612345678" value={modForm.phone} onChange={e=>setModForm({...modForm,phone:e.target.value})}/><input placeholder="Nom" value={modForm.displayName} onChange={e=>setModForm({...modForm,displayName:e.target.value})}/><button className="button" disabled={busyId==="mod"}>Nommer modérateur</button></form>
    </div>}
    {items.length===0?<div className="empty"><span>◇</span><h2>Aucun signalement</h2></div>:<div className="stack">{items.map(r=><article key={r.id} className="panel restaurant-request"><div><h3>{r.reporter.displayName} → {r.reported.displayName}</h3><p>{r.reason}</p>{r.details&&<p className="fine left">{r.details}</p>}<small>{STATUS_LABEL[r.status]??r.status} · {dateTime(r.createdAt)}</small></div>{!["RESOLVED","DISMISSED"].includes(r.status)&&<div className="decision-buttons"><button className="button" disabled={busyId===r.id} onClick={()=>decide(r.id,"REVIEWING")}>Mettre en examen</button><button className="button" disabled={busyId===r.id} onClick={()=>decide(r.id,"RESOLVED")}>Résoudre</button><button className="button danger" disabled={busyId===r.id} onClick={()=>decide(r.id,"DISMISSED")}>Classer</button></div>}</article>)}</div>}
  </div></section></Layout>;
}

function Scanner() {
  const [code,setCode]=useState("");
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState("");
  const [cameraError,setCameraError]=useState("");
  const [scanning,setScanning]=useState(false);
  const videoRef=useRef<HTMLVideoElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const rafRef=useRef<number|null>(null);
  const lastScanRef=useRef<{code:string;at:number}>({code:"",at:0});
  const busyRef=useRef(false);

  const runScan=async(scannedCode:string)=>{
    if(!scannedCode||busyRef.current)return;
    busyRef.current=true;setResult(null);setError("");
    try{setResult(await api("/admin/tickets/scan",{method:"POST",body:JSON.stringify({code:scannedCode})}))}
    catch(err){setError((err as Error).message)}
    finally{busyRef.current=false}
  };
  const submitManual=(e:FormEvent)=>{e.preventDefault();runScan(code)};

  useEffect(()=>{
    let cancelled=false;
    if(!window.isSecureContext){setCameraError("La caméra nécessite une connexion sécurisée (HTTPS). Utilisez la saisie manuelle ci-dessous.");return}
    if(!navigator.mediaDevices?.getUserMedia){setCameraError("Caméra non prise en charge par ce navigateur. Utilisez la saisie manuelle ci-dessous.");return}
    const tick=()=>{
      const video=videoRef.current,canvas=canvasRef.current;
      if(video&&canvas&&video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        const ctx=canvas.getContext("2d");
        if(ctx){
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
          const found=jsQR(imageData.data,imageData.width,imageData.height);
          if(found?.data){
            const now=Date.now();
            if(found.data!==lastScanRef.current.code||now-lastScanRef.current.at>3000){
              lastScanRef.current={code:found.data,at:now};
              runScan(found.data);
            }
          }
        }
      }
      rafRef.current=requestAnimationFrame(tick);
    };
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
      .then(stream=>{
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return}
        streamRef.current=stream;
        if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{})}
        setScanning(true);
        rafRef.current=requestAnimationFrame(tick);
      })
      .catch(()=>setCameraError("Accès à la caméra refusé ou indisponible. Utilisez la saisie manuelle ci-dessous."));
    return ()=>{
      cancelled=true;
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ACCUEIL</span><h1>Scanner un billet</h1><div className="scanner-layout"><div className="scanner panel">
    <div className="scan-frame">
      {cameraError?<div className="camera-fallback"><span>QR</span><p>{cameraError}</p></div>
      :<video ref={videoRef} muted playsInline/>}
      {scanning&&<span className="camera-live">● Caméra active</span>}
    </div>
    <canvas ref={canvasRef} style={{display:"none"}}/>
    <form className="manual-fallback" onSubmit={submitManual}><label>Saisie manuelle (secours)<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Code du billet"/></label><button className="button full">Vérifier et valider l’entrée</button></form>
  </div><aside className={`scan-result panel ${result?"success":error?"error":""}`}>{result?<><b>✓</b><h2>Entrée autorisée</h2><p>{result.participant}</p><span>{result.event}</span></>:error?<><b>×</b><h2>Entrée refusée</h2><p>{error}</p></>:<><b>⌗</b><h2>En attente d’un billet</h2><p>Présentez le QR code du billet devant la caméra, ou saisissez le code manuellement.</p></>}</aside></div></div></section></Layout>;
}

export function App(){return <AuthProvider><Routes><Route path="/" element={<Home/>}/><Route path="/events" element={<Events/>}/><Route path="/events/:id" element={<EventDetail/>}/><Route path="/concept" element={<Concept/>}/><Route path="/blog" element={<Blog/>}/><Route path="/blog/:id" element={<ArticlePage/>}/><Route path="/login" element={<Login/>}/><Route path="/legal/mentions-legales" element={<Layout><MentionsLegales/></Layout>}/><Route path="/legal/cgu" element={<Layout><CGU/></Layout>}/><Route path="/legal/cgv" element={<Layout><CGV/></Layout>}/><Route path="/legal/confidentialite" element={<Layout><Confidentialite/></Layout>}/><Route path="/legal/cookies" element={<Layout><Cookies/></Layout>}/><Route path="/pay/:applicationId" element={<PayStandalone/>}/><Route path="/dashboard" element={<Protected roles={["PARTICIPANT"]}><Dashboard/></Protected>}/><Route path="/restaurant" element={<Protected roles={["PARTICIPANT","ORGANIZER"]}><RestaurantSpace/></Protected>}/><Route path="/admin" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION","MODERATOR"]}><Admin/></Protected>}/><Route path="/admin/applications" element={<Protected roles={["ADMIN"]}><AdminGlobalInterviews/></Protected>}/><Route path="/admin/availability" element={<Protected roles={["ADMIN"]}><AdminAvailability/></Protected>}/><Route path="/admin/events/new" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminCreateEvent/></Protected>}/><Route path="/admin/events" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminEventPhotos/></Protected>}/><Route path="/admin/attendees" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminAttendees/></Protected>}/><Route path="/admin/finance" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminFinance/></Protected>}/><Route path="/admin/staff" element={<Protected roles={["ADMIN","ORGANIZER"]}><AdminStaff/></Protected>}/><Route path="/admin/moderation" element={<Protected roles={["ADMIN","MODERATOR"]}><AdminModeration/></Protected>}/><Route path="/admin/outbox" element={<Protected roles={["ADMIN"]}><AdminOutbox/></Protected>}/><Route path="/admin/settings" element={<Protected roles={["ADMIN"]}><AdminSettings/></Protected>}/><Route path="/admin/testimonials" element={<Protected roles={["ADMIN"]}><AdminTestimonials/></Protected>}/><Route path="/admin/blog" element={<Protected roles={["ADMIN"]}><AdminBlog/></Protected>}/><Route path="/admin/blog/:id" element={<Protected roles={["ADMIN"]}><AdminArticleEditor/></Protected>}/><Route path="/admin/restaurants" element={<Protected roles={["ADMIN"]}><AdminRestaurants/></Protected>}/><Route path="/admin/stats" element={<Protected roles={["ADMIN"]}><AdminStats/></Protected>}/><Route path="/admin/scanner" element={<Protected roles={["ADMIN","ORGANIZER","RECEPTION"]}><Scanner/></Protected>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AuthProvider>}
