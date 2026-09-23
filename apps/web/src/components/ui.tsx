import { EVENT_CATEGORIES } from "@nour/shared";
import type { PublicEvent } from "@nour/shared";
import { ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { dateTime, imgUrl, money } from "../lib/format";

// Avatar : vraie photo de profil si elle existe, sinon les initiales — jamais l'inverse, jamais un
// visage générique. Même composant partout (dashboard, messagerie, entretiens) pour que l'ajout
// d'une photo se reflète immédiatement à tous les endroits où le compte apparaît.
export const Avatar = ({ name, photoUrl, size, className, verified }: { name?: string | null; photoUrl?: string | null; size?: "large"; className?: string; verified?: boolean }) => {
  const cls = `avatar${size ? ` ${size}` : ""}${className ? ` ${className}` : ""}`;
  const img = photoUrl ? <img className={cls} src={imgUrl(photoUrl)} alt="" /> : <div className={cls}>{(name ?? "?").slice(0, 2).toUpperCase()}</div>;
  if (!verified) return img;
  return <div className="avatar-wrap">{img}<span className="verified-badge" title="Profil vérifié">✓ Vérifié</span></div>;
};

export function Logo() { return <Link className="logo" to="/"><span>N</span><strong>NŪR <b>MEET</b></strong></Link>; }

export function Loading() { return <div className="state-page"><div className="spinner"/><h2>Chargement…</h2></div>; }
// C13/C14 (ordre correctif 2026-09-20) : liste de notifications partagée (participant, restaurateur,
// admin) — chronologique, lu/non lu, cliquable vers la destination métier exacte (linkPath), jamais
// un lien générique. Un clic marque lu puis navigue ; une notification sans linkPath reste affichée
// mais non cliquable plutôt que de pointer vers un lien mort.
export function NotificationList({ items, onRead }: { items: any[]; onRead: (id: string) => void }) {
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
export function Notice({ kind="info", children }: {kind?: "info"|"error"|"success", children: ReactNode}) { return <div className={`notice ${kind}`}>{children}</div>; }

// C23 (ordre correctif 2026-09-20) : un seul bouton principal, libellé 2-3 mots ("Invite un ami"),
// qui ouvre la feuille de partage native (WhatsApp, SMS, apps installées) si disponible, sinon
// retombe sur la copie du lien — jamais de boutons séparés Facebook/Instagram/TikTok, dont
// certains ne pouvaient de toute façon pas déclencher un vrai partage direct par URL.
export function ShareButton({ event }: { event: PublicEvent }) {
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

// §15 : couleur, icône et badge distincts par type d'événement. La couleur vient de EVENT_CATEGORIES
// (partagée avec l'API/mobile) ; l'icône reste ici car elle dépend de JSX. Une catégorie ajoutée
// sans entrée ici retombe sur un simple point de sa couleur plutôt que de casser l'affichage.
const CATEGORY_ICON: Record<string, ReactNode> = {
  "Speed dating": <svg viewBox="0 0 24 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.6"/><circle cx="16" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.6"/></svg>,
  "Networking": <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true"><circle cx="6" cy="18" r="2.1" fill="currentColor"/><circle cx="18" cy="18" r="2.1" fill="currentColor"/><circle cx="12" cy="6" r="2.1" fill="currentColor"/><path d="M6 18 12 6 18 18" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
};
export function CategoryBadge({ category, className }: {category: string; className?: string}) {
  const color = EVENT_CATEGORIES.find(c => c.name === category)?.color ?? "var(--gold)";
  const icon = CATEGORY_ICON[category] ?? <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>;
  return <span className={`category-badge${className ? ` ${className}` : ""}`} style={{ color, borderColor: color }}>{icon}{category}</span>;
}

// C24 : jamais de chiffre brut de capacité/quota — seulement ce que la disponibilité calculée
// côté serveur autorise à dire pour CE visiteur.
export const availabilityLabel=(a:PublicEvent["availability"])=>a.kind==="unknown"?"Places selon catégorie":a.full?"Complet":`${a.remaining} place${a.remaining>1?"s":""} restante${a.remaining>1?"s":""}`;
export function EventCard({ event }: {event: PublicEvent}) {
  const full=event.availability.kind!=="unknown"&&event.availability.full;
  const priceLabel=event.priceTiers.length>0?`À partir de ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:money(event.priceCents);
  return <article className="event-card"><Link to={`/events/${event.slug}`} className="event-art"><img src={imgUrl(event.imageUrl)} alt={event.title} loading="lazy"/><CategoryBadge category={event.category}/>{event.highlightTier==="priority"&&<span className="verified-badge" style={{position:"absolute",top:16,right:16}}>★ Mise en avant</span>}{event.highlightTier==="simple"&&<span className="category-badge" style={{position:"absolute",top:16,right:16,color:"#ddd",borderColor:"#555"}}>Partenaire</span>}{full&&<span className="full-badge">Complet</span>}</Link><div className="event-copy"><small>{dateTime(event.startsAt).toUpperCase()}</small><h3>{event.title}</h3><p>{event.district} · {availabilityLabel(event.availability)}</p><div><strong>{priceLabel}</strong><Link to={`/events/${event.slug}`}>Découvrir →</Link></div></div></article>;
}

// §5 (cahier des charges 2026-09) : les articles doivent pouvoir renvoyer vers d'autres parties
// du site (ex. réserver une soirée), pas seulement exister pour le SEO. Convention légère de type
// Markdown "[libellé](/chemin)" dans le texte : un chemin commençant par "/" devient un lien interne
// (react-router, jamais de rechargement de page), tout le reste un lien externe classique.
export const renderArticleParagraph = (text: string) => {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!match) return part;
    const [, label, url] = match;
    return url.startsWith("/") ? <Link key={i} to={url} className="link-button" style={{display:"inline"}}>{label}</Link> : <a key={i} href={url} target="_blank" rel="noreferrer">{label}</a>;
  });
};
