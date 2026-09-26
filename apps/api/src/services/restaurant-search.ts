// Autocomplétion des restaurants à l'inscription restaurateur (v3 §6.1) : API « Recherche d'entreprises »
// de l'État (recherche-entreprises.api.gouv.fr) — gratuite, sans clé ni compte (donc aucun secret à
// protéger), fiable pour les établissements français, filtrée sur les codes d'activité de restauration.
// Elle ne fournit ni téléphone ni site web : ces champs restent à saisir. Délai borné, réponse validée
// champ par champ ; en cas de panne, aucune suggestion — le formulaire reste utilisable normalement.

const ENDPOINT = "https://recherche-entreprises.api.gouv.fr/search";
// Restauration traditionnelle, cafétérias, restauration rapide, services de traiteur, débits de boissons.
const RESTAURANT_ACTIVITIES = "56.10A,56.10B,56.10C,56.21Z,56.30Z";

export type RestaurantSuggestion = { name: string; legalName: string; siret: string; address: string; postalCode: string; city: string; district: string; latitude: number | null; longitude: number | null };

type Establishment = { siret?: string; adresse?: string; code_postal?: string; libelle_commune?: string; latitude?: string; longitude?: string; liste_enseignes?: string[] | null; etat_administratif?: string };
type Company = { nom_complet?: string; siege?: Establishment; matching_etablissements?: Establishment[] };

// « Paris 11e » pour un code postal parisien, sinon la commune : le format du champ quartier du site.
const districtOf = (postalCode: string, city: string) => /^750(\d\d)$/.test(postalCode) ? `Paris ${Number(postalCode.slice(3)) === 1 ? "1er" : `${Number(postalCode.slice(3))}e`}` : city;
const titleCase = (text: string) => text.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toUpperCase());
const coordinate = (value?: string) => { const n = Number(value); return value && Number.isFinite(n) ? n : null; };

export async function searchRestaurants(query: string, http: typeof fetch = fetch): Promise<RestaurantSuggestion[]> {
  const url = `${ENDPOINT}?${new URLSearchParams({ q: query, activite_principale: RESTAURANT_ACTIVITIES, etat_administratif: "A", per_page: "8" })}`;
  const response = await http(url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Recherche d’entreprises indisponible (${response.status})`);
  const data = await response.json() as { results?: Company[] };
  const out: RestaurantSuggestion[] = [];
  for (const company of Array.isArray(data.results) ? data.results : []) {
    const establishments = (company.matching_etablissements?.length ? company.matching_etablissements : company.siege ? [company.siege] : []).filter(e => e.etat_administratif !== "F");
    for (const e of establishments) {
      if (typeof e.siret !== "string" || !/^\d{14}$/.test(e.siret) || typeof e.adresse !== "string") continue;
      const legalName = typeof company.nom_complet === "string" ? titleCase(company.nom_complet) : "";
      const brand = Array.isArray(e.liste_enseignes) && typeof e.liste_enseignes[0] === "string" ? titleCase(e.liste_enseignes[0]) : "";
      const postalCode = typeof e.code_postal === "string" ? e.code_postal : "";
      const city = typeof e.libelle_commune === "string" ? titleCase(e.libelle_commune) : "";
      out.push({ name: brand || legalName, legalName, siret: e.siret, address: titleCase(e.adresse), postalCode, city, district: districtOf(postalCode, city), latitude: coordinate(e.latitude), longitude: coordinate(e.longitude) });
      if (out.length >= 8) return out;
    }
  }
  return out;
}
