import { ExternalLink, MessageCircle, QrCode, ScanLine, Send, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";

// Mise en relation sur le site (décision v2 §3, 2026-09-25) : la messagerie est réservée à
// l'application mobile. Le site ne propose plus ni recherche de code, ni demandes, ni conversations :
// il explique le fonctionnement et affiche le code personnel (QR code compris), toujours utile pendant
// une soirée. Les API de contacts et de conversations restent en place pour l'application.
// L'application n'est pas encore publiée : aucun lien vers une fiche Nūr Meet inexistante, seulement
// la page générale de l'App Store, avec un libellé qui ne laisse pas croire à une disponibilité.
const APP_STORE_URL = "https://www.apple.com/fr/app-store/";

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

const STEPS = [
  { icon: QrCode, title: "Échangez vos codes", text: "Pendant la soirée, montrez votre QR code ou dictez votre code." },
  { icon: ScanLine, title: "Retrouvez la personne", text: "Dans l’application, scannez son QR code ou saisissez son code." },
  { icon: Send, title: "Envoyez une demande", text: "Elle reçoit votre demande et choisit de l’accepter ou non." },
  { icon: MessageCircle, title: "Discutez", text: "Une fois la demande acceptée, la conversation s’ouvre dans l’application." }
];

export function ContactsPanel() {
  return <div className="stack">
    <section className="panel contacts-app" aria-labelledby="contacts-app-title">
      <div className="contacts-app-head">
        <Smartphone size={28} aria-hidden="true"/>
        <div>
          <h2 id="contacts-app-title">Les contacts et la messagerie se passent dans l’application</h2>
          <p>Demandes de contact, réponses et conversations sont réunies dans l’application mobile Nūr Meet, pour échanger simplement après une soirée.</p>
        </div>
      </div>
      <ol className="contacts-app-steps">{STEPS.map((s, i) => <li key={s.title}><span className="mini-step-num" aria-hidden="true">{i + 1}</span><s.icon size={20} aria-hidden="true"/><div><b>{s.title}</b><span>{s.text}</span></div></li>)}</ol>
      <div className="contacts-app-store">
        <p><b>L’application Nūr Meet arrive bientôt sur l’App Store.</b> Elle n’est pas encore téléchargeable.</p>
        <a className="button secondary" href={APP_STORE_URL} target="_blank" rel="noreferrer">Découvrir l’App Store<ExternalLink size={16} aria-hidden="true"/></a>
      </div>
    </section>
    <MyCode/>
  </div>;
}
