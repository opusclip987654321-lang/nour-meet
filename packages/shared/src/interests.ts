// Centres d'intérêt proposés (décision v2 du 2026-09-25, §1.3) : liste fermée, commune au site, à
// l'application et à l'API — aucune saisie libre. Groupée par thème pour l'affichage ; l'API
// n'enregistre que des valeurs de cette liste (12 au maximum).
export const INTEREST_GROUPS: { theme: string; items: string[] }[] = [
  { theme: "Culture", items: ["Cinéma", "Séries", "Théâtre", "Musées", "Expositions", "Histoire", "Littérature", "Lecture", "Poésie", "Philosophie", "Langues étrangères", "Podcasts", "Documentaires"] },
  { theme: "Arts et création", items: ["Art contemporain", "Dessin", "Peinture", "Photographie", "Design", "Architecture", "Calligraphie", "Écriture", "Couture", "Artisanat", "Décoration"] },
  { theme: "Musique", items: ["Musique", "Concerts", "Chant", "Piano", "Guitare", "Musique classique", "Jazz", "Rap"] },
  { theme: "Sport et bien-être", items: ["Sport", "Course à pied", "Football", "Basket", "Tennis", "Padel", "Natation", "Musculation", "Boxe", "Arts martiaux", "Yoga", "Randonnée", "Vélo", "Escalade", "Ski", "Équitation", "Bien-être", "Méditation"] },
  { theme: "Voyages et découvertes", items: ["Voyage", "Road trip", "Nature", "Camping", "Montagne", "Mer", "Patrimoine", "Découverte de nouvelles cultures"] },
  { theme: "Gastronomie", items: ["Gastronomie", "Cuisine", "Pâtisserie", "Cuisine du monde", "Brunchs", "Cafés", "Thé"] },
  { theme: "Vie professionnelle", items: ["Entrepreneuriat", "Startups", "Finance", "Investissement", "Immobilier", "Marketing", "Management", "Leadership", "Droit", "Santé et médecine", "Éducation", "Commerce", "Artisanat d'art"] },
  { theme: "Sciences et technologie", items: ["Technologie", "Intelligence artificielle", "Informatique", "Sciences", "Astronomie", "Jeux vidéo", "Jeux de société", "Échecs", "Automobile"] },
  { theme: "Engagement et société", items: ["Bénévolat", "Associations", "Environnement", "Écologie", "Solidarité", "Actualité", "Débats"] },
  { theme: "Développement personnel", items: ["Développement personnel", "Psychologie", "Parentalité", "Famille", "Mode", "Beauté", "Jardinage", "Animaux", "Shopping"] }
];

export const INTERESTS: string[] = INTEREST_GROUPS.flatMap(g => g.items);
export const MAX_INTERESTS = 12;
const allowed = new Set(INTERESTS);

// Garde uniquement les centres d'intérêt de la liste, sans doublon, dans la limite autorisée.
// Une valeur inconnue (ancienne saisie libre, ancienne version de l'application) est ignorée.
export const normalizeInterests = (values: readonly string[]) =>
  [...new Set(values.map(v => v.trim()).filter(v => allowed.has(v)))].slice(0, MAX_INTERESTS);

// Recherche insensible à la casse et aux accents (« reve » trouve « Rêve »).
export const foldText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
