import type { BillingPeriod } from "@nour/shared";
import { ArrowRight, BadgeCheck, CalendarPlus, Check, ClipboardCheck, CreditCard, Megaphone, Minus, QrCode, Send, ShieldCheck, Store, UserPlus, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Picture } from "../components/brand";
import { Layout } from "../components/Layout";
import { money } from "../lib/format";
import { Plan, planFeatures, priceFor } from "../lib/plans";
import { breadcrumbJsonLd, useSeo } from "../lib/seo";

// Page publique « Restaurateurs » : un professionnel qui arrive sur le site comprend, sans compte, ce
// que Nūr Meet lui apporte, comment on démarre et combien coûte chaque formule. Tout ce qui est écrit
// ici existe dans le produit ou dans les CGV partie B ; les prix sont ceux de la base (GET /plans),
// jamais recopiés dans le code. La commission sur les billets dépend de chaque offre (CGV B6) : aucun
// taux n'est affiché ici.

const BENEFITS = [
  { icon: Users, title: "De nouveaux clients à votre table", text: "Vos soirées sont présentées aux membres de Nūr Meet, sur le site et l’application." },
  { icon: Megaphone, title: "Votre établissement mis en valeur", text: "Nom, photos et description du lieu sur chaque fiche. Soirées relayées sur nos réseaux." },
  { icon: CreditCard, title: "Des places payées d’avance", text: "Paiement en ligne par carte via Stripe. Vous fixez le prix et ce qui est compris." },
  { icon: ShieldCheck, title: "Des participants vérifiés", text: "Numéro confirmé par SMS pour tous, entretien préalable pour le speed dating." },
  { icon: QrCode, title: "Un accueil simple", text: "Liste des participants, billets QR scannés à l’entrée, comptes pour votre personnel." },
  { icon: Wallet, title: "Aucune gestion des remboursements", text: "Une soirée annulée ? Les participants sont remboursés automatiquement." }
];

const STEPS = [
  { icon: UserPlus, title: "Créez votre compte", text: "Avec votre numéro de téléphone, puis « Je suis restaurateur »." },
  { icon: Send, title: "Présentez votre établissement", text: "Nom, SIRET, description et au moins une photo réelle du lieu." },
  { icon: BadgeCheck, title: "Choisissez votre formule", text: "Paiement par carte, sans engagement de durée." },
  { icon: CalendarPlus, title: "Proposez vos soirées", text: "Date, prix, capacité : l’équipe valide, puis publie." },
  { icon: ClipboardCheck, title: "Accueillez", text: "Vous scannez les billets, la soirée commence." }
];

const FAQ: { q: string; a: string }[] = [
  { q: "Suis-je engagé sur la durée ?", a: "Non. Vous résiliez depuis votre espace quand vous le souhaitez : la résiliation prend effet à la fin de la période déjà payée." },
  { q: "Qui fixe le prix des places ?", a: "Vous. Le prix est affiché TTC aux participants, avec ce qui est compris. L’équipe Nūr Meet peut demander un ajustement avant publication." },
  { q: "Comment suis-je payé pour les places vendues ?", a: "Nūr Meet encaisse les paiements via Stripe. Les sommes qui vous reviennent sont reversées au plus tard 15 jours ouvrés après la soirée. La commission et les frais applicables sont précisés dans votre offre professionnelle." },
  { q: "Et si ma soirée ne se remplit pas ?", a: "Vous pouvez fixer un nombre minimum de participants et une date de décision. À cette date, vous maintenez ou annulez la soirée ; en cas d’annulation, les participants sont remboursés automatiquement." },
  { q: "Mes soirées sont-elles publiées automatiquement ?", a: "Non. Chaque soirée est vérifiée par l’équipe avant publication, pour garantir la qualité de ce qui est proposé aux membres. Elle compte alors dans le nombre de soirées de votre formule." },
  { q: "Que recevez-vous des participants ?", a: "Le prénom de chaque participant pour l’accueil, et son billet à scanner. Leur numéro et leur e-mail ne sont jamais transmis aux restaurants." },
  { q: "Puis-je changer de formule ?", a: "Oui, depuis votre espace. Formule supérieure : immédiat, au prorata. Formule inférieure : à la fin de la période déjà payée." }
];

