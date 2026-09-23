import { UserRole } from "@prisma/client";
import { z } from "zod";
import { app, prisma } from "../context.js";
import { audit } from "../services/audit.js";
import { auth, currentId, roles } from "../services/auth.js";
import { SETTINGS_SCHEMA, getSetting, listSettingsForAdmin, updateSetting } from "../settings.js";

app.get("/admin/outbox", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.outboxMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));

// Paramètres applicatifs centralisés (voir settings.ts) : valeurs provisoires du cahier des charges,
// modifiables sans redéploiement, jamais en dur ailleurs dans le code.
// Contenu éditorial public (§16) : distinct de /admin/settings (réservé à l'administration), ne
// renvoie que les trois clés nécessaires à la page « Le concept ».
app.get("/concept-video", async () => ({ url: getSetting("CONCEPT_VIDEO_URL"), thumbnail: getSetting("CONCEPT_VIDEO_THUMBNAIL_URL"), subtitles: getSetting("CONCEPT_VIDEO_SUBTITLES_URL") }));
app.get("/admin/settings", { preHandler: roles(UserRole.ADMIN) }, async () => listSettingsForAdmin());
app.patch("/admin/settings/:key", { preHandler: roles(UserRole.ADMIN) }, async (request, _reply) => {
  const { key } = z.object({ key: z.enum(Object.keys(SETTINGS_SCHEMA) as [string, ...string[]]) }).parse(request.params);
  const { value } = z.object({ value: z.unknown() }).parse(request.body);
  const updated = await updateSetting(prisma, key as keyof typeof SETTINGS_SCHEMA, value, currentId(request));
  await audit(currentId(request), "UPDATE_APP_SETTING", "AppSetting", key, { value: updated });
  return { key, value: updated };
});

// Témoignages (§17) : jamais publiés automatiquement, même soumis par un participant — un
// administrateur doit explicitement passer le statut à PUBLISHED.
app.get("/testimonials", async (request) => {
  const query = z.object({ eventType: z.string().optional() }).parse(request.query);
  return prisma.testimonial.findMany({ where: { status: "PUBLISHED", eventType: query.eventType }, orderBy: [{ position: "asc" }, { createdAt: "desc" }] });
});
app.post("/me/testimonials", { preHandler: auth }, async (request, reply) => {
  const input = z.object({ eventType: z.string().min(2).max(60), text: z.string().min(10).max(1000), rating: z.number().int().min(1).max(5).optional(), consentGiven: z.literal(true) }).parse(request.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentId(request) } });
  const testimonial = await prisma.testimonial.create({ data: { displayName: user.displayName, eventType: input.eventType, text: input.text, rating: input.rating, consentGiven: input.consentGiven, submittedByUserId: user.id, status: "DRAFT" } });
  await audit(user.id, "SUBMIT_TESTIMONIAL", "Testimonial", testimonial.id);
  return reply.code(201).send(testimonial);
});
app.get("/admin/testimonials", { preHandler: roles(UserRole.ADMIN) }, async () => prisma.testimonial.findMany({ orderBy: [{ position: "asc" }, { createdAt: "desc" }] }));
app.post("/admin/testimonials", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object({ displayName: z.string().min(2).max(80), eventType: z.string().min(2).max(60), text: z.string().min(10).max(1000), rating: z.number().int().min(1).max(5).optional(), status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"), position: z.number().int().default(0), consentGiven: z.boolean().default(true) }).parse(request.body);
  const testimonial = await prisma.testimonial.create({ data: input });
  await audit(currentId(request), "CREATE_TESTIMONIAL", "Testimonial", testimonial.id);
  return reply.code(201).send(testimonial);
});
app.patch("/admin/testimonials/:id", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ displayName: z.string().min(2).max(80).optional(), eventType: z.string().min(2).max(60).optional(), text: z.string().min(10).max(1000).optional(), rating: z.number().int().min(1).max(5).nullable().optional(), status: z.enum(["DRAFT", "PUBLISHED"]).optional(), position: z.number().int().optional() }).parse(request.body);
  const updated = await prisma.testimonial.update({ where: { id }, data: input });
  await audit(currentId(request), "UPDATE_TESTIMONIAL", "Testimonial", id, input);
  return updated;
});
app.delete("/admin/testimonials/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await prisma.testimonial.delete({ where: { id } });
  await audit(currentId(request), "DELETE_TESTIMONIAL", "Testimonial", id);
  return reply.code(204).send();
});
