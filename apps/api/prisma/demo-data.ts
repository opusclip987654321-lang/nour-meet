import { EventFlow, EventStatus, PrismaClient, UserRole } from "@prisma/client";

// Données de démonstration du lancement (corrections web 2026-09-24, §8) : quelques restaurants et
// soirées pour que le site ne paraisse pas vide. Présentés exactement comme de vrais restaurants —
// aucune mention « démo » ou « test » dans un texte visible — mais marqués techniquement isDemo=true
// sur User, Restaurant et Event, pour pouvoir tout retrouver et supprimer sans ambiguïté :
//   User.isDemo / Restaurant.isDemo / Event.isDemo = true
// Aucun paiement n'est possible sur un événement isDemo (refus côté API dans
// POST /applications/:id/payment-intent, voir apps/api/src/routes/payments.ts).
//
// Garde-fous : noms d'établissement fictifs, aucune adresse postale précise (seulement le quartier,
// l'adresse d'un événement n'étant de toute façon révélée qu'après réservation), aucun SIRET, et des
// numéros de téléphone pris dans la plage 06 39 98 xx xx que l'ARCEP réserve aux œuvres de fiction.
// Idempotent : rejouer ce script met à jour les mêmes lignes (clé = téléphone ou slug), jamais de doublon.

// Heure murale de Paris, quel que soit le fuseau du serveur (les conteneurs de production sont en
// UTC : sans cette conversion, une soirée prévue à 19h30 s'afficherait à 21h30).
const at = (daysFromNow: number, hours: number, minutes = 0) => {
  const day = new Date(Date.now() + daysFromNow * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const guess = new Date(`${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`);
  const parisHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(guess));
  const offsetHours = (parisHour - guess.getUTCHours() + 24) % 24;
  return new Date(guess.getTime() - offsetHours * 3_600_000);
};

const RESTAURANTS = [
  {
    phone: "+33639980001", owner: "Selma B.", name: "Maison Selma", district: "Paris 11e", zone: "Paris intra-muros",
    description: "Une salle chaleureuse près de la place de la République, cuisine de saison et grandes tables à partager, idéale pour les soirées en petit comité.",
    capacity: 30, schedule: "Jeudi, vendredi et samedi soir"
  },
  {
    phone: "+33639980002", owner: "Kenza M.", name: "Le Salon Kenza", district: "Paris 9e", zone: "Paris intra-muros",
    description: "Un salon de thé et restaurant au cœur du 9e arrondissement : banquettes, lumière douce et un étage privatisable pour les rencontres.",
    capacity: 24, schedule: "Vendredi soir et dimanche après-midi"
  },
  {
    phone: "+33639980003", owner: "Amel K.", name: "Café Amel", district: "Saint-Denis", zone: "Île-de-France (banlieue)",
    description: "Un café-restaurant lumineux à deux pas du métro, apprécié pour ses afterworks entre entrepreneurs et indépendants du nord parisien.",
    capacity: 40, schedule: "Mardi et jeudi en soirée"
  }
] as const;

