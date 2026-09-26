// Variété des illustrations générées (retour du 2026-09-26 : « un peu trop souvent les mêmes images »).
// Laissé libre, le générateur retombe toujours sur la même scène — terrasse de café, thé à la menthe,
// soirée. Chaque image reçoit donc un décor, un cadrage et une lumière imposés, tirés en rotation :
// tous différents au sein d'une journée (couverture + slides du carrousel), et décalés d'un jour à
// l'autre. Décors urbains français uniquement, jamais un lieu religieux (charte visuelle).

const SETTINGS = [
  "a lively Parisian street market between the stalls",
  "a public garden in Paris, on a bench under the trees",
  "the banks of the Seine or the Canal Saint-Martin",
  "a neighbourhood bookshop with a small reading corner",
  "a bright modern coworking space",
  "a cosy apartment kitchen, cooking together",
  "a museum or art gallery hall",
  "a metro or tram platform in the city",
  "a bakery counter early in the morning",
  "a rooftop overlooking the zinc roofs of Paris",
  "a small neighbourhood restaurant dining room",
  "a creative workshop (pottery, painting or cooking class)",
  "a running or cycling path along the water",
  "a Haussmann-style street with shop fronts",
  "a lively concert hall or cultural centre foyer"
];
const SHOTS = [
  "close-up on hands and gestures, faces out of frame or softly blurred",
  "wide shot with the city around the people",
  "over-the-shoulder shot",
  "medium shot of two people side by side, seen in three-quarter view",
  "candid group scene seen from a little distance",
  "detail of an object in the foreground, people softly blurred behind"
];
const LIGHTS = ["soft morning light", "golden hour sunlight", "blue hour with city lights", "bright overcast daylight", "warm indoor lamp light"];
const PEOPLE = [
  "people in their late twenties",
  "people in their thirties and forties",
  "a mix of ages between 25 and 50",
  "a man alone, thoughtful",
  "a woman alone, confident",
  "friends of mixed genders"
];

// Pas de 8 (couverture + 6 slides + appel à l'action) sur 15 décors, premiers entre eux : 8 décors
// différents dans la journée, au plus un en commun avec la veille, même série seulement après 15 jours.
const STRIDE = 8;

/** Jour (numéro depuis 1970) servant de graine : les consignes changent chaque jour. */
export const varietySeed = (now: Date) => Math.floor(now.getTime() / 86_400_000);

/** Consigne visuelle n°index du jour : décor, cadrage, lumière et personnes, en anglais. */
export function visualBrief(seed: number, index: number): string {
  const n = seed * STRIDE + index;
  return `Setting: ${SETTINGS[n % SETTINGS.length]}. Framing: ${SHOTS[n % SHOTS.length]}. Light: ${LIGHTS[n % LIGHTS.length]}. People: ${PEOPLE[(seed + index) % PEOPLE.length]}.`;
}

/** Consignes distinctes pour `count` images, à partir de la n°`from` du jour. */
export const visualBriefs = (seed: number, from: number, count: number) => Array.from({ length: count }, (_, i) => visualBrief(seed, from + i));
