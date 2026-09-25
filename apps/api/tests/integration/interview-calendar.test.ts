// Calendrier des entretiens ouvert par défaut (décision v2 §11) et actions « modifier » / « annuler »
// distinctes (v2 §12). Chaque test travaille sur un jour qui lui est propre, loin dans le futur, pour ne
// jamais dépendre de l'heure à laquelle la suite tourne.
import { addDays, parisDayKey, parisTime } from "@nour/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminToken, api, deleteTestUsers, ensureServerRunning, prisma, testPhone } from "./helpers.js";

const createdUserIds: string[] = [];
const createdBlockIds: string[] = [];
const createdCallIds: string[] = [];
beforeAll(ensureServerRunning);
afterAll(async () => {
  await prisma.interviewBlock.deleteMany({ where: { id: { in: createdBlockIds } } });
  await prisma.screeningCall.deleteMany({ where: { id: { in: createdCallIds } } });
  await prisma.screeningCall.deleteMany({ where: { application: { userId: { in: createdUserIds } } } });
  await deleteTestUsers(createdUserIds);
});

// Un jour différent par test (+ un décalage aléatoire) : aucune collision entre tests ni entre exécutions.
const runOffset = 60 + Math.floor(Math.random() * 200);
const dayFor = (n: number) => addDays(parisDayKey(new Date()), runOffset + n);
const at = (day: string, hhmm: string) => parisTime(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))).toISOString();
const slotsOf = async (day: string, token: string) => (await api<{ id: string; startsAt: string }[]>(`/interview-slots?from=${day}&days=1`, {}, token)).body.map(s => s.id);

async function applicant(displayName: string) {
  const phone = testPhone();
  await api("/auth/request-otp", { method: "POST", body: JSON.stringify({ phone }) });
  const { body } = await api<{ token: string }>("/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, code: "123456", displayName }) });
  await api("/me/profile", { method: "PATCH", body: JSON.stringify({ birthDate: "1995-01-01", acceptCgu: true, displayName, city: "Paris", interests: [] }) }, body.token);
  const { body: me } = await api<{ id: string }>("/me", {}, body.token);
  createdUserIds.push(me.id);
  const { body: interview } = await api<{ id: string }>("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Motivation suffisamment longue pour passer la validation du formulaire." }) }, body.token);
  return { token: body.token, userId: me.id, interviewId: interview.id };
}
const schedule = (who: { token: string; interviewId: string }, startsAt: string) =>
  api<{ slot: { id: string; startsAt: string } }>(`/applications/${who.interviewId}/schedule`, { method: "POST", body: JSON.stringify({ startsAt }) }, who.token);
async function block(body: Record<string, unknown>) {
  const res = await api<{ created: number; conflicts: { startsAt: string }[] }>("/admin/interview-blocks", { method: "POST", body: JSON.stringify(body) }, await adminToken());
  const blocks = await prisma.interviewBlock.findMany({ where: { createdAt: { gt: new Date(Date.now() - 60_000) } }, select: { id: true } });
  createdBlockIds.push(...blocks.map(b => b.id));
  return res;
}

