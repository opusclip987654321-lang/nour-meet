import { useEffect, useRef, useState } from "react";

// Bouton « Continuer avec Google » (Google Identity Services) : script Google chargé uniquement sur
// les pages de connexion, et seulement si la connexion Google est configurée (VITE_GOOGLE_CLIENT_ID).
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
type GoogleId = { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };

export function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const render = () => {
      const google = (window as unknown as { google?: GoogleId }).google;
      if (!google || !ref.current) return;
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r: { credential: string }) => onCredential(r.credential), ux_mode: "popup" });
      google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: Math.min(ref.current.offsetWidth || 360, 400), locale: "fr" });
    };
    if ((window as unknown as { google?: GoogleId }).google) { render(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.onload = render; script.onerror = () => setFailed(true);
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rendu une seule fois
  }, []);
  if (!GOOGLE_CLIENT_ID) return null;
  return failed ? <p className="fine">Connexion Google momentanément indisponible : utilisez votre e-mail.</p> : <div ref={ref} className="google-button" data-testid="google-button" />;
}
