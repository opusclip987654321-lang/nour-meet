import { dateTime, imgUrl, money } from "../lib/format";

// Soirée proposée à une personne en liste d'attente (v2 §10) : même carte dans l'espace personnel et
// sur la fiche de la soirée complète — petite photo (image par défaut de la catégorie si besoin, fournie
// par l'API), titre, date, quartier, prix, puis la décision.
export function AltOfferCard({ offer, busy, onRespond }: { offer: any; busy: boolean; onRespond: (accept: boolean) => void }) {
  const e = offer.alternativeEvent;
  return <article className="alt-offer">
    <img className="alt-offer-photo" src={imgUrl(e.imageUrl)} alt="" width={72} height={72} loading="lazy" />
    <div className="alt-offer-body">
      <h3>{e.title}</h3>
      <p>{dateTime(e.startsAt)} · {e.district}</p>
      <p><b>{e.priceCents === 0 ? "Gratuit" : money(e.priceCents)}</b></p>
    </div>
    <div className="decision-buttons">
      <button type="button" className="button" disabled={busy} onClick={() => onRespond(true)}>Accepter</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => onRespond(false)}>Refuser</button>
    </div>
  </article>;
}