describe("calendrier ouvert par défaut (v2 §11)", () => {
  it("propose 48 créneaux de 15 minutes de 10h à 22h (heure de Paris), sans aucun créneau créé à la main", async () => {
    const { token } = await applicant("CalendrierDefaut");
    const day = dayFor(0);
    const slots = await slotsOf(day, token);
    expect(slots).toHaveLength(48);
    expect(slots[0]).toBe(at(day, "10:00"));
    expect(slots.at(-1)).toBe(at(day, "21:45"));
  });

  it("ne propose jamais de créneau passé et refuse un horaire hors grille", async () => {
    const who = await applicant("CalendrierGrille");
    const today = parisDayKey(new Date());
    for (const id of await slotsOf(today, who.token)) expect(new Date(id).getTime()).toBeGreaterThan(Date.now());
    const day = dayFor(1);
    expect((await schedule(who, at(day, "10:07"))).status).toBe(400);
    expect((await schedule(who, at(day, "22:00"))).status).toBe(400);
    expect((await schedule(who, at(day, "09:45"))).status).toBe(400);
    expect((await schedule(who, new Date(Date.now() - 86_400_000).toISOString())).status).toBeGreaterThanOrEqual(400);
  });

  it("l’administration ferme une journée, des heures ou certains jours d’une période, puis rouvre", async () => {
    const { token } = await applicant("CalendrierBlocage");
    const [d1, d2] = [dayFor(2), dayFor(3)];
    expect((await block({ startDate: d1, endDate: d1 })).status).toBe(201);
    expect(await slotsOf(d1, token)).toHaveLength(0);

    expect((await block({ startDate: d2, endDate: d2, startTime: "12:00", endTime: "14:00" })).status).toBe(201);
    const partial = await slotsOf(d2, token);
    expect(partial).toHaveLength(40);
    expect(partial).not.toContain(at(d2, "12:00"));
    expect(partial).not.toContain(at(d2, "13:45"));
    expect(partial).toContain(at(d2, "14:00"));

    // Tous les dimanches d'une période de trois semaines : une ligne par dimanche, rien d'autre de fermé.
    const start = dayFor(10), end = addDays(start, 20);
    const res = await block({ startDate: start, endDate: end, weekdays: [0] });
    expect(res.body.created).toBe(3);
    const week = (await api<{ id: string; startsAt: string }[]>(`/interview-slots?from=${start}&days=21`, {}, token)).body;
    const sundays = week.filter(s => new Date(new Date(s.startsAt).toLocaleString("en-US", { timeZone: "Europe/Paris" })).getDay() === 0);
    expect(sundays).toHaveLength(0);
    expect(week).toHaveLength(18 * 48);

    const admin = await adminToken();
    const blockRow = await prisma.interviewBlock.findFirstOrThrow({ where: { id: { in: createdBlockIds }, startsAt: new Date(at(d1, "00:00")) } });
    expect((await api(`/admin/interview-blocks/${blockRow.id}`, { method: "DELETE" }, admin)).status).toBe(204);
    expect(await slotsOf(d1, token)).toHaveLength(48);
  });

  it("un rendez-vous déjà réservé (ancien système) reste la source de vérité et est signalé, jamais déplacé", async () => {
    const who = await applicant("CalendrierAncien");
    const day = dayFor(4);
    // Rendez-vous hérité, hors grille (10h05–10h20) : il occupe les créneaux de 10h et 10h15.
    const legacy = await prisma.screeningCall.create({ data: { applicationId: who.interviewId, startsAt: new Date(at(day, "10:05")), endsAt: new Date(new Date(at(day, "10:05")).getTime() + 15 * 60_000) } });
    createdCallIds.push(legacy.id);
    await prisma.application.update({ where: { id: who.interviewId }, data: { status: "CALL_SCHEDULED" } });
    const slots = await slotsOf(day, who.token);
    expect(slots).not.toContain(at(day, "10:00"));
    expect(slots).not.toContain(at(day, "10:15"));
    expect(slots).toContain(at(day, "10:30"));

    const res = await block({ startDate: day, endDate: day });
    expect(res.body.conflicts).toHaveLength(1);
    const kept = await prisma.screeningCall.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(kept.applicationId).toBe(who.interviewId);
    expect(kept.startsAt.toISOString()).toBe(at(day, "10:05"));
  });

  it("deux réservations simultanées du même créneau : une seule réussit", async () => {
    const [a, b] = await Promise.all([applicant("CalendrierConcA"), applicant("CalendrierConcB")]);
    const startsAt = at(dayFor(5), "15:00");
    const results = await Promise.all([schedule(a, startsAt), schedule(b, startsAt)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.screeningCall.count({ where: { startsAt: new Date(startsAt), applicationId: { not: null } } })).toBe(1);
    expect(await slotsOf(dayFor(5), a.token)).not.toContain(startsAt);
  });
});

describe("modifier ou annuler son entretien (v2 §12)", () => {
  it("« Modifier mon créneau » déplace le rendez-vous de façon atomique et libère l’ancien seulement après", async () => {
    const who = await applicant("EntretienDeplace");
    const other = await applicant("EntretienDeplaceAutre");
    const day = dayFor(6);
    expect((await schedule(who, at(day, "11:00"))).status).toBe(200);
    expect((await schedule(other, at(day, "12:00"))).status).toBe(200);

    // Vers un créneau déjà pris : refus, et l'ancien rendez-vous est intact.
    const refused = await api("/me/global-interview/reschedule", { method: "POST", body: JSON.stringify({ startsAt: at(day, "12:00") }) }, who.token);
    expect(refused.status).toBe(409);
    const still = await prisma.screeningCall.findUniqueOrThrow({ where: { applicationId: who.interviewId } });
    expect(still.startsAt.toISOString()).toBe(at(day, "11:00"));

    const moved = await api<{ slot: { startsAt: string } }>("/me/global-interview/reschedule", { method: "POST", body: JSON.stringify({ startsAt: at(day, "16:30") }) }, who.token);
    expect(moved.status).toBe(200);
    const after = await prisma.screeningCall.findUniqueOrThrow({ where: { applicationId: who.interviewId } });
    expect(after.startsAt.toISOString()).toBe(at(day, "16:30"));
    const application = await prisma.application.findUniqueOrThrow({ where: { id: who.interviewId } });
    expect(application.status).toBe("CALL_SCHEDULED");
    const slots = await slotsOf(day, who.token);
    expect(slots).toContain(at(day, "11:00"));
    expect(slots).not.toContain(at(day, "16:30"));
    expect(await prisma.notification.count({ where: { userId: who.userId, title: "Entretien déplacé" } })).toBe(1);
  });

  it("l’administration reprogramme aussi par horaire, et refuse un créneau déjà pris", async () => {
    const who = await applicant("EntretienAdmin");
    const other = await applicant("EntretienAdminAutre");
    const day = dayFor(7);
    await schedule(who, at(day, "10:00"));
    await schedule(other, at(day, "10:15"));
    const admin = await adminToken();
    expect((await api(`/admin/global-interviews/${who.interviewId}/reschedule`, { method: "POST", body: JSON.stringify({ startsAt: at(day, "10:15") }) }, admin)).status).toBe(409);
    expect((await prisma.screeningCall.findUniqueOrThrow({ where: { applicationId: who.interviewId } })).startsAt.toISOString()).toBe(at(day, "10:00"));
    expect((await api(`/admin/global-interviews/${who.interviewId}/reschedule`, { method: "POST", body: JSON.stringify({ startsAt: at(day, "18:00") }) }, admin)).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: who.userId, title: "Entretien reprogrammé" } })).toBe(1);
  });

  it("« Annuler ma demande d’entretien » libère le créneau et permet une nouvelle demande", async () => {
    const who = await applicant("EntretienAnnule");
    const day = dayFor(8);
    await schedule(who, at(day, "20:00"));
    expect(await slotsOf(day, who.token)).not.toContain(at(day, "20:00"));
    expect((await api(`/me/applications/${who.interviewId}/cancel`, { method: "POST" }, who.token)).status).toBe(200);
    expect(await slotsOf(day, who.token)).toContain(at(day, "20:00"));
    expect((await api<{ status: string }>("/me/global-interview", {}, who.token)).body.status).toBe("CANCELLED");
    const again = await api("/me/global-interview", { method: "POST", body: JSON.stringify({ motivation: "Nouvelle demande après annulation, motivation assez longue." }) }, who.token);
    expect(again.status).toBe(201);
  });
});
