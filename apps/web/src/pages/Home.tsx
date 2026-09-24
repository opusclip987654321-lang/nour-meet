import type { Paginated, PublicEvent } from "@nour/shared";
import { ArrowRight, BadgeCheck, CalendarDays, Flag, Handshake, Heart, Lock, MapPin, MessageCircleHeart, PhoneCall, QrCode, ShieldCheck, Store, Ticket, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Picture } from "../components/brand";
import { Layout } from "../components/Layout";
import { EventCard, availabilityLabel } from "../components/ui";
import { imgUrl, money } from "../lib/format";
import { SITE_NAME, SITE_URL, absoluteUrl, useSeo } from "../lib/seo";

// Témoignages : uniquement ceux saisis ou validés dans l'administration (API /testimonials). Aucun
// avis de remplacement : si la liste est vide, la section n'existe pas.
function TestimonialsSection({ eventType }: { eventType?: string }) {
  const [items,setItems]=useState<any[]>([]);
  useEffect(()=>{api<any[]>(`/testimonials${eventType?`?eventType=${encodeURIComponent(eventType)}`:""}`).then(setItems).catch(()=>{})},[eventType]);
  if(items.length===0) return null;
  return <section className="section" aria-labelledby="temoignages">
    <div className="section-title"><h2 id="temoignages">Ils sont venus, ils racontent</h2></div>
    <div className="testimonial-grid">{items.map(t=><figure key={t.id} className="testimonial-card">
      <blockquote>« {t.text} »</blockquote>
      <figcaption className="testimonial-head"><span className="testimonial-avatar" aria-hidden="true">{t.displayName.slice(0,2).toUpperCase()}</span><div><b>{t.displayName}</b><span>{t.eventType}{t.rating?` · ${t.rating}/5`:""}</span></div></figcaption>
    </figure>)}</div>
  </section>;
}

const shortDate=(value:string)=>new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(value)).replace(":","h");

