import type { Paginated, PublicEvent } from "@nour/shared";
import { ArrowRight, BadgeCheck, CalendarDays, Check, Flag, Handshake, Heart, Lock, MapPin, MessageCircleHeart, PhoneCall, QrCode, ShieldCheck, Store, Ticket, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Picture } from "../components/brand";
import { ContactExplainer, InterviewExplainer } from "../components/explainers";
import { Layout } from "../components/Layout";
import { EventCard, availabilityLabel, initials } from "../components/ui";
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
      <figcaption className="testimonial-head"><span className="testimonial-avatar" aria-hidden="true">{initials(t.displayName)}</span><div><b>{t.displayName}</b><span>{t.eventType}{t.rating?` · ${t.rating}/5`:""}</span></div></figcaption>
    </figure>)}</div>
  </section>;
}

const shortDate=(value:string)=>new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(value)).replace(":","h");

// Carte « prochaine soirée » du premier écran : un vrai événement publié, jamais un exemple
// inventé (G2) — sans événement, une invitation neutre à revenir.
function NextEventCard({ event }: { event?: PublicEvent }) {
  if(!event) return <div className="next-card empty-next"><CalendarDays size={22} aria-hidden="true"/><div><b>Prochaines soirées bientôt annoncées</b><span>Créez votre compte pour être prévenu(e).</span></div></div>;
  const price=event.priceTiers.length>0?`dès ${money(Math.min(...event.priceTiers.map(t=>t.amountCents)))}`:event.priceCents===0?"Gratuit":money(event.priceCents);
  return <Link to={`/events/${event.slug}`} className="next-card">
    <img src={imgUrl(event.imageUrl)} alt="" width={96} height={96}/>
    <div><span className="next-label">Prochaine soirée</span><b>{event.title}</b><span><CalendarDays size={15} aria-hidden="true"/>{shortDate(event.startsAt)}</span><span><MapPin size={15} aria-hidden="true"/>{event.district} · {availabilityLabel(event.availability)}</span></div>
    <strong>{price}</strong>
  </Link>;
}

const FAQ: { q: string; a: string }[] = [
  { q: "À qui s’adresse Nūr Meet ?", a: "Aux adultes de 18 ans et plus qui veulent rencontrer des personnes partageant leurs valeurs : pour une relation sérieuse (speed dating) ou pour élargir leur réseau (networking)." },
  { q: "Pourquoi un entretien pour le speed dating ?", a: "Pour que chacun vienne avec la même intention. C’est un court appel, une seule fois, valable pour toutes les soirées de rencontre. Le networking est en accès direct." },
  { q: "Et si mon profil n’est pas validé ?", a: "L’entretien sert à vérifier que votre démarche correspond au cadre des soirées. Si ce n’est pas le cas, vous pourrez refaire une demande plus tard." },
  { q: "Comment revoir quelqu’un après la soirée ?", a: "Sur place, échangez vos codes personnels. La personne reçoit votre demande et choisit : la conversation ne s’ouvre que si elle accepte." },
  { q: "Qui voit mes informations ?", a: "Aucun participant ne voit votre numéro ni votre e-mail. Le restaurant ne reçoit que votre prénom pour l’accueil ; vos réponses au questionnaire de rencontre restent privées." },
  { q: "Puis-je annuler ?", a: "Oui : remboursement intégral et automatique jusqu’à 24 heures avant la soirée. Passé ce délai, ou en cas d’absence, la place n’est pas remboursée. Si l’organisateur annule, vous êtes remboursé(e)." },
  { q: "Comment se passe le paiement ?", a: "Par carte, via Stripe : Nūr Meet ne conserve jamais vos données bancaires. Votre billet avec QR code arrive dans votre espace dès la confirmation." }
];

const STEPS = [
  { icon: CalendarDays, title: "Choisissez une soirée", text: "Lieu, prix, ce qui est compris : tout est sur la fiche." },
  { icon: BadgeCheck, title: "Validez votre profil", text: "Speed dating : un court appel, une seule fois.", link: "#entretien", linkLabel: "Comment ça se passe" },
  { icon: Ticket, title: "Réservez", text: "Paiement sécurisé, billet QR dans votre espace." },
  { icon: Users, title: "Venez, rencontrez", text: "L’équipe vous accueille et anime la soirée." },
  { icon: QrCode, title: "Gardez le contact", text: "Échangez vos codes, on se reparle si c’est réciproque.", link: "#garder-contact", linkLabel: "Voir comment" }
];

