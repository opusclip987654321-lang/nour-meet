import { ArrowRight, BadgeCheck, Check, Heart, PlayCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Picture } from "../components/brand";
import { Layout } from "../components/Layout";
import { breadcrumbJsonLd, useSeo } from "../lib/seo";

// Page « Comment ça marche » : le parcours réel de chaque format, étape par étape. Chaque phrase
// décrit un mécanisme existant dans le produit (sélection, paiement, billet, mise en relation).
export function Concept() {
  const [video,setVideo]=useState<{url:string;thumbnail:string;subtitles:string}|null>(null);
  // Les réglages vidéo sont publics par nature (contenu éditorial), mais /admin/settings est
  // réservé à l'administration : on lit les trois clés utiles depuis une petite route publique dédiée.
  useSeo({title:"Comment ça marche : speed dating sur sélection et networking",description:"Le parcours réel d’une soirée Nūr Meet : choix de la soirée, entretien pour les rencontres, paiement sécurisé, billet QR et mise en relation seulement si l’intérêt est réciproque.",path:"/concept",jsonLd:breadcrumbJsonLd([{name:"Accueil",path:"/"},{name:"Comment ça marche",path:"/concept"}])});
  useEffect(()=>{api<{url:string;thumbnail:string;subtitles:string}>("/concept-video").then(setVideo).catch(()=>{})},[]);
  return <Layout>
    <section className="page concept-intro">
      <div className="concept-intro-copy">
        <h1>Comment fonctionne Nūr Meet</h1>
        <p className="page-lead">Des soirées en petit comité, dans des restaurants partenaires à Paris. Vous choisissez une soirée, vous réservez votre place, l’équipe s’occupe du reste — et après, c’est vous qui décidez qui vous revoyez.</p>
        <div className="hero-actions"><Link className="button" to="/events">Voir les prochaines soirées<ArrowRight size={18} aria-hidden="true"/></Link><Link className="button secondary" to="/login">Créer mon compte</Link></div>
      </div>
      {video?.url
        ?<video controls poster={video.thumbnail||undefined} className="concept-video" preload="metadata"><source src={video.url}/>{video.subtitles&&<track kind="subtitles" src={video.subtitles} srcLang="fr" label="Français" default/>}Votre navigateur ne lit pas cette vidéo : le résumé écrit figure ci-dessous.</video>
        :<figure className="concept-visual"><Picture name="tea-hands" sizes="(max-width: 900px) 92vw, 40vw"/><figcaption><PlayCircle size={18} aria-hidden="true"/>La vidéo de présentation arrive bientôt. En attendant, tout est expliqué ci-dessous.</figcaption></figure>}
    </section>

    <section className="section" aria-labelledby="deux-formats">
      <div className="section-title"><h2 id="deux-formats">Deux formats, deux parcours</h2></div>
      <div className="flow-compare">
        <article className="flow-card">
          <span className="category-badge" data-category="Speed dating"><Heart size={14} aria-hidden="true"/>Speed dating</span>
          <h3>Pour une rencontre sérieuse</h3>
          <ol className="steps compact">
            <li><b>Profil et questionnaire</b><span>Vous complétez votre profil, puis un questionnaire privé sur ce que vous recherchez. Il n’est jamais transmis au restaurant ni aux autres participants.</span></li>
            <li><b>Entretien de validation</b><span>Un court appel avec l’équipe, une seule fois : il vaut pour toutes les soirées de rencontre suivantes.</span></li>
            <li><b>Réservation</b><span>Une fois validé, vous réservez votre place. Lorsque la soirée le prévoit, les places sont réparties entre femmes et hommes.</span></li>
            <li><b>La soirée</b><span>Des tête-à-tête courts et animés, puis des temps libres, avec l’équipe présente du début à la fin.</span></li>
          </ol>
        </article>
        <article className="flow-card">
          <span className="category-badge" data-category="Networking"><Users size={14} aria-hidden="true"/>Networking</span>
          <h3>Pour élargir son réseau</h3>
          <ol className="steps compact">
            <li><b>Inscription directe</b><span>Aucun entretien : vous réservez votre place dès votre compte créé.</span></li>
            <li><b>Questionnaire facultatif</b><span>Après confirmation, vous pouvez indiquer votre secteur et ce que vous cherchez, pour aider l’organisateur à préparer la soirée.</span></li>
            <li><b>La soirée</b><span>Des échanges entre professionnels — entrepreneurs, salariés, indépendants — dans un cadre convivial.</span></li>
          </ol>
        </article>
      </div>
    </section>

    <section className="section concept-split" aria-labelledby="reservation">
      <Picture name="venue-evening" className="split-photo" sizes="(max-width: 900px) 92vw, 45vw"/>
      <div>
        <h2 id="reservation">Réserver, payer, venir</h2>
        <ul className="check-list">
          <li><Check size={20} aria-hidden="true"/><span>Le prix affiché est le prix final, toutes taxes comprises ; ce qui est compris (boisson, entrée, plat, dessert) figure sur chaque fiche.</span></li>
          <li><Check size={20} aria-hidden="true"/><span>Le paiement se fait par carte, via Stripe. Votre place n’est acquise qu’une fois le paiement confirmé.</span></li>
          <li><Check size={20} aria-hidden="true"/><span>Votre billet, avec son QR code personnel et l’adresse exacte, arrive aussitôt dans votre espace.</span></li>
          <li><Check size={20} aria-hidden="true"/><span>Annulation gratuite jusqu’à 24 heures avant la soirée, avec remboursement intégral et automatique.</span></li>
          <li><Check size={20} aria-hidden="true"/><span>Soirée complète ? Rejoignez la liste d’attente : une place qui se libère vous est proposée, ainsi qu’une soirée comparable si elle existe.</span></li>
        </ul>
      </div>
    </section>

    <section className="section concept-split reverse" aria-labelledby="apres">
      <Picture name="portrait-man" className="split-photo" sizes="(max-width: 900px) 92vw, 40vw"/>
      <div>
        <h2 id="apres">Après la soirée, c’est vous qui décidez</h2>
        <p className="page-lead">Chaque participant dispose d’un code personnel. Si vous souhaitez revoir quelqu’un, vous lui envoyez une demande depuis votre espace : la conversation ne s’ouvre que si la personne accepte.</p>
        <ul className="check-list">
          <li><BadgeCheck size={20} aria-hidden="true"/><span>Personne ne voit votre numéro de téléphone ni votre e-mail.</span></li>
          <li><BadgeCheck size={20} aria-hidden="true"/><span>Une demande refusée reste sans suite : aucune relance possible.</span></li>
          <li><BadgeCheck size={20} aria-hidden="true"/><span>Vous pouvez supprimer votre compte à tout moment depuis votre espace.</span></li>
        </ul>
      </div>
    </section>

    <section className="final-cta" aria-labelledby="concept-cta">
      <div className="final-cta-inner">
        <h2 id="concept-cta">Prêt pour votre première soirée ?</h2>
        <p>Consultez le calendrier : chaque fiche indique le lieu, l’organisateur, le prix et le format.</p>
        <div className="hero-actions"><Link className="button accent" to="/events">Voir les soirées</Link></div>
      </div>
    </section>
  </Layout>;
}
