import { ArrowRight, Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useSeo } from "../lib/seo";

// Page 404 (corrections web 2026-09-24, §9) : toute route inconnue, et toute ressource introuvable
// (soirée, article), aboutit ici plutôt qu'à une redirection silencieuse vers l'accueil. Jamais indexée.
export function NotFound({ title = "Cette page n’existe pas", message = "Le lien que vous avez suivi est peut-être ancien, ou l’adresse contient une faute de frappe." }: { title?: string; message?: string }) {
  useSeo({ title: "Page introuvable", description: message, noindex: true });
  return <Layout>
    <section className="page not-found" aria-labelledby="not-found-title">
      <span className="not-found-icon" aria-hidden="true"><Compass size={32} /></span>
      <p className="not-found-code">Erreur 404</p>
      <h1 id="not-found-title">{title}</h1>
      <p className="page-lead">{message}</p>
      <div className="not-found-actions">
        <Link className="button" to="/">Retour à l’accueil</Link>
        <Link className="button secondary" to="/events">Voir les prochaines soirées<ArrowRight size={18} aria-hidden="true" /></Link>
      </div>
    </section>
  </Layout>;
}