export function Restaurateurs() {
  const {user}=useAuth();
  const [plans,setPlans]=useState<Plan[]|null>(null);
  const [period,setPeriod]=useState<BillingPeriod>("MONTHLY");
  useEffect(()=>{api<Plan[]>("/plans").then(setPlans).catch(()=>setPlans([]))},[]);
  useSeo({title:"Restaurateurs : accueillez des soirées Nūr Meet",description:"Accueillez des soirées speed dating et networking dans votre restaurant à Paris et en Île-de-France : places payées d’avance, participants vérifiés, formules sans engagement.",path:"/restaurateurs",jsonLd:breadcrumbJsonLd([{name:"Accueil",path:"/"},{name:"Restaurateurs",path:"/restaurateurs"}])});
  // Sans compte : création du compte (le choix « Je suis restaurateur » vient juste après). Déjà
  // connecté : directement l'espace restaurateur, qui affiche la candidature ou l'établissement.
  const start=user?"/restaurant":"/login";
  const startLabel=user?.role==="ORGANIZER"||user?.hasRestaurant?"Mon établissement":"Proposer mon établissement";
  return <Layout>
    <section className="page concept-intro">
      <div className="concept-intro-copy">
        <h1>Remplissez vos soirées avec Nūr Meet</h1>
        <p className="page-lead">Vous accueillez des soirées speed dating ou networking dans votre restaurant. Nūr Meet les présente à ses membres, gère la billetterie et le paiement.</p>
        <div className="hero-actions"><Link className="button" to={start}>{startLabel}<ArrowRight size={18} aria-hidden="true"/></Link><a className="button secondary" href="#tarifs">Voir les tarifs</a></div>
      </div>
      <Picture name="ai-restaurateur" className="concept-visual" sizes="(max-width: 900px) 92vw, 40vw" priority/>
    </section>

    <section className="section" aria-labelledby="avantages">
      <div className="section-title"><h2 id="avantages">Ce que Nūr Meet vous apporte</h2></div>
      <div className="pillars">{BENEFITS.map(b=><div key={b.title} className="pillar"><b.icon size={26} aria-hidden="true"/><h3>{b.title}</h3><p>{b.text}</p></div>)}</div>
    </section>

    <section className="section how" aria-labelledby="demarrer">
      <div className="section-title"><h2 id="demarrer">Comment démarrer</h2><p>Cinq étapes, de l’inscription à votre première soirée.</p></div>
      <ol className="steps">{STEPS.map(s=><li key={s.title}><s.icon size={22} aria-hidden="true"/><b>{s.title}</b><span>{s.text}</span></li>)}</ol>
    </section>

    <section className="section" id="tarifs" aria-labelledby="tarifs-title">
      <div className="pricing-head">
        <div>
          <h2 id="tarifs-title" className="pro-pricing-title">Nos formules</h2>
          <p className="fine left">Prix hors taxes. Sans engagement : résiliable à tout moment depuis votre espace.</p>
        </div>
        <div className="segmented" role="group" aria-label="Périodicité de facturation">
          <button type="button" aria-pressed={period==="MONTHLY"} className={period==="MONTHLY"?"active":undefined} onClick={()=>setPeriod("MONTHLY")}>Mensuel</button>
          <button type="button" aria-pressed={period==="ANNUAL"} className={period==="ANNUAL"?"active":undefined} onClick={()=>setPeriod("ANNUAL")}>Annuel · 2 mois offerts</button>
        </div>
      </div>
      {plans===null
        ?<div className="pricing-grid pro-pricing" aria-busy="true">{[0,1].map(i=><div key={i} className="pricing-card skeleton skeleton-pricing"/>)}</div>
        :plans.length===0
          ?<div className="empty"><Store size={24} aria-hidden="true"/><h3>Tarifs présentés à l’inscription</h3><p>Les formules s’affichent dans votre espace restaurateur dès le dépôt de votre demande.</p></div>
          :<div className="pricing-grid pro-pricing">{plans.map(plan=>{
            const price=priceFor(plan,period);
            const featured=plan.highlightTier==="priority";
            return <article key={plan.id} className={`pricing-card${featured?" featured":""}`} aria-labelledby={`plan-${plan.id}`}>
              <div className="pricing-card-top"><h3 id={`plan-${plan.id}`}>{plan.name}</h3></div>
              <p className="pricing-price">{price==null?<span className="pricing-unavailable">Non disponible en annuel</span>:<><strong>{money(price).replace(",00","")}</strong><span>{period==="ANNUAL"?"HT / an":"HT / mois"}</span></>}</p>
              {period==="ANNUAL"&&price!=null&&<p className="pricing-note">soit {money(Math.round(price/12))} HT par mois</p>}
              <ul className="pricing-features">{planFeatures(plan).map(f=><li key={f.label} className={f.included?undefined:"excluded"}>{f.included?<Check size={18} aria-hidden="true"/>:<Minus size={18} aria-hidden="true"/>}<span>{f.label}{!f.included&&<span className="visually-hidden"> (non inclus)</span>}</span></li>)}</ul>
              <div className="pricing-action"><Link className={`button full${featured?" accent":" secondary"}`} to={start}>{startLabel}</Link></div>
            </article>;
          })}</div>}
      <p className="fine left">La souscription se fait depuis votre espace, après la présentation de votre établissement. Le choix d’une formule ne publie rien automatiquement : chaque soirée est validée par l’équipe. Détail dans les <Link className="text-link" to="/legal/cgv">conditions professionnelles</Link> (partie B).</p>
    </section>

    <section className="section faq" aria-labelledby="pro-faq">
      <div className="section-title"><h2 id="pro-faq">Vos questions</h2></div>
      <div className="faq-list">{FAQ.map(item=><details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div>
      <p className="faq-more">Une autre question ? <a className="text-link" href="mailto:contact@nourmeet.com">contact@nourmeet.com</a></p>
    </section>

    <section className="final-cta" aria-labelledby="pro-cta">
      <div className="final-cta-inner">
        <h2 id="pro-cta">Accueillez votre première soirée.</h2>
        <p>Présentez votre établissement en quelques minutes.</p>
        <div className="hero-actions"><Link className="button accent" to={start}>{startLabel}</Link><Link className="button on-night" to="/events">Voir les soirées en ligne</Link></div>
      </div>
    </section>
  </Layout>;
}