const TRUST = [
  { icon: PhoneCall, text: "Numéro vérifié pour tous" },
  { icon: BadgeCheck, text: "Entretien pour le speed dating" },
  { icon: Lock, text: "Coordonnées jamais partagées" },
  { icon: Flag, text: "Signalement et modération" },
  { icon: ShieldCheck, text: "Réservé aux 18 ans et plus" },
  { icon: Undo2, text: "Annulation gratuite jusqu’à 24 h" }
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
  // Refonte conversion du 2026-09-25 : la page se lit en diagonale — une promesse, le principe en
  // trois points, les deux formats, le parcours, puis les deux mécanismes qui inquiètent ou
  // intriguent le plus (l'entretien, l'échange de codes), et seulement ensuite le détail.
  return <Layout>
    <section className="home-hero" aria-labelledby="hero-title">
      <div className="home-hero-inner">
        <div className="home-hero-copy">
          <h1 id="hero-title" className="display">Des soirées pour faire de vraies rencontres.</h1>
          <p className="hero-lead">Speed dating et networking en petit comité, dans des restaurants à Paris et en Île-de-France. Des participants vérifiés, qui partagent vos valeurs.</p>
          <div className="hero-actions">
            <Link className="button accent" to="/events">Voir les prochaines soirées<ArrowRight size={18} aria-hidden="true"/></Link>
            <a className="button on-night" href="#comment">Comment ça marche</a>
          </div>
          <ul className="hero-proofs" aria-label="Nos engagements">
            <li><BadgeCheck size={18} aria-hidden="true"/>Participants vérifiés</li>
            <li><MessageCircleHeart size={18} aria-hidden="true"/>Contact seulement si c’est réciproque</li>
            <li><Undo2 size={18} aria-hidden="true"/>Annulation gratuite jusqu’à 24 h</li>
          </ul>
        </div>
        <div className="home-hero-visual">
          <Picture name="ai-soiree" className="hero-photo hero-photo-main" sizes="(max-width: 900px) 92vw, 42vw" priority/>
          <NextEventCard event={events?.[0]}/>
        </div>
      </div>
    </section>

    <section className="section" aria-labelledby="principe">
      <div className="section-title"><h2 id="principe">Le principe, en trois points</h2></div>
      <div className="pillars">
        <div className="pillar"><Store size={26} aria-hidden="true"/><h3>Une vraie table, pas une appli</h3><p>Une soirée en petit comité, dans un restaurant partenaire.</p></div>
        <div className="pillar"><ShieldCheck size={26} aria-hidden="true"/><h3>Des personnes vérifiées</h3><p>Numéro confirmé pour tous, entretien pour les rencontres.</p></div>
        <div className="pillar"><Handshake size={26} aria-hidden="true"/><h3>Vous choisissez qui vous revoyez</h3><p>Rien ne s’ouvre sans votre accord mutuel.</p></div>
      </div>
    </section>

    <section className="section" aria-labelledby="formats">
      <div className="section-title"><h2 id="formats">Deux formats, selon ce que vous cherchez</h2></div>
      <div className="format-grid">
        <article className="format-card">
          <Picture name="ai-tete-a-tete" className="format-photo" sizes="(max-width: 768px) 92vw, 45vw"/>
          <div className="format-copy">
            <span className="category-badge" data-category="Speed dating"><Heart size={14} aria-hidden="true"/>Speed dating</span>
            <h3>Pour une relation sérieuse</h3>
            <ul className="format-points">
              <li><Check size={18} aria-hidden="true"/>Tête-à-tête courts, puis échanges libres</li>
              <li><Check size={18} aria-hidden="true"/>Sur sélection : un entretien, une seule fois</li>
              <li><Check size={18} aria-hidden="true"/>Places équilibrées femmes / hommes quand la soirée le prévoit</li>
            </ul>
            <Link className="button secondary" to="/events?category=Speed%20dating">Voir les soirées de rencontre</Link>
          </div>
        </article>
        <article className="format-card">
          <Picture name="ai-networking" className="format-photo" sizes="(max-width: 768px) 92vw, 45vw"/>
          <div className="format-copy">
            <span className="category-badge" data-category="Networking"><Users size={14} aria-hidden="true"/>Networking</span>
            <h3>Pour élargir votre réseau</h3>
            <ul className="format-points">
              <li><Check size={18} aria-hidden="true"/>Entrepreneurs, salariés, indépendants</li>
              <li><Check size={18} aria-hidden="true"/>Accès direct, sans entretien</li>
              <li><Check size={18} aria-hidden="true"/>Associés, clients, idées : autour d’une table</li>
            </ul>
            <Link className="button secondary" to="/events?category=Networking">Voir les soirées networking</Link>
          </div>
        </article>
      </div>
    </section>

    <section className="section how" id="comment" aria-labelledby="how-title">
      <div className="section-title"><h2 id="how-title">Comment ça marche</h2><p>Cinq étapes, de la réservation à l’après-soirée.</p></div>
      <ol className="steps">{STEPS.map(step=><li key={step.title}><step.icon size={22} aria-hidden="true"/><b>{step.title}</b><span>{step.text}</span>{step.link&&<a className="text-link step-link" href={step.link}>{step.linkLabel}</a>}</li>)}</ol>
    </section>

    <div className="section"><InterviewExplainer/></div>

    <ContactExplainer/>

    <section className="section" aria-labelledby="trust-title">
      <div className="section-title"><h2 id="trust-title">Un cadre sérieux, des règles claires</h2></div>
      <ul className="trust-tiles">{TRUST.map(t=><li key={t.text}><t.icon size={22} aria-hidden="true"/><span>{t.text}</span></li>)}</ul>
    </section>

    <section className="section" aria-labelledby="agenda">
      <div className="section-title row">
        <div><h2 id="agenda">Les prochaines soirées</h2><p>Places limitées. Soirée complète ? La liste d’attente prend le relais.</p></div>
        <Link className="button secondary" to="/events">Tout le calendrier<ArrowRight size={18} aria-hidden="true"/></Link>
      </div>
      {events===null
        ?<div className="event-grid" aria-busy="true">{[0,1,2].map(i=><div key={i} className="event-card skeleton-card"><div className="skeleton skeleton-media"/><div className="event-copy"><div className="skeleton skeleton-line short"/><div className="skeleton skeleton-line tall"/><div className="skeleton skeleton-line"/></div></div>)}</div>
        :events.length>0
          ?<div className="event-grid">{events.slice(0,3).map(e=><EventCard key={e.id} event={e}/>)}</div>
          :<div className="empty"><CalendarDays size={24} aria-hidden="true"/><h3>Aucune soirée publiée pour le moment</h3><p>Les prochaines dates arrivent bientôt. Créez votre compte pour être prévenu(e).</p><Link className="button" to="/login">Créer mon compte</Link></div>}
    </section>

    <section className="section venues" aria-labelledby="lieux">
      <div className="venues-grid">
        <Picture name="venue-day" className="venues-photo" sizes="(max-width: 900px) 92vw, 40vw"/>
        <div className="venues-copy">
          <h2 id="lieux">Des restaurants partenaires, choisis un par un</h2>
          <p>Le nom du lieu et ce qui est compris dans le prix sont indiqués sur chaque fiche, avant de réserver.</p>
          <div className="venues-pro">
            <Store size={22} aria-hidden="true"/>
            <div><b>Vous êtes restaurateur ?</b><span>Accueillez des soirées et faites découvrir votre établissement.</span><Link className="text-link" to="/restaurant">Proposer mon établissement</Link></div>
          </div>
        </div>
      </div>
    </section>

    <TestimonialsSection/>

    <section className="section faq" aria-labelledby="faq-title">
      <div className="section-title"><h2 id="faq-title">Vos questions</h2></div>
      <div className="faq-list">{FAQ.map(item=><details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div>
      <p className="faq-more">Une autre question ? <a className="text-link" href="mailto:contact@nourmeet.com">contact@nourmeet.com</a></p>
    </section>

    <section className="final-cta" aria-labelledby="final-title">
      <div className="final-cta-inner">
        <h2 id="final-title">Votre prochaine rencontre commence à table.</h2>
        <p>Créez votre compte en deux minutes, sans mot de passe.</p>
        <div className="hero-actions"><Link className="button accent" to="/login">Créer mon compte</Link><Link className="button on-night" to="/events">Voir les soirées</Link></div>
      </div>
    </section>
  </Layout>;
}

export { Concept } from "./Concept";