// Carte « prochaine soirée » du premier écran : un vrai événement publié, jamais un exemple
// inventé (G2) — sans événement, une invitation neutre à revenir.
function NextEventCard({ event }: { event?: PublicEvent }) {
  if(!event) return <div className="next-card empty-next"><CalendarDays size={22} aria-hidden="true"/><div><b>Prochaines soirées bientôt annoncées</b><span>Créez votre compte pour être prévenu.</span></div></div>;
  const price=event.priceTiers.length>0?`dès ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:event.priceCents===0?"Gratuit":money(event.priceCents);
  return <Link to={`/events/${event.slug}`} className="next-card">
    <img src={imgUrl(event.imageUrl)} alt="" width={96} height={96}/>
    <div><span className="next-label">Prochaine soirée</span><b>{event.title}</b><span><CalendarDays size={15} aria-hidden="true"/>{shortDate(event.startsAt)}</span><span><MapPin size={15} aria-hidden="true"/>{event.district} · {availabilityLabel(event.availability)}</span></div>
    <strong>{price}</strong>
  </Link>;
}

const FAQ: { q: string; a: string }[] = [
  { q: "À qui s’adressent les soirées Nour Meet ?", a: "Aux adultes (18 ans et plus) qui cherchent à rencontrer des personnes partageant leurs valeurs, dans un cadre respectueux : pour une relation sérieuse lors des soirées de rencontre, ou pour élargir son réseau lors des soirées networking." },
  { q: "Pourquoi un entretien avant les soirées de rencontre ?", a: "Pour que chaque participant vienne avec la même intention. L’entretien est court, se fait une seule fois, et vaut pour toutes les soirées de rencontre suivantes. Les soirées networking, elles, sont en inscription directe." },
  { q: "Que se passe-t-il après la soirée ?", a: "Si vous souhaitez revoir quelqu’un, vous lui envoyez une demande depuis votre espace. L’échange ne s’ouvre que si la personne accepte : personne ne reçoit vos coordonnées sans votre accord." },
  { q: "Puis-je annuler ma place ?", a: "Oui, gratuitement jusqu’à 24 heures avant le début de la soirée : le remboursement est intégral et automatique. Passé ce délai, ou en cas d’absence, la place n’est pas remboursée. Si l’organisateur annule, vous êtes intégralement remboursé." },
  { q: "Qui organise les soirées ?", a: "Des restaurants et établissements partenaires, dont le nom figure sur chaque fiche. Nour Meet gère les inscriptions, la sélection, le paiement et le suivi ; le restaurant accueille la soirée. Il ne reçoit que les informations nécessaires à l’accueil, jamais vos coordonnées complètes ni vos réponses au questionnaire de rencontre." },
  { q: "Comment se passe le paiement ?", a: "En ligne, par carte bancaire, via Stripe. Nour Meet ne conserve jamais vos coordonnées bancaires. Votre place n’est acquise qu’une fois le paiement confirmé ; votre billet avec QR code arrive alors dans votre espace." }
];

export function Home() {
  const [events,setEvents]=useState<PublicEvent[]|null>(null);
  useEffect(()=>{api<Paginated<PublicEvent>>("/events?pageSize=6").then(r=>setEvents(r.items)).catch(()=>setEvents([]))},[]);
  // Organisation, site et FAQ : uniquement des informations visibles sur la page ou dans le pied de page.
  useSeo({title:`${SITE_NAME} — rencontres et soirées en petit comité à Paris`,path:"/",jsonLd:[
    {"@context":"https://schema.org","@type":"Organization",name:SITE_NAME,url:SITE_URL,logo:absoluteUrl("/icon-512.png"),email:"contact@nourmeet.com",areaServed:{"@type":"AdministrativeArea",name:"Île-de-France"}},
    {"@context":"https://schema.org","@type":"WebSite",name:SITE_NAME,url:SITE_URL,inLanguage:"fr-FR"},
    {"@context":"https://schema.org","@type":"FAQPage",mainEntity:FAQ.map(f=>({"@type":"Question",name:f.q,acceptedAnswer:{"@type":"Answer",text:f.a}}))}
  ]});
  return <Layout>
    <section className="home-hero" aria-labelledby="hero-title">
      <div className="home-hero-inner">
        <div className="home-hero-copy">
          <h1 id="hero-title" className="display">Rencontrer quelqu’un de sérieux, autour d’une vraie table.</h1>
          <p className="hero-lead">Nour Meet organise à Paris des soirées en petit comité, dans des restaurants partenaires, entre personnes qui partagent vos valeurs. Speed dating sur sélection, networking en accès direct.</p>
          <div className="hero-actions">
            <Link className="button accent" to="/events">Voir les prochaines soirées<ArrowRight size={18} aria-hidden="true"/></Link>
            <a className="button on-night" href="#comment">Comment ça marche</a>
          </div>
          <ul className="hero-proofs" aria-label="Nos engagements">
            <li><BadgeCheck size={18} aria-hidden="true"/>Profils vérifiés</li>
            <li><MessageCircleHeart size={18} aria-hidden="true"/>Contact seulement si l’intérêt est réciproque</li>
            <li><Undo2 size={18} aria-hidden="true"/>Annulation gratuite jusqu’à 24 h</li>
          </ul>
        </div>
        <div className="home-hero-visual">
          <Picture name="friends-duo" className="hero-photo hero-photo-main" sizes="(max-width: 900px) 92vw, 42vw" priority/>
          <Picture name="paris-terrace" className="hero-photo hero-photo-side" sizes="(max-width: 900px) 40vw, 18vw"/>
          <NextEventCard event={events?.[0]}/>
        </div>
      </div>
    </section>

    <section className="section" aria-labelledby="formats">
      <div className="section-title"><h2 id="formats">Deux façons de venir</h2><p>Choisissez selon ce que vous cherchez. Dans les deux cas : un lieu choisi, une équipe sur place, un groupe à taille humaine.</p></div>
      <div className="format-grid">
        <article className="format-card">
          <Picture name="shared-table" className="format-photo" sizes="(max-width: 768px) 92vw, 45vw"/>
          <div className="format-copy">
            <span className="category-badge" data-category="Speed dating"><Heart size={14} aria-hidden="true"/>Speed dating</span>
            <h3>Des rencontres en vue d’une relation sérieuse</h3>
            <p>Des tête-à-tête courts et animés, puis des temps libres. Chaque participant a été validé lors d’un entretien ; les places sont équilibrées entre femmes et hommes lorsque la soirée le prévoit.</p>
            <Link className="text-link" to="/events?category=Speed%20dating">Voir les soirées de rencontre</Link>
          </div>
        </article>
        <article className="format-card">
          <Picture name="networking-event" className="format-photo" sizes="(max-width: 768px) 92vw, 45vw"/>
          <div className="format-copy">
            <span className="category-badge" data-category="Networking"><Users size={14} aria-hidden="true"/>Networking</span>
            <h3>Élargir son réseau, entre professionnels</h3>
            <p>Entrepreneurs, salariés, indépendants : des soirées pour échanger et trouver des associés, des clients ou des idées. Inscription directe, sans entretien préalable.</p>
            <Link className="text-link" to="/events?category=Networking">Voir les soirées networking</Link>
          </div>
        </article>
      </div>
    </section>

    <section className="section how" id="comment" aria-labelledby="how-title">
      <div className="section-title"><h2 id="how-title">Comment ça marche</h2><p>De l’inscription à l’après-soirée, chaque étape est pensée pour que vous veniez l’esprit tranquille.</p></div>
      <ol className="steps">
        <li><PhoneCall size={22} aria-hidden="true"/><b>Créez votre compte</b><span>Avec votre numéro de téléphone, vérifié par SMS. Complétez votre profil en quelques minutes.</span></li>
        <li><BadgeCheck size={22} aria-hidden="true"/><b>Faites-vous valider</b><span>Pour les rencontres : un court entretien avec l’équipe, une seule fois. Le networking est en accès direct.</span></li>
        <li><Ticket size={22} aria-hidden="true"/><b>Réservez votre place</b><span>Paiement sécurisé. Votre billet avec QR code arrive dans votre espace dès la confirmation.</span></li>
        <li><QrCode size={22} aria-hidden="true"/><b>Venez à la soirée</b><span>L’équipe vous accueille, scanne votre billet et anime la soirée du début à la fin.</span></li>
        <li><Handshake size={22} aria-hidden="true"/><b>Gardez le contact, si vous le voulez tous les deux</b><span>Une demande envoyée depuis votre espace ; la conversation s’ouvre seulement si l’autre accepte.</span></li>
      </ol>
    </section>

    <section className="trust-band" aria-labelledby="trust-title">
      <div className="trust-inner">
        <div className="trust-intro">
          <h2 id="trust-title">Un cadre sérieux, et des règles claires</h2>
          <p>La confiance ne se décrète pas : voici ce qui est réellement en place sur Nour Meet.</p>
          <Picture name="portrait-woman" className="trust-photo" sizes="(max-width: 900px) 60vw, 26vw"/>
        </div>
        <ul className="trust-list">
          <li><ShieldCheck size={24} aria-hidden="true"/><div><b>Des profils vérifiés</b><span>Numéro de téléphone confirmé par SMS, entretien de validation pour les soirées de rencontre, badge « Vérifié » visible sur le profil.</span></div></li>
          <li><Lock size={24} aria-hidden="true"/><div><b>Vos coordonnées restent privées</b><span>Aucun participant ne voit votre numéro. Le restaurant ne reçoit que votre prénom pour l’accueil ; vos réponses au questionnaire de rencontre ne sont jamais partagées.</span></div></li>
          <li><MessageCircleHeart size={24} aria-hidden="true"/><div><b>Le consentement avant tout</b><span>Après la soirée, un échange ne s’ouvre que si les deux personnes l’acceptent. Rien n’est automatique.</span></div></li>
          <li><Flag size={24} aria-hidden="true"/><div><b>Signalement et modération</b><span>Un comportement déplacé se signale à l’équipe, sur place ou à contact@nourmeet.com ; chaque signalement est examiné et peut entraîner la suspension du compte.</span></div></li>
          <li><Users size={24} aria-hidden="true"/><div><b>Réservé aux adultes</b><span>Le service est réservé aux personnes de 18 ans et plus : la date de naissance est demandée à la création du profil et l’inscription est refusée aux mineurs.</span></div></li>
          <li><Undo2 size={24} aria-hidden="true"/><div><b>Paiement sécurisé, annulation simple</b><span>Paiement par Stripe, sans conservation de vos données bancaires. Remboursement intégral jusqu’à 24 h avant la soirée.</span></div></li>
        </ul>
      </div>
    </section>

    <section className="section" aria-labelledby="agenda">
      <div className="section-title row">
        <div><h2 id="agenda">Les prochaines soirées</h2><p>Places limitées à chaque soirée : les inscriptions ferment quand la salle est complète.</p></div>
        <Link className="button secondary" to="/events">Tout le calendrier<ArrowRight size={18} aria-hidden="true"/></Link>
      </div>
      {events===null
        ?<div className="event-grid" aria-busy="true">{[0,1,2].map(i=><div key={i} className="event-card skeleton-card"><div className="skeleton" style={{aspectRatio:"4 / 3"}}/><div className="event-copy"><div className="skeleton" style={{height:18,width:"50%"}}/><div className="skeleton" style={{height:26,width:"85%"}}/><div className="skeleton" style={{height:18,width:"60%"}}/></div></div>)}</div>
        :events.length>0
          ?<div className="event-grid">{events.slice(0,3).map(e=><EventCard key={e.id} event={e}/>)}</div>
          :<div className="empty"><CalendarDays size={24} aria-hidden="true"/><h3>Aucune soirée publiée pour le moment</h3><p>Les prochaines dates arrivent bientôt. Créez votre compte pour être prévenu.</p><Link className="button" to="/login">Créer mon compte</Link></div>}
    </section>

    <section className="section venues" aria-labelledby="lieux">
      <div className="venues-grid">
        <Picture name="bistro-front" className="venues-photo" sizes="(max-width: 900px) 92vw, 40vw"/>
        <div className="venues-copy">
          <h2 id="lieux">Des restaurants partenaires, choisis un par un</h2>
          <p>Chaque soirée se tient dans un établissement parisien partenaire, qui l’accueille et la co-organise. Son nom figure sur la fiche de la soirée avant toute réservation, et vous savez à l’avance ce qui est compris dans le prix.</p>
          <div className="venues-pro">
            <Store size={22} aria-hidden="true"/>
            <div><b>Vous êtes restaurateur ?</b><span>Accueillez des soirées Nour Meet et faites découvrir votre établissement à de nouveaux clients.</span><Link className="text-link" to="/restaurant">Proposer mon établissement</Link></div>
          </div>
        </div>
      </div>
    </section>

    <TestimonialsSection/>

    <section className="section faq" aria-labelledby="faq-title">
      <div className="section-title"><h2 id="faq-title">Questions fréquentes</h2></div>
      <div className="faq-list">{FAQ.map(item=><details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div>
      <p className="faq-more">Une autre question ? Écrivez-nous à <a className="text-link" href="mailto:contact@nourmeet.com">contact@nourmeet.com</a>.</p>
    </section>

    <section className="final-cta" aria-labelledby="final-title">
      <div className="final-cta-inner">
        <h2 id="final-title">Votre place à table vous attend.</h2>
        <p>Créez votre compte en deux minutes, puis choisissez votre première soirée.</p>
        <div className="hero-actions"><Link className="button accent" to="/login">Créer mon compte</Link><Link className="button on-night" to="/events">Voir les soirées</Link></div>
      </div>
    </section>
  </Layout>;
}

export { Concept } from "./Concept";
