import type { Paginated, PublicEvent } from "@nour/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { EventCard } from "../components/ui";
import { dateTime, imgUrl } from "../lib/format";

function TestimonialsSection({ eventType }: { eventType?: string }) {
  const [items,setItems]=useState<any[]>([]);
  useEffect(()=>{api<any[]>(`/testimonials${eventType?`?eventType=${encodeURIComponent(eventType)}`:""}`).then(setItems).catch(()=>{})},[eventType]);
  if(items.length===0) return null;
  return <section className="section"><div className="section-title"><span className="eyebrow">ILS EN PARLENT</span><h2>Des rencontres qui comptent.</h2></div><div className="feature-grid">{items.map(t=><div key={t.id} className="testimonial-card"><div className="testimonial-head"><span className="testimonial-avatar">{t.displayName.slice(0,2).toUpperCase()}</span><div><b>{t.displayName}</b><span className="eyebrow">{t.eventType.toUpperCase()}</span></div></div><blockquote>« {t.text} »</blockquote>{t.rating&&<span className="fine">{"★".repeat(t.rating)}{"☆".repeat(5-t.rating)}</span>}</div>)}</div></section>;
}

export function Home() {
  const [events,setEvents]=useState<PublicEvent[]>([]); useEffect(()=>{api<Paginated<PublicEvent>>("/events").then(r=>setEvents(r.items)).catch(()=>{})},[]);
  return <Layout><section className="hero"><div><span className="eyebrow">PARIS · ÎLE-DE-FRANCE</span><h1>Des rencontres<br/><em>qui comptent.</em></h1><p>Des événements élégants et confidentiels, pensés pour créer de vraies connexions dans un cadre respectueux.</p><div className="hero-actions"><Link className="button" to="/events">Voir les événements</Link><Link className="button secondary" to="/concept">Découvrir le concept</Link></div><div className="trust"><span>✓ Profils sélectionnés</span><span>✓ Lieux premium</span><span>✓ Cadre confidentiel</span></div></div><div className="hero-art"><div className="arch"><span>ن</span></div>{
/* G2 (cahier des charges consolidé 2026-09-20) : jamais de soirée fictive affichée comme réelle —
   si aucun événement n'est publié, un message neutre remplace la carte plutôt qu'un exemple inventé. */
}<div className="next-card">{events[0]?<><img className="next-thumb" src={imgUrl(events[0].imageUrl)} alt=""/><div><small>PROCHAINE SOIRÉE</small><strong>{events[0].title}</strong><span>{dateTime(events[0].startsAt)}</span></div></>:<><div className="avatar">N</div><div><small>PROCHAINE SOIRÉE</small><strong>Revenez bientôt</strong><span>De nouvelles soirées seront bientôt annoncées</span></div></>}</div></div></section><section id="concept" className="section"><div className="section-title"><span className="eyebrow">LE CONCEPT</span><h2>Du réel au numérique, avec votre consentement.</h2></div><div className="feature-grid"><div><b>01</b><h3>Candidature</h3><p>Chaque nouveau membre complète son profil et réserve un court appel.</p></div><div><b>02</b><h3>Rencontre</h3><p>Les événements réunissent 20 à 40 personnes dans un cadre privé.</p></div><div><b>03</b><h3>Contact choisi</h3><p>Un code personnel permet d’envoyer une demande. Le chat s’ouvre après acceptation.</p></div></div><Link to="/concept" className="fine">En savoir plus sur le concept →</Link></section>{events.length>0&&<section className="section"><div className="section-title row"><div><span className="eyebrow">À VENIR</span><h2>Les prochaines rencontres</h2></div><Link to="/events">Tout afficher →</Link></div><div className="event-grid">{events.slice(0,3).map(e=><EventCard key={e.id} event={e}/>)}</div></section>}<TestimonialsSection/></Layout>;
}

export function Concept() {
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
