import { BadgeCheck, CalendarClock, CheckCircle2, MessageCircle, PenLine, PhoneCall, QrCode, ScanLine, Send, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Picture } from "./brand";

// Blocs pédagogiques partagés par l'accueil et « Comment ça marche » (refonte conversion du
// 2026-09-25) : chaque étape décrit un mécanisme réel du produit — demande d'entretien avec quelques
// mots de motivation, choix d'un créneau dans l'agenda, appel de l'équipe, badge Vérifié ; code
// personnel et QR code dans l'espace, scan dans l'application ou saisie sur le site, demande que la
// personne accepte ou non, conversation sans échange de numéros.

const INTERVIEW_STEPS = [
  { icon: PenLine, title: "Vous faites la demande", text: "Depuis votre espace, en quelques mots." },
  { icon: CalendarClock, title: "Vous choisissez un créneau", text: "Dans l’agenda, quand ça vous arrange." },
  { icon: PhoneCall, title: "L’équipe vous appelle", text: "Un court échange, bienveillant." },
  { icon: BadgeCheck, title: "Profil validé", text: "Badge Vérifié, pour toutes les soirées de rencontre." }
];

export function InterviewExplainer({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Title = headingLevel === 2 ? "h2" : "h3";
  return <section className="explainer" id="entretien" aria-labelledby="entretien-title">
    <div className="explainer-media">
      <Picture name="ai-entretien" className="explainer-photo" sizes="(max-width: 900px) 92vw, 44vw"/>
    </div>
    <div className="explainer-copy">
      <Title id="entretien-title">L’entretien de validation, en clair</Title>
      <p className="explainer-lead">Un simple appel, une seule fois, avant votre première soirée de rencontre. Ce n’est pas un examen : c’est une prise de contact.</p>
      <ol className="mini-steps">{INTERVIEW_STEPS.map((s, i) => <li key={s.title}><span className="mini-step-num" aria-hidden="true">{i + 1}</span><s.icon size={20} aria-hidden="true"/><div><b>{s.title}</b><span>{s.text}</span></div></li>)}</ol>
      <div className="why-grid" aria-label="À quoi sert l’entretien">
        <div><UserCheck size={20} aria-hidden="true"/><span>Tout le monde vient avec la même intention</span></div>
        <div><ShieldCheck size={20} aria-hidden="true"/><span>Des soirées plus sûres</span></div>
        <div><Sparkles size={20} aria-hidden="true"/><span>Des rencontres mieux préparées</span></div>
      </div>
      <p className="explainer-note">Uniquement pour le speed dating. Le networking est en accès direct.</p>
    </div>
  </section>;
}

// Maquette d'écran (HTML, pas une image) : le code montré est un exemple au format réel des codes.
function CodeCard() {
  return <div className="code-card" aria-hidden="true">
    <span className="code-card-title">Mon code personnel</span>
    <QrCode size={96} strokeWidth={1.25}/>
    <b>NOUR-3F9A-C21B-07E4</b>
    <span className="code-card-sent"><Send size={14}/>Demande envoyée</span>
  </div>;
}

const CONTACT_STEPS = [
  { icon: QrCode, title: "Montrez votre QR code", text: "Chaque participant a son code personnel, networking compris." },
  { icon: ScanLine, title: "L’autre le scanne ou le saisit", text: "Dans l’application mobile Nūr Meet." },
  { icon: Send, title: "Une demande vous arrive", text: "Vous voyez qui vous écrit, et vous décidez." },
  { icon: MessageCircle, title: "Vous acceptez : on se reparle", text: "La conversation s’ouvre, sans échanger vos numéros." }
];

export function ContactExplainer({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Title = headingLevel === 2 ? "h2" : "h3";
  return <section className="contact-band" id="garder-contact" aria-labelledby="contact-title">
    <div className="contact-inner">
      <div className="contact-head">
        <Title id="contact-title">Sur place, échangez vos codes. Ensuite, c’est vous qui décidez.</Title>
        <p>Entre personnes inscrites à la même soirée. Pas de numéro à donner : si l’intérêt est réciproque, vous vous retrouvez sur Nūr Meet.</p>
      </div>
      <div className="contact-visual">
        <Picture name="ai-echange-code" className="contact-photo" sizes="(max-width: 900px) 92vw, 50vw"/>
        <CodeCard/>
      </div>
      <ol className="contact-steps">{CONTACT_STEPS.map((s, i) => <li key={s.title}><span className="mini-step-num" aria-hidden="true">{i + 1}</span><s.icon size={22} aria-hidden="true"/><b>{s.title}</b><span>{s.text}</span></li>)}</ol>
      <div className="after-row">
        <Picture name="ai-apres-soiree" className="after-photo" sizes="(max-width: 900px) 92vw, 32vw"/>
        <div>
          <h3>Le lendemain, la conversation continue</h3>
          <ul className="check-list">
            <li><CheckCircle2 size={20} aria-hidden="true"/><span>Demandes et conversations se retrouvent dans l’application mobile.</span></li>
            <li><CheckCircle2 size={20} aria-hidden="true"/><span>Votre numéro et votre e-mail ne sont jamais montrés.</span></li>
            <li><CheckCircle2 size={20} aria-hidden="true"/><span>Sans accord, rien ne s’ouvre, et aucune relance n’est possible.</span></li>
          </ul>
          <Link className="button accent" to="/events">Trouver ma soirée</Link>
        </div>
      </div>
    </div>
  </section>;
}
