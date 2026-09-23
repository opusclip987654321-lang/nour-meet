import { PrismaClient } from "@prisma/client";

// Ces tests tournent contre le vrai serveur de développement (docker compose up + seed requis),
// pas contre une base en mémoire — voir apps/api/tests/integration/helpers.ts pour le même choix
// côté API. DATABASE_URL doit désigner LA MÊME base que l'API testée (sinon le nettoyage ci-dessous
// agit sur une autre base) ; à défaut, le port exposé sur l'hôte par docker-compose.yml.
export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? "postgresql://nour:nour_dev_password@localhost:5434/nour_meet?schema=public" } }
});

// Les parcours speed dating/networking utilisent les personas de test partagées du seed (§ voir
// prisma/seed.ts) : le bouton "Annuler mon inscription" de l'application ne permet jamais de
// redemander une place sur le même événement une fois la candidature annulée (aucun parcours de
// réinscription après annulation, comportement produit actuel, pas un bug de ce test). Sans ce
// nettoyage direct en base, un deuxième passage de ce test resterait bloqué sur cet état.
export async function forgetApplication(phone: string, eventSlug: string) {
  const user = await prisma.user.findUnique({ where: { phone } });
  const event = await prisma.event.findUnique({ where: { slug: eventSlug } });
  if (!user || !event) return;
  await prisma.application.deleteMany({ where: { userId: user.id, eventId: event.id } });
}

// Remet à zéro la relation entre deux personas (demandes, conversations, signalements) pour que le
// parcours de mise en relation puisse être rejoué : une demande refusée ou signalée ne peut
// volontairement jamais être renouvelée depuis l'application.
export async function forgetContacts(phoneA: string, phoneB: string) {
  const [a, b] = await Promise.all([prisma.user.findUnique({ where: { phone: phoneA } }), prisma.user.findUnique({ where: { phone: phoneB } })]);
  if (!a || !b) return;
  const pair = [{ requesterId: a.id, recipientId: b.id }, { requesterId: b.id, recipientId: a.id }];
  await prisma.contactRequest.deleteMany({ where: { OR: pair } });
  await prisma.report.deleteMany({ where: { OR: [{ reporterId: a.id, reportedId: b.id }, { reporterId: b.id, reportedId: a.id }] } });
  await prisma.conversation.deleteMany({ where: { AND: [{ members: { some: { userId: a.id } } }, { members: { some: { userId: b.id } } }] } });
}
