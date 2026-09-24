import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_URL } from "../api";
import { BrandMark } from "../components/brand";
import { GOOGLE_CLIENT_ID, GoogleButton } from "../components/GoogleButton";
import { Notice } from "../components/ui";
import { useSeo } from "../lib/seo";

// Connexion Google pour l'application mobile (2026-09-24) : ouverte dans le navigateur intégré de
// l'application, elle connecte l'utilisateur avec Google puis le renvoie vers l'application avec un code
// à usage unique (2 minutes) — jamais le jeton de session dans l'URL. Le serveur n'accepte le retour que
// vers le schéma de l'application (voir POST /auth/mobile-handoff).
export function MobileAuth() {
  useSeo({ title: "Connexion à l’application", noindex: true });
  const [params] = useSearchParams();
  const redirect = params.get("redirect") ?? "";
  const challenge = params.get("challenge") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const post = async <T,>(path: string, body: unknown, token?: string): Promise<T> => {
    const response = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Une erreur est survenue");
    return data as T;
  };
  const onCredential = async (credential: string) => {
    setBusy(true); setError("");
    try {
      const login = await post<{ token: string; isNewUser: boolean }>("/auth/google", { credential });
      const { redirectUrl } = await post<{ redirectUrl: string }>("/auth/mobile-handoff", { redirect, challenge, isNewUser: login.isNewUser }, login.token);
      window.location.href = redirectUrl;
    } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return <main className="mobile-auth">
    <BrandMark size={48} />
    <h1>Connexion à l’application Nūr Meet</h1>
    <p>Continuez avec votre compte Google : vous serez ensuite renvoyé(e) automatiquement dans l’application.</p>
    {(!redirect || !challenge) && <Notice kind="error">Lien incomplet : relancez la connexion depuis l’application.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
    {redirect && challenge && !busy && <GoogleButton onCredential={onCredential} />}
    {busy && <p className="fine">Connexion en cours…</p>}
    {!GOOGLE_CLIENT_ID && <Notice kind="info">La connexion Google n’est pas disponible pour le moment : utilisez votre adresse e-mail dans l’application.</Notice>}
  </main>;
}
