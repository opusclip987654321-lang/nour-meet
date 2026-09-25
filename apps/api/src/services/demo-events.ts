import { ApplicationStatus, EventStatus, PrismaClient } from "@prisma/client";
import { audit } from "./audit.js";
import { notify } from "./notify.js";

// Soirées de démonstration (décision du 2026-09-25) : présentées comme de vraies soirées, parcours
// complet jusqu'au paiement (refusé côté serveur, voir isEventBookable), puis retirées
// AUTOMATIQUEMENT dès qu'une vraie soirée commercialisable est publiée — publiée ou complète, à venir,
// non démo. Retirer = annuler la soirée et les inscriptions encore ouvertes, prévenir chaque inscrit
// par un message neutre. Aucun paiement n'existe sur une soirée démo : rien à rembourser.
export const realBookableEventExists = async (prisma: PrismaClient) =>
  (await prisma.event.count({ where: { isDemo: false, status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] }, startsAt: { gt: new Date() } } })) > 0;

export async function retireDemoEventsIfRealOnesPublished(prisma: PrismaClient): Promise<number> {
  if (!(await realBookableEventExists(prisma))) return 0;
  // Les soirées du jeu de démonstration : marquées isDemo ET tenues par un restaurant de démonstration
  // (prisma/demo-data.ts). Appelé aux deux seuls endroits qui publient une soirée (création publiée
  // par l'administration, validation d'une soirée soumise), donc sans tâche périodique.
  const demos = await prisma.event.findMany({ where: { isDemo: true, controllerRestaurant: { isDemo: true }, status: { notIn: [EventStatus.CANCELLED, EventStatus.COMPLETED] } }, select: { id: true, title: true } });
  for (const demo of demos) {
    const open = await prisma.application.findMany({ where: { eventId: demo.id, status: { notIn: [ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } }, select: { id: true, userId: true } });
    await prisma.$transaction([
      prisma.event.update({ where: { id: demo.id }, data: { status: EventStatus.CANCELLED } }),
      prisma.application.updateMany({ where: { id: { in: open.map(a => a.id) } }, data: { status: ApplicationStatus.CANCELLED } }),
      prisma.waitlistEntry.deleteMany({ where: { eventId: demo.id } })
    ]);
    await Promise.all(open.map(a => notify(a.userId, "Soirée retirée", `« ${demo.title} » n’est plus proposée. Découvrez les prochaines soirées dans le calendrier.`, "/events")));
    await audit(undefined, "RETIRE_DEMO_EVENT", "Event", demo.id, { closedApplications: open.length });
  }
  return demos.length;
}
