import { PrismaClient, UserRole, EventStatus, EventFlow, ApplicationStatus, PaymentStatus, TicketStatus, ContactRequestStatus, AlternativeOfferStatus } from "@prisma/client";

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
    // flow explicite ici : la migration qui backfillait "flow" pour les événements Speed dating
    // existants (20260919151801) ne s'applique qu'aux lignes déjà présentes au moment où elle
    // tourne. Sur une installation neuve (migrate deploy puis seed, table Event vide au moment de
    // la migration), sans ce champ explicite, cet événement retomberait sur le défaut DIRECT du
    // schéma alors qu'il doit exiger un entretien (§4.1).
    update: { zone: "Paris intra-muros", flow: EventFlow.SCREENING },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "diner-connexions-septembre", title: "Dîner & Connexions", category: "Speed dating", flow: EventFlow.SCREENING, description: "Un dîner en petit comité, des échanges guidés et des temps libres dans un lieu privatisé.", startsAt: new Date("2026-09-26T19:30:00+02:00"), endsAt: new Date("2026-09-26T23:30:00+02:00"), district: "Paris 8e", address: "14 rue de Miromesnil, 75008 Paris", zone: "Paris intra-muros", capacity: 28, priceCents: 3500, status: EventStatus.PUBLISHED }
  });
  await prisma.eventQuota.upsert({ where: { eventId_category: { eventId: event.id, category: "HOMME" } }, update: {}, create: { eventId: event.id, category: "HOMME", capacity: 14 } });
  await prisma.eventQuota.upsert({ where: { eventId_category: { eventId: event.id, category: "FEMME" } }, update: {}, create: { eventId: event.id, category: "FEMME", capacity: 14, heldCount: 1 } });
  const afterwork = await prisma.event.upsert({
    where: { slug: "afterwork-entrepreneurs-octobre" }, update: { zone: "La Défense" },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "afterwork-entrepreneurs-octobre", title: "Afterwork des entrepreneurs", category: "Networking", description: "Rencontrez des entrepreneurs et indépendants autour d’échanges structurés.", startsAt: new Date("2026-10-01T19:00:00+02:00"), endsAt: new Date("2026-10-01T22:30:00+02:00"), district: "La Défense", address: "2 place de la Défense, 92800 Puteaux", zone: "La Défense", capacity: 40, priceCents: 4500, status: EventStatus.PUBLISHED }
  });
  const artThe = await prisma.event.upsert({
    where: { slug: "art-the-conversations" }, update: { zone: "Paris intra-muros" },
    create: { controllerRestaurantId: restaurant.id, venueRestaurantId: restaurant.id, slug: "art-the-conversations", title: "Art, thé & conversations", category: "Networking", description: "Une rencontre culturelle dans un salon privatisé du Marais.", startsAt: new Date("2026-10-04T16:00:00+02:00"), endsAt: new Date("2026-10-04T19:00:00+02:00"), district: "Paris 4e", address: "18 rue des Archives, 75004 Paris", zone: "Paris intra-muros", capacity: 20, priceCents: 2900, status: EventStatus.PUBLISHED }
  });
  const soireeNour = await prisma.event.upsert({
    where: { slug: "soiree-nour-x-amana" }, update: { zone: "Paris intra-muros" },
    create: { controllerRestaurantId: null, venueRestaurantId: restaurant.id, slug: "soiree-nour-x-amana", title: "Soirée Nūr × Maison Amana", category: "Networking", description: "Un événement organisé directement par Nūr Meet, accueilli par notre partenaire Maison Amana.", startsAt: new Date("2026-10-10T19:00:00+02:00"), endsAt: new Date("2026-10-10T22:00:00+02:00"), district: "Paris 8e", address: "14 rue de Miromesnil, 75008 Paris", zone: "Paris intra-muros", capacity: 30, priceCents: 4000, status: EventStatus.PUBLISHED }
  });
  // Deuxième événement Networking à La Défense, pour démontrer les propositions d'événements alternatifs
  // (même catégorie + même zone) lorsque l'Afterwork est complet.
  const networkingBis = await prisma.event.upsert({
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

  // Comptes de test dédiés au développement local (connexion rapide depuis la page de connexion en
  // mode SMS simulé) : un par état/rôle utile à vérifier manuellement, en plus des comptes de
  // démonstration ci-dessus (Walid, Maison Amana, Sofia, Karim).
  const pendingOwner = await prisma.user.upsert({
    where: { phone: "+33600000010" },
    update: {},
    create: { phone: "+33600000010", displayName: "Resto En Attente", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true, validatedAt: new Date() } } }
  });
  await prisma.restaurant.upsert({
    where: { ownerId: pendingOwner.id },
    update: {},
    create: { ownerId: pendingOwner.id, name: "Le Petit Test", managerName: "En Attente", siret: "98765432100011", description: "Restaurant de test en attente d'approbation.", district: "Paris 11e", address: "3 rue de test, 75011 Paris", phone: "+33146000000", commissionRate: 30, status: "PENDING" }
  });

  await prisma.user.upsert({
    where: { phone: "+33600000030" },
    update: {},
    create: { phone: "+33600000030", displayName: "Accueil Test", role: UserRole.RECEPTION, restaurantId: restaurant.id, profile: { create: { city: "Paris", interests: [], profileCompleted: true, validatedAt: new Date() } } }
  });
  await prisma.user.upsert({
    where: { phone: "+33600000031" },
    update: {},
    create: { phone: "+33600000031", displayName: "Modérateur Test", role: UserRole.MODERATOR, profile: { create: { city: "Paris", interests: [], profileCompleted: true, validatedAt: new Date() } } }
  });

  const hommeValide = await prisma.user.upsert({
    where: { phone: "+33600000020" },
    update: {},
    create: { phone: "+33600000020", displayName: "Homme Validé", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true, validatedAt: new Date(), quotaCategory: "HOMME" } } }
  });
  const existingHommeApp = await prisma.application.findFirst({ where: { userId: hommeValide.id, eventId: null } });
  if (!existingHommeApp) await prisma.application.create({ data: { userId: hommeValide.id, motivation: "Compte de test : participant homme déjà validé.", status: ApplicationStatus.ACCEPTED, decidedAt: new Date() } });

  // C26 (ordre correctif 2026-09-20) : scénario de liste d'attente + alternatives immédiatement
  // visible pour "Homme Validé", sans passer par une vraie saturation de capacité (données de seed,
  // jamais un vrai paiement) — "Afterwork des entrepreneurs" comme candidature en cours, avec les 3
  // autres soirées Networking d'Île-de-France (même région que La Défense) proposées comme
  // alternatives réellement disponibles. "Dîner & Connexions" (Speed dating) démontre par omission
  // le filtrage par catégorie : jamais proposé ici puisqu'incompatible.
  const waitlistApplication = await prisma.application.upsert({
    where: { eventId_userId: { eventId: afterwork.id, userId: hommeValide.id } },
    update: { status: ApplicationStatus.PAYMENT_PENDING },
    create: { eventId: afterwork.id, userId: hommeValide.id, motivation: "Compte de test : candidature en attente, événement complet.", status: ApplicationStatus.PAYMENT_PENDING }
  });
  await prisma.waitlistEntry.upsert({
    where: { applicationId: waitlistApplication.id },
    update: {},
    create: { eventId: afterwork.id, userId: hommeValide.id, applicationId: waitlistApplication.id, position: 1 }
  });
  for (const alt of [artThe, soireeNour, networkingBis]) {
    const existingOffer = await prisma.alternativeOffer.findFirst({ where: { userId: hommeValide.id, originalEventId: afterwork.id, alternativeEventId: alt.id } });
    if (!existingOffer) await prisma.alternativeOffer.create({ data: { userId: hommeValide.id, originalEventId: afterwork.id, alternativeEventId: alt.id, status: AlternativeOfferStatus.PENDING, respondsBy: new Date(Date.now() + 7 * 24 * 60 * 60_000) } });
  }

  await prisma.user.upsert({
    where: { phone: "+33600000021" },
    update: {},
    create: { phone: "+33600000021", displayName: "Homme Non Validé", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true, quotaCategory: "HOMME" } } }
  });

  const femmeValidee = await prisma.user.upsert({
    where: { phone: "+33600000022" },
    update: {},
    create: { phone: "+33600000022", displayName: "Femme Validée", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true, validatedAt: new Date(), quotaCategory: "FEMME" } } }
  });
  const existingFemmeApp = await prisma.application.findFirst({ where: { userId: femmeValidee.id, eventId: null } });
  if (!existingFemmeApp) await prisma.application.create({ data: { userId: femmeValidee.id, motivation: "Compte de test : participante déjà validée.", status: ApplicationStatus.ACCEPTED, decidedAt: new Date() } });

  await prisma.user.upsert({
    where: { phone: "+33600000023" },
    update: {},
    create: { phone: "+33600000023", displayName: "Femme Non Validée", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true, quotaCategory: "FEMME" } } }
  });

  const refuse = await prisma.user.upsert({
    where: { phone: "+33600000024" },
    update: {},
    create: { phone: "+33600000024", displayName: "Profil Refusé", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true } } }
  });
  const existingRefusApp = await prisma.application.findFirst({ where: { userId: refuse.id, eventId: null } });
  if (!existingRefusApp) await prisma.application.create({ data: { userId: refuse.id, motivation: "Compte de test : profil refusé, délai de trois mois en cours.", status: ApplicationStatus.REFUSED, notes: "Refus de test", decidedAt: new Date() } });

  const enAttenteEntretien = await prisma.user.upsert({
    where: { phone: "+33600000025" },
    update: {},
    create: { phone: "+33600000025", displayName: "En Attente D'Entretien", role: UserRole.PARTICIPANT, profile: { create: { city: "Paris", interests: [], profileCompleted: true } } }
  });
  const existingWaitingApp = await prisma.application.findFirst({ where: { userId: enAttenteEntretien.id, eventId: null } });
  if (!existingWaitingApp) await prisma.application.create({ data: { userId: enAttenteEntretien.id, motivation: "Compte de test : entretien demandé, aucun créneau réservé.", status: ApplicationStatus.PENDING_CALL } });
}

main().finally(() => prisma.$disconnect());
