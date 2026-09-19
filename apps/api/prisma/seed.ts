import { PrismaClient, UserRole, EventStatus, ApplicationStatus, PaymentStatus, TicketStatus, ContactRequestStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { phone: "+33600000001" },
    update: {},
    create: { phone: "+33600000001", email: "admin@nour-meet.local", displayName: "Walid", role: UserRole.ADMIN, profile: { create: { city: "Paris", profession: "Fondateur", interests: ["Événementiel"], bio: "Super-administrateur Nūr Meet", profileCompleted: true, validatedAt: new Date() } } }
  });
  const organizerUser = await prisma.user.upsert({
    where: { phone: "+33600000002" },
    update: {},
    create: { phone: "+33600000002", email: "amana@nour-meet.local", displayName: "Maison Amana", role: UserRole.ORGANIZER, profile: { create: { city: "Paris", interests: ["Culture", "Rencontres"], profileCompleted: true, validatedAt: new Date() } } }
  });
  const restaurant = await prisma.restaurant.upsert({
    where: { ownerId: organizerUser.id },
    update: {},
    create: { ownerId: organizerUser.id, name: "Maison Amana", managerName: "Amana Traoré", siret: "12345678900019", description: "Des expériences raffinées autour de la culture et de la rencontre.", district: "Paris 8e", address: "14 rue de Miromesnil, 75008 Paris", phone: "+33145000000", commissionRate: 30, status: "APPROVED", verifiedAt: new Date() }
  });
  const sofia = await prisma.user.upsert({
    where: { phone: "+33612345678" },
    update: { profile: { update: { quotaCategory: "FEMME" } } },
    create: { phone: "+33612345678", email: "sofia@nour-meet.local", displayName: "Sofia", role: UserRole.PARTICIPANT, profile: { create: { birthDate: new Date("1992-06-14"), city: "Boulogne-Billancourt", profession: "Cheffe de projet", interests: ["Voyages", "Art", "Gastronomie", "Lecture"], bio: "Curieuse, passionnée d’art et de voyages. J’aime les échanges sincères et les bonnes tables.", shareCode: "NOUR-SOFIA-8421", profileCompleted: true, validatedAt: new Date(), quotaCategory: "FEMME" } } }
  });
  const karim = await prisma.user.upsert({
    where: { phone: "+33687654321" },
    update: {},
    create: { phone: "+33687654321", email: "karim@nour-meet.local", displayName: "Karim", role: UserRole.PARTICIPANT, profile: { create: { birthDate: new Date("1990-02-18"), city: "Paris 15e", profession: "Entrepreneur", interests: ["Entrepreneuriat", "Photo", "Sport"], bio: "Entrepreneur dans la tech, amateur de randonnée et de photographie.", shareCode: "NOUR-KARIM-3902", profileCompleted: true, validatedAt: new Date() } } }
  });

  const event = await prisma.event.upsert({
    where: { slug: "diner-connexions-septembre" },
    update: { zone: "Paris intra-muros" },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "diner-connexions-septembre", title: "Dîner & Connexions", category: "Speed dating", description: "Un dîner en petit comité, des échanges guidés et des temps libres dans un lieu privatisé.", startsAt: new Date("2026-09-26T19:30:00+02:00"), endsAt: new Date("2026-09-26T23:30:00+02:00"), district: "Paris 8e", address: "14 rue de Miromesnil, 75008 Paris", zone: "Paris intra-muros", capacity: 28, priceCents: 3500, status: EventStatus.PUBLISHED }
  });
  await prisma.eventQuota.upsert({ where: { eventId_category: { eventId: event.id, category: "HOMME" } }, update: {}, create: { eventId: event.id, category: "HOMME", capacity: 14 } });
  await prisma.eventQuota.upsert({ where: { eventId_category: { eventId: event.id, category: "FEMME" } }, update: {}, create: { eventId: event.id, category: "FEMME", capacity: 14, heldCount: 1 } });
  const afterwork = await prisma.event.upsert({
    where: { slug: "afterwork-entrepreneurs-octobre" }, update: { zone: "La Défense" },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "afterwork-entrepreneurs-octobre", title: "Afterwork des entrepreneurs", category: "Networking", description: "Rencontrez des entrepreneurs et indépendants autour d’échanges structurés.", startsAt: new Date("2026-10-01T19:00:00+02:00"), endsAt: new Date("2026-10-01T22:30:00+02:00"), district: "La Défense", address: "2 place de la Défense, 92800 Puteaux", zone: "La Défense", capacity: 40, priceCents: 4500, status: EventStatus.PUBLISHED }
  });
  await prisma.event.upsert({
    where: { slug: "art-the-conversations" }, update: { zone: "Paris intra-muros" },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "art-the-conversations", title: "Art, thé & conversations", category: "Networking", description: "Une rencontre culturelle dans un salon privatisé du Marais.", startsAt: new Date("2026-10-04T16:00:00+02:00"), endsAt: new Date("2026-10-04T19:00:00+02:00"), district: "Paris 4e", address: "18 rue des Archives, 75004 Paris", zone: "Paris intra-muros", capacity: 20, priceCents: 2900, status: EventStatus.PUBLISHED }
  });
  await prisma.event.upsert({
    where: { slug: "soiree-nour-x-amana" }, update: { zone: "Paris intra-muros" },
    create: { controllerRestaurantId: null, venueRestaurantId: restaurant.id, slug: "soiree-nour-x-amana", title: "Soirée Nūr × Maison Amana", category: "Networking", description: "Un événement organisé directement par Nūr Meet, accueilli par notre partenaire Maison Amana.", startsAt: new Date("2026-10-10T19:00:00+02:00"), endsAt: new Date("2026-10-10T22:00:00+02:00"), district: "Paris 8e", address: "14 rue de Miromesnil, 75008 Paris", zone: "Paris intra-muros", capacity: 30, priceCents: 4000, status: EventStatus.PUBLISHED }
  });
  // Deuxième événement Networking à La Défense, pour démontrer les propositions d'événements alternatifs
  // (même catégorie + même zone) lorsque l'Afterwork est complet.
  await prisma.event.upsert({
    where: { slug: "networking-la-defense-bis" }, update: { zone: "La Défense" },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "networking-la-defense-bis", title: "Networking des indépendants", category: "Networking", description: "Une seconde soirée networking à La Défense pour les indépendants et entrepreneurs.", startsAt: new Date("2026-10-08T19:00:00+02:00"), endsAt: new Date("2026-10-08T22:00:00+02:00"), district: "La Défense", address: "5 place de la Défense, 92800 Puteaux", zone: "La Défense", capacity: 30, priceCents: 4000, status: EventStatus.PUBLISHED }
  });

  const slots = ["2026-09-22T18:00:00+02:00", "2026-09-22T18:20:00+02:00", "2026-09-24T18:40:00+02:00", "2026-09-24T19:20:00+02:00"];
  for (const start of slots) {
    const startsAt = new Date(start); const endsAt = new Date(startsAt.getTime() + 15 * 60_000);
    const existing = await prisma.screeningCall.findFirst({ where: { eventId: event.id, startsAt } });
    if (!existing) await prisma.screeningCall.create({ data: { eventId: event.id, startsAt, endsAt } });
  }

  const application = await prisma.application.upsert({
    where: { eventId_userId: { eventId: event.id, userId: sofia.id } },
    update: { status: ApplicationStatus.CONFIRMED, quotaCategory: "FEMME" },
    create: { eventId: event.id, userId: sofia.id, motivation: "Je souhaite faire de nouvelles rencontres dans un cadre respectueux.", status: ApplicationStatus.CONFIRMED, quotaCategory: "FEMME", decidedAt: new Date() }
  });
  const reservation = await prisma.reservation.upsert({
    where: { applicationId: application.id }, update: { confirmedAt: new Date(), quotaCategory: "FEMME" },
    create: { eventId: event.id, userId: sofia.id, applicationId: application.id, expiresAt: new Date("2026-09-25T20:00:00+02:00"), confirmedAt: new Date(), quotaCategory: "FEMME" }
  });
  await prisma.payment.upsert({ where: { reservationId: reservation.id }, update: {}, create: { reservationId: reservation.id, amountCents: 3500, status: PaymentStatus.SUCCEEDED, provider: "fake", providerRef: "demo-payment", paidAt: new Date() } });
  await prisma.ticket.upsert({ where: { reservationId: reservation.id }, update: {}, create: { reservationId: reservation.id, code: "NOUR-TICKET-DEMO-482", status: TicketStatus.VALID } });
  await prisma.loyaltyEntry.deleteMany({ where: { userId: sofia.id, reason: "Données de démonstration" } });
  await prisma.loyaltyEntry.create({ data: { userId: sofia.id, points: 120, reason: "Données de démonstration" } });

  const contact = await prisma.contactRequest.upsert({
    where: { requesterId_recipientId: { requesterId: sofia.id, recipientId: karim.id } },
    update: { status: ContactRequestStatus.ACCEPTED },
    create: { requesterId: sofia.id, recipientId: karim.id, status: ContactRequestStatus.ACCEPTED }
  });
  let conversation = await prisma.conversation.findFirst({ where: { members: { every: { userId: { in: [sofia.id, karim.id] } } } } });
  if (!conversation) conversation = await prisma.conversation.create({ data: { members: { create: [{ userId: sofia.id }, { userId: karim.id }] } } });
  if (await prisma.message.count({ where: { conversationId: conversation.id } }) === 0) {
    await prisma.message.createMany({ data: [
      { conversationId: conversation.id, senderId: karim.id, body: "Bonsoir Sofia, content d’avoir pu échanger avec toi !" },
      { conversationId: conversation.id, senderId: sofia.id, body: "Bonsoir Karim, moi aussi 😊" }
    ] });
  }
  await prisma.notification.createMany({ data: [
    { userId: sofia.id, title: "Votre place est confirmée", body: "Votre billet pour Dîner & Connexions est disponible." },
    { userId: sofia.id, title: "Nouveau message de Karim", body: "Avec plaisir, à bientôt !" }
  ], skipDuplicates: true });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "SEED_DATABASE", entity: "System", metadata: { contactId: contact.id } } });
}

main().finally(() => prisma.$disconnect());
