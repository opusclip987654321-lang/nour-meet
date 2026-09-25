// Cartes de test Stripe (décision v2 §15) : rappel affiché uniquement en développement local
// (`import.meta.env.DEV` vaut false dans tout build de production : ce bloc n'existe pas en ligne).
// Aucune fausse carte ni logique de paiement parallèle : ce sont les cartes officielles du mode test.
const CARDS = [
  ["4242 4242 4242 4242", "Paiement accepté"],
  ["4000 0025 0000 3155", "3-D Secure demandé"],
  ["4000 0000 0000 9995", "Refusée (fonds insuffisants)"]
] as const;

export function DevTestCards() {
  if (!import.meta.env.DEV) return null;
  return <details className="dev-test-cards">
    <summary>Développement : cartes de test Stripe</summary>
    <ul>{CARDS.map(([number, result]) => <li key={number}><code>{number}</code> {result}</li>)}</ul>
    <p>Date future, CVC et code postal quelconques. Voir docs/stripe-test-local.md.</p>
  </details>;
}