const EVENTS: { slug: string; restaurant: number; title: string; category: "Speed dating" | "Networking"; description: string; day: number; start: [number, number]; end: [number, number]; priceCents: number; capacity: number; minAge?: number; maxAge?: number; perks: { drink?: boolean; starter?: boolean; main?: boolean; dessert?: boolean; description?: string } }[] = [
  {
    slug: "rencontres-maison-selma-30-40", restaurant: 0, title: "Dîner rencontres 30-40 ans", category: "Speed dating",
    description: "Un dîner assis en petit comité : sept rencontres de huit minutes entre le plat et le dessert, puis un temps libre pour prolonger les échanges. Profils validés en amont par un court entretien.",
    day: 12, start: [19, 30], end: [22, 30], priceCents: 3900, capacity: 20, minAge: 30, maxAge: 40, perks: { drink: true, main: true, dessert: true, description: "Boisson sans alcool, plat et dessert maison." }
  },
  {
    slug: "afterwork-entrepreneurs-maison-selma", restaurant: 0, title: "Afterwork des entrepreneurs de l’Est parisien", category: "Networking",
    description: "Présentations express, tables thématiques (création, financement, recrutement) et échanges libres. Venez avec une question précise : chacun repart avec au moins trois contacts utiles.",
    day: 19, start: [19, 0], end: [22, 0], priceCents: 2500, capacity: 30, perks: { drink: true, starter: true, description: "Boisson chaude ou fraîche et assiette à partager." }
  },
  {
    slug: "the-et-rencontres-salon-kenza", restaurant: 1, title: "Thé & rencontres du dimanche", category: "Speed dating",
    description: "Un après-midi en douceur autour d’un thé et de pâtisseries : rencontres en tête-à-tête de dix minutes, dans un salon privatisé. Profils validés en amont par un court entretien.",
    day: 16, start: [15, 0], end: [18, 0], priceCents: 2900, capacity: 16, minAge: 25, maxAge: 35, perks: { drink: true, dessert: true, description: "Thé à volonté et assortiment de pâtisseries." }
  },
  {
    slug: "networking-femmes-entrepreneures-salon-kenza", restaurant: 1, title: "Cercle des femmes entrepreneures", category: "Networking",
    description: "Une soirée pour se présenter, partager ses projets et trouver des partenaires : tour de table guidé, puis échanges libres autour d’un dîner léger.",
    day: 26, start: [19, 0], end: [22, 0], priceCents: 3500, capacity: 24, perks: { drink: true, main: true, description: "Boisson sans alcool et plat du jour." }
  },
  {
    slug: "afterwork-independants-cafe-amel", restaurant: 2, title: "Afterwork des indépendants du 93", category: "Networking",
    description: "Freelances, artisans, créateurs d’entreprise : une soirée pour élargir son réseau local, avec un tour de présentation d’une minute chacun et des échanges libres.",
    day: 22, start: [19, 0], end: [21, 30], priceCents: 1500, capacity: 40, perks: { drink: true, description: "Une boisson offerte à l’arrivée." }
  },
  {
    slug: "rencontres-cafe-amel-25-35", restaurant: 2, title: "Soirée rencontres 25-35 ans", category: "Speed dating",
    description: "Des rencontres en tête-à-tête dans une ambiance détendue, suivies d’un dessert partagé. Profils validés en amont par un court entretien.",
    day: 33, start: [19, 30], end: [22, 0], priceCents: 3200, capacity: 20, minAge: 25, maxAge: 35, perks: { drink: true, dessert: true, description: "Boisson sans alcool et dessert." }
  }
];

export async function seedDemoData(prisma: PrismaClient) {
  const restaurantIds: string[] = [];
  for (const r of RESTAURANTS) {
    const owner = await prisma.user.upsert({
      where: { phone: r.phone },
      update: { isDemo: true, displayName: r.name },
      create: { phone: r.phone, displayName: r.name, role: UserRole.ORGANIZER, isDemo: true, profile: { create: { city: r.district, interests: [], profileCompleted: true } } }
    });
    const data = { name: r.name, managerName: r.owner, description: r.description, district: r.district, desiredCapacity: r.capacity, desiredSchedule: r.schedule, status: "APPROVED" as const, verifiedAt: new Date(), isDemo: true };
    const restaurant = await prisma.restaurant.upsert({ where: { ownerId: owner.id }, update: data, create: { ownerId: owner.id, ...data } });
    restaurantIds.push(restaurant.id);
  }
  for (const e of EVENTS) {
    const r = RESTAURANTS[e.restaurant];
    const data = {
      title: e.title, category: e.category, flow: e.category === "Speed dating" ? EventFlow.SCREENING : EventFlow.DIRECT, description: e.description,
      startsAt: at(e.day, ...e.start), endsAt: at(e.day, ...e.end), district: r.district, address: r.district, zone: r.zone,
      capacity: e.capacity, priceCents: e.priceCents, minAge: e.minAge ?? null, maxAge: e.maxAge ?? null,
      includesDrink: !!e.perks.drink, includesStarter: !!e.perks.starter, includesMain: !!e.perks.main, includesDessert: !!e.perks.dessert, perksDescription: e.perks.description ?? null,
      status: EventStatus.PUBLISHED, controllerRestaurantId: restaurantIds[e.restaurant], venueRestaurantId: restaurantIds[e.restaurant], isDemo: true
    };
    await prisma.event.upsert({ where: { slug: e.slug }, update: data, create: { slug: e.slug, ...data } });
  }
  return { restaurants: restaurantIds.length, events: EVENTS.length };
}
