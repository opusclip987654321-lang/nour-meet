import { Cookie } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OPEN_CONSENT, readConsent, saveConsent } from "../lib/consent";

// Bandeau de consentement (corrections web 2026-09-24, §15) : affiché tant qu'aucun choix valide
// n'existe, « Refuser » aussi simple que « Accepter », personnalisation possible, et réouvrable à
// tout moment depuis le lien « Gérer mes cookies » du pied de page.
export function CookieConsent() {
  const [open, setOpen] = useState(() => readConsent() === null);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(() => readConsent()?.analytics ?? false);
  useEffect(() => {
    const reopen = () => { setAnalytics(readConsent()?.analytics ?? false); setCustom(true); setOpen(true); };
    window.addEventListener(OPEN_CONSENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT, reopen);
  }, []);
  if (!open) return null;
  const decide = (value: boolean) => { saveConsent(value); setOpen(false); setCustom(false); };
  return <div className="consent-banner" role="dialog" aria-modal="false" aria-labelledby="consent-title" data-testid="cookie-consent">
    <div className="consent-inner">
      <div className="consent-copy">
        <h2 id="consent-title"><Cookie size={20} aria-hidden="true" />Votre vie privée</h2>
        <p>Nous utilisons des traceurs strictement nécessaires (connexion, sécurité, paiement). Avec votre accord, nous mesurons aussi l’audience du site de façon anonyme, sur nos propres serveurs, sans publicité ni transmission à un tiers. <Link to="/legal/cookies">Politique cookies</Link></p>
        {custom && <div className="consent-options">
          <label className="consent-option"><input type="checkbox" checked disabled /> <span><b>Strictement nécessaires</b> — toujours actifs : sans eux, le site ne fonctionne pas.</span></label>
          <label className="consent-option"><input type="checkbox" checked={analytics} onChange={e => setAnalytics(e.target.checked)} data-testid="consent-analytics" /> <span><b>Mesure d’audience</b> — pages vues et provenance des visites, avec un identifiant aléatoire conservé dans votre navigateur.</span></label>
        </div>}
      </div>
      <div className="consent-actions">
        {custom
          ? <button type="button" className="button small" onClick={() => decide(analytics)}>Enregistrer mes choix</button>
          : <>
            <button type="button" className="button small secondary" onClick={() => decide(false)}>Tout refuser</button>
            <button type="button" className="button small secondary" onClick={() => setCustom(true)}>Personnaliser</button>
            <button type="button" className="button small" onClick={() => decide(true)}>Tout accepter</button>
          </>}
      </div>
    </div>
  </div>;
}
