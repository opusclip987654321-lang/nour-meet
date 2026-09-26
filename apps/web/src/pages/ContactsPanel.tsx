import { ArrowRight, MessageCircle, QrCode, ScanLine, Send, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Picture } from "../components/brand";

// Messagerie sur le site (décision v2 §3, puis v3 §2) : page uniquement explicative. Les échanges réels
// (demandes, conversations) se font dans l'application mobile ; le site présente le parcours — échange
// de QR code en soirée, puis messagerie dans l'application — et affiche le code personnel, utile pendant
// une soirée. Les API de contacts et de conversations restent en place pour l'application.
// L'application n'est pas encore publiée et aucun lien vers sa fiche n'existe : pas de bouton de
// téléchargement, seulement l'information qu'elle arrive.
function MyCode() {
  const [qr, setQr] = useState<{ code: string; qrDataUrl: string } | null>(null);
  useEffect(() => { api<{ code: string; qrDataUrl: string }>("/me/share-qr").then(setQr).catch(() => {}); }, []);
  return <section className="panel contact-code" aria-labelledby="my-code">
    <div className="panel-title"><h2 id="my-code">Mon code personnel</h2><span>À montrer pendant une soirée</span></div>
    <div className="contact-code-body">
      {qr ? <img src={qr.qrDataUrl} alt={`QR code de votre code personnel ${qr.code}`} width={152} height={152}/> : <div className="skeleton skeleton-qr"/>}
      <div>
        <p>Une personne inscrite à la même soirée que vous scanne ce QR code ou saisit votre code dans l’application. Vous recevez alors sa demande, et rien ne s’ouvre sans votre accord.</p>
        {qr && <strong className="contact-code-value">{qr.code}</strong>}
      </div>
    </div>
  </section>;
}

// Parcours en deux temps : ce qui se passe à la soirée, puis ce qui se passe dans l'application.
const AT_EVENT = [
  { icon: QrCode, title: "Échangez vos codes", text: "Pendant la soirée, montrez votre QR code ou dictez votre code." },
  { icon: ScanLine, title: "Retrouvez la personne", text: "Dans l’application, scannez son QR code ou saisissez son code." }
];
const IN_APP = [
  { icon: Send, title: "Envoyez une demande", text: "Elle reçoit votre demande et choisit de l’accepter ou non." },
  { icon: MessageCircle, title: "Discutez", text: "Une fois la demande acceptée, la conversation s’ouvre dans l’application." }
];

const Steps = ({ steps, start }: { steps: typeof AT_EVENT; start: number }) =>
  <ol className="contacts-app-steps">{steps.map((s, i) => <li key={s.title}><span className="mini-step-num" aria-hidden="true">{start + i}</span><s.icon size={20} aria-hidden="true"/><div><b>{s.title}</b><span>{s.text}</span></div></li>)}</ol>;

export function ContactsPanel() {
  return <div className="stack">
    <section className="panel contacts-app" aria-labelledby="contacts-app-title">
      <div className="messaging-hero">
        <Picture name="ai-echange-code" className="messaging-photo" sizes="(max-width: 760px) 92vw, 360px"/>
        <div className="contacts-app-head">
          <Smartphone size={28} aria-hidden="true"/>
          <div>
            <h2 id="contacts-app-title">Les contacts et la messagerie se passent dans l’application</h2>
            <p>Pendant la soirée, vous échangez vos QR codes. Ensuite, demandes de contact, réponses et conversations sont réunies dans l’application mobile Nūr Meet, sans jamais donner votre numéro.</p>
          </div>
        </div>
      </div>
      <div className="messaging-journey">
        <div className="journey-stage"><h3><QrCode size={18} aria-hidden="true"/>Pendant la soirée</h3><Steps steps={AT_EVENT} start={1}/></div>
        <ArrowRight className="journey-arrow" size={22} aria-hidden="true"/>
        <div className="journey-stage"><h3><Smartphone size={18} aria-hidden="true"/>Dans l’application</h3><Steps steps={IN_APP} start={3}/></div>
      </div>
      <p className="contacts-app-store"><b>L’application Nūr Meet arrive bientôt sur l’App Store.</b> Elle n’est pas encore téléchargeable.</p>
    </section>
    <MyCode/>
  </div>;
}
