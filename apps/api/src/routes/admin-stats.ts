import { ApplicationStatus, EventStatus, PaymentStatus, Prisma, TicketStatus, UserRole } from "@prisma/client";
import ExcelJS from "exceljs";
import { z } from "zod";
import { app, prisma } from "../context.js";
import { TokenUser, ownRestaurant, roles } from "../services/auth.js";
import { getSetting } from "../settings.js";

// Tableau de bord (§14) : filtrable par période, cartes séparées par nature — jamais un seul total
// qui mélangerait des choses de nature différente (voir aussi /admin/finance/summary pour le détail
// financier). Les cartes propres à la plateforme entière (entretiens, abonnements, partages...)
// restent réservées au super-admin, un restaurateur ne voyant que son propre périmètre.
app.get("/admin/dashboard", { preHandler: roles(UserRole.ADMIN, UserRole.ORGANIZER) }, async (request) => {
  const token = request.user as TokenUser;
  const restaurant = await ownRestaurant(token);
  // §14 : filtres par événement, type, date, statut, tranche d'âge et ville. La tranche d'âge est
  // un agrégat compté côté serveur (nombre de candidatures dans la tranche), jamais une liste de
  // profils individuels filtrables par âge — le seul usage "métier" que ce champ sert ici.
  const query = z.object({
    since: z.string().optional(), until: z.string().optional(), eventId: z.string().optional(),
    category: z.string().optional(), status: z.nativeEnum(EventStatus).optional(), city: z.string().optional(),
    minAge: z.coerce.number().int().min(0).optional(), maxAge: z.coerce.number().int().min(0).optional()
  }).parse(request.query);
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 30 * 86_400_000);
  const until = query.until ? new Date(query.until) : undefined;
  const createdRange = { gte: since, ...(until ? { lte: until } : {}) };
  const eventScope = {
    ...(restaurant ? { controllerRestaurantId: restaurant.id } : {}),
    ...(query.eventId ? { id: query.eventId } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.city ? { district: { contains: query.city, mode: Prisma.QueryMode.insensitive } } : {})
  };
  // Bornes de date de naissance dérivées de la tranche d'âge demandée : un âge minimum correspond à
  // une date de naissance plus ancienne (borne haute), et inversement pour l'âge maximum.
  const birthDateRange = (query.minAge != null || query.maxAge != null) ? {
    ...(query.minAge != null ? { lte: new Date(Date.now() - query.minAge * 31_557_600_000) } : {}),
    ...(query.maxAge != null ? { gte: new Date(Date.now() - (query.maxAge + 1) * 31_557_600_000) } : {})
  } : undefined;
  const applicationEventScope = restaurant || Object.keys(eventScope).length > 0 ? { event: eventScope } : { eventId: { not: null } };
  const [events, upcomingEvents, applications, payments, ticketsSold, waitlisted] = await Promise.all([
    prisma.event.count({ where: eventScope }),
    prisma.event.count({ where: { ...eventScope, status: EventStatus.PUBLISHED, startsAt: { gt: new Date() } } }),
    prisma.application.count({ where: { ...applicationEventScope, createdAt: createdRange, ...(birthDateRange ? { user: { profile: { birthDate: birthDateRange } } } : {}) } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, reservation: { event: eventScope }, paidAt: createdRange }, _sum: { amountCents: true } }),
    prisma.ticket.count({ where: { status: { not: "CANCELLED" }, reservation: { event: eventScope, createdAt: createdRange } } }),
    prisma.waitlistEntry.count({ where: { event: eventScope } })
  ]);
  const remainingSpots = await prisma.event.aggregate({ where: { ...eventScope, status: { in: [EventStatus.PUBLISHED, EventStatus.FULL] } }, _sum: { capacity: true } });
  const confirmedReservations = await prisma.reservation.count({ where: { confirmedAt: { not: null }, cancelledAt: null, event: eventScope } });
  // Les signalements, entretiens globaux, demandes restaurateurs, abonnements et partages concernent
  // la plateforme entière ou des comptes utilisateurs, pas un restaurant précis : réservés au
  // super-admin, qui est aujourd'hui le seul à les conduire.
  const openReports = restaurant ? null : await prisma.report.count({ where: { status: "OPEN" } });
  const pendingInterviews = restaurant ? null : await prisma.application.count({ where: { eventId: null, status: { notIn: [ApplicationStatus.ACCEPTED, ApplicationStatus.REFUSED, ApplicationStatus.CANCELLED] } } });
  // Taux d'acceptation : calculé sur les décisions de l'entretien global (eventId null), seule
  // démarche qui aboutit réellement à ACCEPTED/REFUSED dans l'architecture actuelle (Lot 1) — une
  // candidature à un événement précis ne passe jamais par ces statuts, elle irait directement en
  // PAYMENT_PENDING une fois le profil déjà validé.
  let acceptanceRate: number | null = null;
  if (!restaurant) {
    const [acceptedInterviews, decidedInterviews] = await Promise.all([
      prisma.application.count({ where: { eventId: null, status: ApplicationStatus.ACCEPTED, decidedAt: { gte: since } } }),
      prisma.application.count({ where: { eventId: null, status: { in: [ApplicationStatus.ACCEPTED, ApplicationStatus.REFUSED] }, decidedAt: { gte: since } } })
    ]);
    acceptanceRate = decidedInterviews > 0 ? Math.round((acceptedInterviews / decidedInterviews) * 100) : null;
  }
  const upcomingInterviews = restaurant ? null : await prisma.screeningCall.count({ where: { eventId: null, startsAt: { gt: new Date() }, completedAt: null } });
  const pendingRestaurantApplications = restaurant ? null : await prisma.restaurant.count({ where: { status: "PENDING" } });
  const subscriptionsByStatus = restaurant ? null : await prisma.restaurantSubscription.groupBy({ by: ["status"], _count: true });
  const pendingPayments = restaurant ? null : await prisma.payment.count({ where: { status: PaymentStatus.PENDING, createdAt: createdRange } });
  const failedPayments = restaurant ? null : await prisma.payment.count({ where: { status: PaymentStatus.FAILED, createdAt: createdRange } });
  const shareClicks = restaurant ? null : await prisma.shareLink.aggregate({ _sum: { clicks: true } });
  // §14 : le total de clics seul ne dit rien de l'efficacité du partage — inscriptions et ventes
  // réellement attribuées (déjà calculées par événement dans /admin/events/:id/shares), agrégées
  // ici à l'échelle de la plateforme.
  const shareAttributedApplications = restaurant ? null : await prisma.application.count({ where: { attributedShareLinkId: { not: null }, createdAt: createdRange } });
  const shareAttributedPurchases = restaurant ? null : await prisma.application.count({ where: { attributedShareLinkId: { not: null }, createdAt: createdRange, reservation: { payment: { status: PaymentStatus.SUCCEEDED } } } });
  // Courbe d'activité réelle : inscriptions aux événements par jour sur la période et le périmètre
  // filtrés (remplace des barres d'exemple codées en dur côté web). Jours sans inscription à zéro.
  const applicationDates = await prisma.application.findMany({ where: { ...applicationEventScope, createdAt: createdRange, ...(birthDateRange ? { user: { profile: { birthDate: birthDateRange } } } : {}) }, select: { createdAt: true } });
  const dayKey = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const counts = new Map<string, number>();
  for (const a of applicationDates) counts.set(dayKey(a.createdAt), (counts.get(dayKey(a.createdAt)) ?? 0) + 1);
  const activity: { day: string; applications: number }[] = [];
  for (let t = since.getTime(), end = (until ?? new Date()).getTime(); t <= end && activity.length < 366; t += 86_400_000) {
    const day = dayKey(new Date(t));
    if (activity.at(-1)?.day !== day) activity.push({ day, applications: counts.get(day) ?? 0 });
  }
  return {
    activity,
    events, upcomingEvents, applications, acceptanceRate, ticketsSold,
    remainingSpots: (remainingSpots._sum.capacity ?? 0) - confirmedReservations,
    waitlisted, revenueCents: payments._sum.amountCents ?? 0,
    openReports, pendingInterviews, upcomingInterviews, pendingRestaurantApplications,
    subscriptionsByStatus: subscriptionsByStatus?.map(s => ({ status: s.status, count: s._count })) ?? null,
    pendingPayments, failedPayments, shareClicks: shareClicks?._sum.clicks ?? null,
    shareAttributedApplications, shareAttributedPurchases
  };
});
// §6 (cahier des charges 2026-09) : tableau de statistiques strictement réservé au super-administrateur
// — contrairement à /admin/dashboard (partagé avec les restaurateurs, dont les champs plateforme sont
// déjà neutralisés à null pour eux), cette route n'accepte même pas le rôle ORGANIZER : aucune donnée
// n'y transite jamais vers un compte restaurateur ou modérateur. Tunnel de conversion, finance
// consolidée et audience, sur la même fenêtre de dates.
// C33 : classe une visite selon utm_source si présent, sinon le domaine du référent — jamais
// inventé, "Direct" seulement en l'absence totale de référent, "Inconnu" seulement si rien n'est
// exploitable (référent illisible et pas d'UTM).
const classifySource = (pv: { utmSource: string | null; referrerHost: string | null }): string => {
  if (pv.utmSource) {
    const s = pv.utmSource.toLowerCase();
    if (s.includes("google")) return "Google";
    if (s.includes("instagram")) return "Instagram";
    if (s.includes("tiktok")) return "TikTok";
    if (s.includes("facebook")) return "Facebook";
    return `Campagne (${pv.utmSource})`;
  }
  if (!pv.referrerHost) return "Direct";
  const h = pv.referrerHost.toLowerCase();
  if (h.includes("nour-meet") || h.includes("localhost")) return "Interne";
  if (h.includes("google")) return "Google";
  if (h.includes("instagram")) return "Instagram";
  if (h.includes("tiktok")) return "TikTok";
  if (h.includes("facebook") || h.includes("fb.com")) return "Facebook";
  return `Autre (${pv.referrerHost})`;
};
const statsForRange = async (since: Date, until: Date) => {
  const range = { gte: since, lte: until };
  const analyticsEnabled = getSetting("ANALYTICS_ENABLED");
  const [
    interviewsRequested, interviewsAccepted, interviewsRefused,
    applicationsCreated, paymentsSucceeded, paymentsFailed, ticketsConfirmed, cancellationsCount, waitlistCount,
    ticketRevenue, refundedAmount, refundedCount, pastDueCount, activeSubscriptions, subscriptionsByStatus,
    newParticipants, newRestaurantRequests, restaurantsApproved, subscriptionsStarted,
    eventsCreatedByRestaurant, eventsApprovedForRestaurant,
    shareClicks, shareAttributedApplications, shareAttributedPurchases,
    pageViews
  ] = await Promise.all([
    prisma.application.count({ where: { eventId: null, createdAt: range } }),
    prisma.application.count({ where: { eventId: null, status: ApplicationStatus.ACCEPTED, decidedAt: range } }),
    prisma.application.count({ where: { eventId: null, status: ApplicationStatus.REFUSED, decidedAt: range } }),
    prisma.application.count({ where: { eventId: { not: null }, createdAt: range } }),
    prisma.payment.count({ where: { status: PaymentStatus.SUCCEEDED, paidAt: range } }),
    prisma.payment.count({ where: { status: PaymentStatus.FAILED, createdAt: range } }),
    prisma.ticket.count({ where: { status: { not: TicketStatus.CANCELLED }, reservation: { confirmedAt: range } } }),
    prisma.reservation.count({ where: { confirmedAt: { not: null }, cancelledAt: range } }),
    prisma.waitlistEntry.count({ where: { createdAt: range } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED, paidAt: range }, _sum: { amountCents: true } }),
    prisma.payment.aggregate({ where: { refundedAt: range }, _sum: { refundedAmountCents: true } }),
    prisma.payment.count({ where: { refundedAt: range } }),
    prisma.restaurantSubscription.count({ where: { status: "PAST_DUE" } }),
    prisma.restaurantSubscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
    prisma.restaurantSubscription.groupBy({ by: ["status"], _count: true }),
    prisma.user.count({ where: { role: UserRole.PARTICIPANT, createdAt: range } }),
    prisma.restaurant.count({ where: { submittedAt: range } }),
    prisma.restaurant.count({ where: { verifiedAt: range } }),
    prisma.restaurantSubscription.count({ where: { createdAt: range } }),
    prisma.event.count({ where: { controllerRestaurantId: { not: null }, createdAt: range } }),
    prisma.event.count({ where: { controllerRestaurantId: { not: null }, quotaConsumedAt: range } }),
    prisma.shareLink.aggregate({ _sum: { clicks: true } }),
    prisma.application.count({ where: { attributedShareLinkId: { not: null }, createdAt: range } }),
    prisma.application.count({ where: { attributedShareLinkId: { not: null }, createdAt: range, reservation: { payment: { status: PaymentStatus.SUCCEEDED } } } }),
    analyticsEnabled ? prisma.pageView.findMany({ where: { createdAt: range }, select: { path: true, anonId: true, utmSource: true, referrerHost: true } }) : Promise.resolve(null)
  ]);
  let audience: any = { instrumented: false };
  let blog: any = { instrumented: false };
  let funnelTopParticipant: any = { instrumented: false };
  if (pageViews) {
    const uniqueAnon = new Set(pageViews.map(p => p.anonId));
    const bySource = new Map<string, number>();
    for (const pv of pageViews) { const s = classifySource(pv); bySource.set(s, (bySource.get(s) ?? 0) + 1); }
    audience = { instrumented: true, totalViews: pageViews.length, uniqueVisitors: uniqueAnon.size, bySource: [...bySource.entries()].map(([source, visits]) => ({ source, visits })).sort((a, b) => b.visits - a.visits) };
    const blogViews = pageViews.filter(p => p.path.startsWith("/blog"));
    blog = { instrumented: true, reads: blogViews.length, uniqueReaders: new Set(blogViews.map(p => p.anonId)).size };
    const home = new Set(pageViews.filter(p => p.path === "/").map(p => p.anonId)).size;
    const catalog = new Set(pageViews.filter(p => p.path.startsWith("/events")).map(p => p.anonId)).size;
    funnelTopParticipant = { instrumented: true, homeVisitors: home, catalogVisitors: catalog };
  }
  const monthlyRevenueCents = activeSubscriptions.reduce((sum, s) => sum + s.plan.monthlyPriceCents, 0);
  return {
    audience,
    funnelParticipant: {
      top: funnelTopParticipant,
      interviewsRequested, interviewsAccepted, interviewsRefused,
      interviewAcceptanceRate: (interviewsAccepted + interviewsRefused) > 0 ? Math.round((interviewsAccepted / (interviewsAccepted + interviewsRefused)) * 100) : null,
      applicationsCreated, paymentsSucceeded, paymentsFailed,
      paymentSuccessRate: (paymentsSucceeded + paymentsFailed) > 0 ? Math.round((paymentsSucceeded / (paymentsSucceeded + paymentsFailed)) * 100) : null,
      ticketsConfirmed, cancellationsCount, waitlistCount
    },
    funnelRestaurant: { newRequests: newRestaurantRequests, approved: restaurantsApproved, subscriptionsStarted, eventsCreated: eventsCreatedByRestaurant, eventsPublished: eventsApprovedForRestaurant },
    finance: {
      ticketRevenueCents: ticketRevenue._sum.amountCents ?? 0,
      refundedCents: refundedAmount._sum.refundedAmountCents ?? 0, refundedCount,
      subscriptionMonthlyRevenueCents: monthlyRevenueCents,
      activeSubscriptionsCount: activeSubscriptions.length, pastDueCount,
      subscriptionsByStatus: subscriptionsByStatus.map(s => ({ status: s.status, count: s._count }))
    },
    audienceLegacy: { newParticipants, shareClicks: shareClicks._sum.clicks ?? 0, shareAttributedApplications, shareAttributedPurchases },
    blog,
    searchConsole: { connected: false }
  };
};
app.get("/admin/stats", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const query = z.object({ since: z.string().optional(), until: z.string().optional(), compareSince: z.string().optional(), compareUntil: z.string().optional() }).parse(request.query);
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 30 * 86_400_000);
  const until = query.until ? new Date(query.until) : new Date();
  const current = await statsForRange(since, until);
  const previous = query.compareSince && query.compareUntil ? await statsForRange(new Date(query.compareSince), new Date(query.compareUntil)) : null;
  // C37 : hausse inhabituelle des annulations (fenêtre glissante distincte de la période choisie ci-dessus,
  // toujours sur 24h réelles) + abonnements dont l'échéance approche, pour une lecture immédiate.
  // H2 (cahier des charges consolidé 2026-09-20) : élargi aux paiements bloqués, aux demandes de
  // remboursement en attente et aux soirées sous le seuil de participants — chaque compteur est un
  // simple instantané recalculé à chaque appel (jamais une notification répétée), pour éviter tout
  // doublon ou bruit d'alerte.
  const alertSince = new Date(Date.now() - 24 * 60 * 60_000);
  const [confirmed24h, cancelled24h, expiringSoonCount, blockedPayments24h, pendingRefundRequests, underfilledEventsPending] = await Promise.all([
    prisma.reservation.count({ where: { confirmedAt: { gte: alertSince } } }),
    prisma.reservation.count({ where: { confirmedAt: { not: null }, cancelledAt: { gte: alertSince } } }),
    prisma.restaurantSubscription.count({ where: { status: { in: ["ACTIVE", "TRIALING"] }, currentPeriodEnd: { lte: new Date(Date.now() + getSetting("SUBSCRIPTION_EXPIRY_REMINDER_DAYS_BEFORE") * 24 * 60 * 60_000) } } }),
    prisma.payment.count({ where: { status: PaymentStatus.FAILED, createdAt: { gte: alertSince } } }),
    prisma.payment.count({ where: { refundRequestedAt: { not: null }, refundedAt: null } }),
    prisma.event.count({ where: { status: EventStatus.PUBLISHED, minParticipantsNotifiedAt: { not: null }, minParticipantsOutcome: null } })
  ]);
  const cancellationRate24h = confirmed24h > 0 ? Math.round((cancelled24h / confirmed24h) * 100) : 0;
  return {
    range: { since, until }, ...current, previous,
    alerts: { cancellationRate24h, cancellationThreshold: getSetting("CANCELLATION_ALERT_THRESHOLD_PERCENT"), subscriptionsExpiringSoon: expiringSoonCount, blockedPayments24h, pendingRefundRequests, underfilledEventsPending },
    analyticsEnabled: getSetting("ANALYTICS_ENABLED")
  };
});
// Protection anti-injection de formule (C36, OWASP CSV injection) : un champ commençant par
// = + - @ est neutralisé par une apostrophe, aussi bien pour le CSV que pour l'Excel généré.
const csvSafe = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value;
const salesRowsForRange = async (since: Date, until: Date) => {
  const payments = await prisma.payment.findMany({
    where: { status: PaymentStatus.SUCCEEDED, paidAt: { gte: since, lte: until } },
    include: { reservation: { include: { user: true, event: true } } },
    orderBy: { paidAt: "asc" }
  });
  return payments.map(p => ({ date: p.paidAt!, event: csvSafe(p.reservation.event.title), participant: csvSafe(p.reservation.user.displayName), amount: p.amountCents / 100 }));
};
// Export CSV des ventes sur la période (C36) : ligne par vente, jamais de données personnelles
// au-delà du nom affiché déjà visible ailleurs dans l'administration, protégé contre les formules.
app.get("/admin/stats/export.csv", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const query = z.object({ since: z.string().optional(), until: z.string().optional() }).parse(request.query);
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 30 * 86_400_000);
  const until = query.until ? new Date(query.until) : new Date();
  const rows = await salesRowsForRange(since, until);
  const lines = [["Date", "Événement", "Participant", "Montant (€)"].join(",")];
  for (const r of rows) lines.push([r.date.toISOString(), `"${r.event}"`, `"${r.participant}"`, r.amount.toFixed(2)].join(","));
  reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="ventes-${since.toISOString().slice(0, 10)}-${until.toISOString().slice(0, 10)}.csv"`);
  return lines.join("\n");
});
// Export Excel complet (C36) : contrairement au CSV, plusieurs feuilles — ventes, abonnements,
// événements, blog — pour répondre à « un CSV des seules ventes n'est pas l'export complet attendu ».
app.get("/admin/stats/export.xlsx", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const query = z.object({ since: z.string().optional(), until: z.string().optional() }).parse(request.query);
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 30 * 86_400_000);
  const until = query.until ? new Date(query.until) : new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nūr Meet";
  const salesSheet = workbook.addWorksheet("Ventes");
  salesSheet.addRow(["Date", "Événement", "Participant", "Montant (€)"]);
  for (const r of await salesRowsForRange(since, until)) salesSheet.addRow([r.date, r.event, r.participant, r.amount]);
  salesSheet.getColumn(1).width = 22; salesSheet.getColumn(2).width = 35; salesSheet.getColumn(3).width = 25;

  const subs = await prisma.restaurantSubscription.findMany({ where: { createdAt: { gte: since, lte: until } }, include: { restaurant: true, plan: true } });
  const subsSheet = workbook.addWorksheet("Abonnements");
  subsSheet.addRow(["Établissement", "Formule", "Statut", "Période", "Début", "Échéance"]);
  for (const s of subs) subsSheet.addRow([csvSafe(s.restaurant.name), s.plan.name, s.status, s.billingPeriod, s.currentPeriodStart, s.currentPeriodEnd]);
  subsSheet.getColumn(1).width = 30;

  const events = await prisma.event.findMany({ where: { createdAt: { gte: since, lte: until } }, include: { controllerRestaurant: true, _count: { select: { applications: true, reservations: { where: { confirmedAt: { not: null }, cancelledAt: null } } } } } });
  const eventsSheet = workbook.addWorksheet("Événements");
  eventsSheet.addRow(["Titre", "Catégorie", "Statut", "Restaurateur", "Capacité", "Candidatures", "Confirmées", "Taux de remplissage"]);
  for (const e of events) eventsSheet.addRow([csvSafe(e.title), e.category, e.status, e.controllerRestaurant ? csvSafe(e.controllerRestaurant.name) : "Nūr Meet", e.capacity, e._count.applications, e._count.reservations, e.capacity > 0 ? `${Math.round((e._count.reservations / e.capacity) * 100)}%` : "—"]);
  eventsSheet.getColumn(1).width = 35;

  const articles = await prisma.article.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: since, lte: until } } });
  const blogSheet = workbook.addWorksheet("Blog");
  blogSheet.addRow(["Titre", "Catégorie", "Publié le"]);
  for (const a of articles) blogSheet.addRow([csvSafe(a.title), a.category, a.publishedAt]);
  blogSheet.getColumn(1).width = 40;

  const buffer = await workbook.xlsx.writeBuffer();
  reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", `attachment; filename="statistiques-${since.toISOString().slice(0, 10)}-${until.toISOString().slice(0, 10)}.xlsx"`);
  return reply.send(Buffer.from(buffer));
});
