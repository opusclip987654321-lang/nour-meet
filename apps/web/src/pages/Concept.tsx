import { ArrowRight, CreditCard, Heart, ListOrdered, Receipt, Ticket, Trash2, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Picture } from "../components/brand";
import { ContactExplainer, InterviewExplainer } from "../components/explainers";
import { Layout } from "../components/Layout";
import { ShareSiteButton } from "../components/ShareSite";
import { useAuth } from "../auth";
import { breadcrumbJsonLd, useSeo } from "../lib/seo";

// Page « Comment ça marche » : le parcours réel de chaque format, étape par étape. Chaque phrase
// décrit un mécanisme existant dans le produit (sélection, paiement, billet, mise en relation) ;
// refonte du 2026-09-25 : phrases courtes, lisibles en diagonale, mêmes blocs que l'accueil.
export function Concept() {
  const {user}=useAuth();
  const [video,setVideo]=useState<{url:string;thumbnail:string;subtitles:string}|null>(null);
  // Les réglages vidéo sont publics par nature (contenu éditorial), mais /admin/settings est
  // réservé à l'administration : on lit les trois clés utiles depuis une petite route publique dédiée.
  useSeo({title:"Comment ça marche : speed dating sur sélection et networking",description:"Le parcours réel d’une soirée Nūr Meet : choix de la soirée, entretien pour les rencontres, paiement sécurisé, billet QR et mise en relation seulement si l’intérêt est réciproque.",path:"/concept",jsonLd:breadcrumbJsonLd([{name:"Accueil",path:"/"},{name:"Comment ça marche",path:"/concept"}])});
  useEffect(()=>{api<{url:string;thumbnail:string;subtitles:string}>("/concept-video").then(setVideo).catch(()=>{})},[]);
  return <Layout>
    <section className="page concept-intro">
      <div className="concept-intro-copy">
        <h1>Comment fonctionne Nūr Meet</h1>
        <p className="page-lead">Vous choisissez une soirée, vous réservez, vous venez. Après, c’est vous qui décidez qui vous revoyez.</p>
        <div className="hero-actions"><Link className="button" to="/events">Voir les prochaines soirées<ArrowRight size={18} aria-hidden="true"/></Link>{user?<ShareSiteButton/>:<Link className="button secondary" to="/login">Créer mon compte</Link>}</div>
      </div>
      {video?.url
        ?<video controls poster={video.thumbnail||undefined} className="concept-video" preload="metadata"><source src={video.url}/>{video.subtitles&&<track kind="subtitles" src={video.subtitles} srcLang="fr" label="Français" default/>}Votre navigateur ne lit pas cette vidéo : le résumé écrit figure ci-dessous.</video>
        :<Picture name="ai-soiree" className="concept-visual" sizes="(max-width: 900px) 92vw, 40vw"/>}
    </section>

    <section className="section" aria-labelledby="deux-formats">
      <div className="section-title"><h2 id="deux-formats">Deux formats, deux parcours</h2></div>
      <div className="flow-compare">
        <article className="flow-card">
          <span className="category-badge" data-category="Speed dating"><Heart size={14} aria-hidden="true"/>Speed dating</span>
          <h3>Pour une relation sérieuse</h3>
          <ol className="steps compact">
            <li><b>Entretien de validation</b><span>Un court appel, une seule fois.</span></li>
            <li><b>Questionnaire privé</b><span>Ce que vous recherchez. Jamais partagé.</span></li>
            <li><b>Réservation</b><span>Paiement, puis billet QR.</span></li>
            <li><b>La soirée</b><span>Tête-à-tête courts, puis échanges libres.</span></li>
          </ol>
        </article>
        <article className="flow-card">
          <span className="category-badge" data-category="Networking"><Users size={14} aria-hidden="true"/>Networking</span>
          <h3>Pour élargir votre réseau</h3>
          <ol className="steps compact">
            <li><b>Inscription directe</b><span>Aucun entretien.</span></li>
            <li><b>Réservation</b><span>Paiement, puis billet QR.</span></li>
            <li><b>La soirée</b><span>Des échanges entre professionnels, autour d’une table.</span></li>
          </ol>
        </article>
      </div>
    </section>

    <div className="section"><InterviewExplainer/></div>

    <ContactExplainer/>

    <section className="section" aria-labelledby="reservation">
      <div className="section-title"><h2 id="reservation">Réserver, payer, venir</h2></div>
      <ul className="trust-tiles">
        <li><Receipt size={22} aria-hidden="true"/><span>Prix final affiché, TTC, avec ce qui est compris</span></li>
        <li><CreditCard size={22} aria-hidden="true"/><span>Paiement par carte via Stripe</span></li>
        <li><Ticket size={22} aria-hidden="true"/><span>Billet QR et adresse exacte dans votre espace</span></li>
        <li><Undo2 size={22} aria-hidden="true"/><span>Annulation gratuite jusqu’à 24 h, remboursement automatique</span></li>
        <li><ListOrdered size={22} aria-hidden="true"/><span>Soirée complète ? Liste d’attente, et une soirée comparable si elle existe</span></li>
        <li><Trash2 size={22} aria-hidden="true"/><span>Compte supprimable à tout moment</span></li>
      </ul>
    </section>

    <section className="final-cta" aria-labelledby="concept-cta">
      <div className="final-cta-inner">
        <h2 id="concept-cta">Prêt pour votre première soirée ?</h2>
        <p>Lieu, organisateur, prix et format : tout est sur chaque fiche.</p>
        <div className="hero-actions"><Link className="button accent" to="/events">Voir les soirées</Link></div>
      </div>
    </section>
  </Layout>;
}
