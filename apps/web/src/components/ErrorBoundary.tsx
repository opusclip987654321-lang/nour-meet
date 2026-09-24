import { RefreshCw } from "lucide-react";
import { Component, ReactNode } from "react";

// Dernier filet : une erreur d'affichage ne laisse plus jamais une page blanche, mais un message et
// un bouton pour recharger la page.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="state-page" role="alert">
      <h1>La page n’a pas pu s’afficher</h1>
      <p>Une nouvelle version du site vient peut-être d’être mise en ligne. Rechargez la page pour continuer.</p>
      <button type="button" className="button" onClick={() => window.location.reload()}><RefreshCw size={18} aria-hidden="true" />Recharger la page</button>
    </main>;
  }
}
