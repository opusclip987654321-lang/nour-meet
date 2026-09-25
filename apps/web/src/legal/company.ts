// Identité de l'exploitant, utilisée par tous les textes juridiques (./*.md, syntaxe {{societe.xxx}}).
// La société n'est pas encore immatriculée (décision du 2026-09-25) : aucune donnée inventée, chaque
// information dépendant de l'immatriculation porte la mention ci-dessous. Après immatriculation,
// remplacer les valeurs ICI SEULEMENT, puis changer LEGAL_VERSIONS (@nour/shared) pour les textes
// concernés : l'avertissement « société en cours de constitution » disparaît de lui-même.
export const PENDING_REGISTRATION = "Informations à compléter après immatriculation de la société";

export const COMPANY = {
  nom: "Nūr Meet",
  statut: "Société en cours de constitution",
  denomination: PENDING_REGISTRATION,
  forme: PENDING_REGISTRATION,
  capital: PENDING_REGISTRATION,
  siege: PENDING_REGISTRATION,
  siren: PENDING_REGISTRATION,
  siret: PENDING_REGISTRATION,
  rcs: PENDING_REGISTRATION,
  tva: PENDING_REGISTRATION,
  telephone: PENDING_REGISTRATION,
  directeurPublication: PENDING_REGISTRATION,
  mediateur: PENDING_REGISTRATION,
  email: "contact@nourmeet.com",
  site: "nourmeet.com"
} as const;

export const companyPending = Object.values(COMPANY).some(v => v === PENDING_REGISTRATION);

// Remplace {{societe.cle}} par la valeur correspondante ; une clé inconnue reste visible telle quelle
// (jamais une chaîne vide qui masquerait l'oubli).
export const fillCompany = (markdown: string) =>
  markdown.replace(/\{\{societe\.([a-zA-Z]+)\}\}/g, (match, key: string) => (COMPANY as Record<string, string>)[key] ?? match);
