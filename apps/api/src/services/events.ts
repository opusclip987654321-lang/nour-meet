import { EVENT_CATEGORIES, EventViewerStatus, eventViewerStatus } from "@nour/shared";
import { prisma } from "../context.js";
import { getSetting } from "../settings.js";

export const defaultCategoryImage = (category: string) => EVENT_CATEGORIES.find(c => c.name === category)?.defaultImage ?? EVENT_CATEGORIES[0].defaultImage;
// Fenêtre d'offre de liste d'attente (voir AppSetting WAITLIST_OFFER_WINDOW_HOURS) : la durée
// exacte est configurable, jamais supposée fixe dans le message envoyé au participant.
export const formatPaymentDeadline = (expiresAt: Date) => `jusqu’au ${expiresAt.toLocaleString("fr-FR")}`;
// C24 (ordre correctif 2026-09-20) : ne jamais exposer capacité, quotas ou compteurs internes bruts
// au participant — seulement une disponibilité pertinente pour LUI. "category" = solde de sa propre
// catégorie (jamais celui de l'autre catégorie) ; "general" = places pour un événement sans quota
// (networking) ; "unknown" = événement à quota mais catégorie du visiteur inconnue (anonyme ou profil
// incomplet) : aucun chiffre interne n'est alors divulgué, seulement un état neutre.
const eventAvailability = (event: any, viewerQuotaCategory: string | null) => {
  const quotas: { category: string; capacity: number; heldCount: number }[] = event.quotas ?? [];
  if (quotas.length > 0) {
    if (!viewerQuotaCategory) return { kind: "unknown" as const };
    const bucket = quotas.find(q => q.category === viewerQuotaCategory);
    if (!bucket) return { kind: "unknown" as const };
    const remaining = Math.max(0, bucket.capacity - bucket.heldCount);
    return { kind: "category" as const, remaining, full: remaining <= 0 };
  }
  const remaining = Math.max(0, event.capacity - (event._count?.reservations ?? 0));
  return { kind: "general" as const, remaining, full: remaining <= 0 };
};
export const publicEvent = (event: any, revealAddress = false, viewerQuotaCategory: string | null = null) => ({
  id: event.id, slug: event.slug, title: event.title, category: event.category, flow: event.flow, description: event.description,
  startsAt: event.startsAt, endsAt: event.endsAt, district: event.district, address: revealAddress ? event.address : null,
  zone: event.zone ?? null,
  imageUrl: event.imageUrl ?? defaultCategoryImage(event.category),
  photos: (event.photos ?? []).map((p: any) => p.url),
  perks: { drink: event.includesDrink, starter: event.includesStarter, main: event.includesMain, dessert: event.includesDessert, description: event.perksDescription ?? null },
  minAge: event.minAge ?? null, maxAge: event.maxAge ?? null,
  availability: eventAvailability(event, viewerQuotaCategory), priceCents: event.priceCents, status: event.status,
  // Jamais exposés publiquement tant que ENABLE_GENDER_PRICING est désactivé (§6) : sinon le web
  // afficherait un tarif différencié que resolvePriceCents n'appliquerait pas réellement au paiement.
  priceTiers: getSetting("ENABLE_GENDER_PRICING") ? (event.priceTiers ?? []).map((t: any) => ({ category: t.category, amountCents: t.amountCents })) : [],
  organizer: event.controllerRestaurant ? { id: event.controllerRestaurant.id, name: event.controllerRestaurant.name } : { id: null, name: "Nūr Meet" },
  // Instructions définitives 2026-09-20 (A3) : mise en avant réelle mais qui ne doit jamais changer
  // le tri chronologique de la page Événements — seulement un badge visuel, jamais un ré-ordonnancement.
  highlightTier: event.controllerRestaurant?.subscription?.status === "ACTIVE" || event.controllerRestaurant?.subscription?.status === "TRIALING" ? event.controllerRestaurant.subscription.plan.highlightTier ?? null : null,
  venue: event.venueRestaurant ? { id: event.venueRestaurant.id, name: event.venueRestaurant.name } : null,
  hasQuotas: (event.quotas ?? []).length > 0,
  // §8 : jamais affiché comme tel ; sert uniquement à ne pas déclarer aux moteurs de recherche un
  // événement qui ne peut pas être réservé (noindex, pas de données structurées Event).
  bookable: !event.isDemo
});

// Statut du visiteur connecté pour une liste d'événements (§5.2 des corrections web 2026-09-24), en
// deux requêtes groupées quel que soit le nombre d'événements affichés.
export const viewerStatuses = async (userId: string | null, eventIds: string[]): Promise<Map<string, EventViewerStatus>> => {
  const out = new Map<string, EventViewerStatus>();
  if (!userId || eventIds.length === 0) return out;
  const [reservations, waitlist] = await Promise.all([
    prisma.reservation.findMany({ where: { userId, eventId: { in: eventIds } }, select: { eventId: true, confirmedAt: true, cancelledAt: true } }),
    prisma.waitlistEntry.findMany({ where: { userId, eventId: { in: eventIds } }, select: { eventId: true } })
  ]);
  for (const eventId of eventIds) {
    const status = eventViewerStatus({ reservation: reservations.find(r => r.eventId === eventId), onWaitlist: waitlist.some(w => w.eventId === eventId) });
    if (status) out.set(eventId, status);
  }
  return out;
};
