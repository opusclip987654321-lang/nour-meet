import { EVENT_VIEWER_STATUS_LABEL } from "@nour/shared";
import type { EventViewerStatus, PublicEvent } from "@nour/shared";
import { ArrowRight, BadgeCheck, CalendarDays, CircleCheck, Heart, Hourglass, MapPin, Share2, Users } from "lucide-react";
import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { imgUrl, money } from "../lib/format";

// Avatar : vraie photo de profil si elle existe, sinon les initiales — jamais l'inverse, jamais un
// visage générique. Même composant partout (dashboard, messagerie, entretiens) pour que l'ajout
// d'une photo se reflète immédiatement à tous les endroits où le compte apparaît.
export const Avatar = ({ name, photoUrl, size, className, verified }: { name?: string | null; photoUrl?: string | null; size?: "large"; className?: string; verified?: boolean }) => {
  const cls = `avatar${size ? ` ${size}` : ""}${className ? ` ${className}` : ""}`;
  const img = photoUrl ? <img className={cls} src={imgUrl(photoUrl)} alt="" /> : <div className={cls}>{(name ?? "?").slice(0, 2).toUpperCase()}</div>;
  if (!verified) return img;
  return <div className="avatar-wrap">{img}<span className="verified-badge" title="Profil vérifié"><BadgeCheck size={13} aria-hidden="true"/>Vérifié</span></div>;
};

export { Logo } from "./brand";

export function Loading() { return <div className="state-page"><div className="spinner"/><h2>Chargement…</h2></div>; }
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
    <button type="button" className="button secondary full" onClick={share}><Share2 size={18} aria-hidden="true"/>Inviter un ami</button>
    {copied && <p className="fine share-copied">Lien copié !</p>}
    {error && <p className="fine share-copied">{error}</p>}
  </div>;
}

// §15 : couleur, icône et badge distincts par type d'événement. Côté web, la couleur vient des
// tokens (--rencontre, --networking) via data-category ; une catégorie ajoutée sans entrée ici
// s'affiche en badge neutre, sans icône, plutôt que de casser l'affichage.
const CATEGORY_ICON: Record<string, ReactNode> = {
  "Speed dating": <Heart size={14} aria-hidden="true" />,
  "Networking": <Users size={14} aria-hidden="true" />
};
export function CategoryBadge({ category, className }: {category: string; className?: string}) {
  return <span className={`category-badge${className ? ` ${className}` : ""}`} data-category={category}>{CATEGORY_ICON[category] ?? null}{category}</span>;
}

// §5.2 (corrections web 2026-09-24) : « Participe déjà » ou « Liste d'attente », rien d'autre — un
// événement sans lien avec le visiteur n'affiche aucun statut.
export function ViewerStatusBadge({ status }: { status: EventViewerStatus | undefined }) {
  if (!status) return null;
  return <span className={`viewer-badge ${status === "CONFIRMED" ? "confirmed" : "waitlist"}`} data-testid="viewer-status">{status === "CONFIRMED" ? <CircleCheck size={14} aria-hidden="true"/> : <Hourglass size={14} aria-hidden="true"/>}{EVENT_VIEWER_STATUS_LABEL[status]}</span>;
}

// C24 : jamais de chiffre brut de capacité/quota — seulement ce que la disponibilité calculée
// côté serveur autorise à dire pour CE visiteur.
export const availabilityLabel=(a:PublicEvent["availability"])=>a.kind==="unknown"?"Places selon catégorie":a.full?"Complet":`${a.remaining} place${a.remaining>1?"s":""} restante${a.remaining>1?"s":""}`;
// Carte événement : la carte entière est cliquable (lien étiré depuis le titre, un seul lien
// pour les lecteurs d'écran), image au ratio fixe 4/3 pour qu'aucune carte ne « saute » au
// chargement, date et lieu avant le prix — l'ordre dans lequel on décide d'y aller.
const shortDate = (value: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)).replace(":", "h");
export function EventCard({ event, priority = false, headingLevel = 3 }: {event: PublicEvent; priority?: boolean; headingLevel?: 2 | 3}) {
  const Title = headingLevel === 2 ? "h2" : "h3";
  const full=event.availability.kind!=="unknown"&&event.availability.full;
  const priceLabel=event.priceTiers.length>0?`dès ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:event.priceCents===0?"Gratuit":money(event.priceCents);
  return <article className="event-card">
    <div className="event-art">
      <img src={imgUrl(event.imageUrl)} alt="" loading={priority?"eager":"lazy"} decoding="async" width={800} height={600}/>
      <div className="event-art-badges"><CategoryBadge category={event.category}/>{event.highlightTier==="priority"&&<span className="badge neutral">Coup de cœur</span>}{event.highlightTier==="simple"&&<span className="badge neutral">Partenaire</span>}</div>
      {full&&<span className="full-badge">Complet</span>}
    </div>
    <div className="event-copy">
      <p className="event-date"><CalendarDays size={16} aria-hidden="true"/>{shortDate(event.startsAt)}<ViewerStatusBadge status={event.viewerStatus}/></p>
      <Title className="event-title"><Link to={`/events/${event.slug}`} className="stretched">{event.title}</Link></Title>
      <p className="event-place"><MapPin size={16} aria-hidden="true"/>{event.district}<span aria-hidden="true">·</span>{availabilityLabel(event.availability)}</p>
      <div className="event-foot"><strong>{priceLabel}</strong><span className="event-more" aria-hidden="true">Voir la soirée<ArrowRight size={16}/></span></div>
    </div>
  </article>;
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
