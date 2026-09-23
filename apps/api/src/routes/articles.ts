import { UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, aiProvider, app, articleUploadsDir, prisma } from "../context.js";
import { assertNoForbiddenWord, logArticleTransition } from "../services/articles.js";
import { audit } from "../services/audit.js";
import { currentId, roles } from "../services/auth.js";

app.get("/articles", async (request) => {
  const query = z.object({ category: z.string().optional(), keyword: z.string().optional(), q: z.string().optional() }).parse(request.query);
  return prisma.article.findMany({
    where: {
      status: "PUBLISHED", category: query.category, keywords: query.keyword ? { has: query.keyword } : undefined,
      OR: query.q ? [{ title: { contains: query.q, mode: "insensitive" } }, { excerpt: { contains: query.q, mode: "insensitive" } }] : undefined
    },
    orderBy: { publishedAt: "desc" }
  });
});
app.get("/articles/:slug", async (request, reply) => {
  const { slug } = z.object({ slug: z.string() }).parse(request.params);
  const article = await prisma.article.findFirst({ where: { slug, status: "PUBLISHED" }, include: { author: true } });
  if (!article) return reply.code(404).send({ error: "Article introuvable" });
  return article;
});

const articleWritableFields = {
  title: z.string().min(3).max(200), slug: z.string().regex(/^[a-z0-9-]+$/), excerpt: z.string().max(400).optional(),
  content: z.string().min(20), imageUrl: z.string().optional(), category: z.string().min(2).max(60),
  keywords: z.array(z.string()).max(10).default([]), metaTitle: z.string().max(70).optional(), metaDescription: z.string().max(160).optional()
};
app.get("/admin/articles", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const query = z.object({ status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]).optional() }).parse(request.query);
  return prisma.article.findMany({ where: { status: query.status }, include: { author: true }, orderBy: { updatedAt: "desc" } });
});
app.get("/admin/articles/:id", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return prisma.article.findUniqueOrThrow({ where: { id }, include: { author: true, reviewLogs: { orderBy: { createdAt: "desc" } } } });
});
app.post("/admin/articles", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const input = z.object(articleWritableFields).parse(request.body);
  assertNoForbiddenWord(input.title, input.excerpt, input.content, input.metaTitle, input.metaDescription);
  const article = await prisma.article.create({ data: { ...input, authorId: currentId(request) } });
  await audit(currentId(request), "CREATE_ARTICLE", "Article", article.id);
  return reply.code(201).send(article);
});
app.patch("/admin/articles/:id", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const input = z.object({ ...Object.fromEntries(Object.entries(articleWritableFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) }).parse(request.body);
  assertNoForbiddenWord(input.title, input.excerpt, input.content, input.metaTitle, input.metaDescription);
  const updated = await prisma.article.update({ where: { id }, data: input });
  await audit(currentId(request), "UPDATE_ARTICLE", "Article", id);
  return updated;
});
app.delete("/admin/articles/:id", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  await prisma.article.delete({ where: { id } });
  await audit(currentId(request), "DELETE_ARTICLE", "Article", id);
  return reply.code(204).send();
});
app.post("/admin/articles/:id/image", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Aucun fichier reçu" });
  const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!extension) return reply.code(415).send({ error: "Format non pris en charge (jpeg, png ou webp uniquement)" });
  const buffer = await file.toBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "Image trop volumineuse (5 Mo maximum)" });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(articleUploadsDir, filename), buffer);
  const updated = await prisma.article.update({ where: { id }, data: { imageUrl: `/static/uploads/articles/${filename}` } });
  await audit(currentId(request), "UPDATE_ARTICLE_IMAGE", "Article", id);
  return updated;
});

// Validation humaine obligatoire (§18) : chaque transition passe par une route dédiée et distincte,
// jamais un simple PATCH de statut, pour que le journal de validation reste toujours cohérent.
app.post("/admin/articles/:id/submit-for-review", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "DRAFT") return reply.code(409).send({ error: "Seul un brouillon peut être soumis à validation" });
  const updated = await prisma.article.update({ where: { id }, data: { status: "IN_REVIEW" } });
  await logArticleTransition(id, currentId(request), article.status, "IN_REVIEW");
  return updated;
});
app.post("/admin/articles/:id/decision", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { accept, note } = z.object({ accept: z.boolean(), note: z.string().max(1000).optional() }).parse(request.body);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "IN_REVIEW") return reply.code(409).send({ error: "Cet article n’est pas en attente de validation" });
  const nextStatus = accept ? "APPROVED" : "DRAFT";
  const updated = await prisma.article.update({ where: { id }, data: { status: nextStatus } });
  await logArticleTransition(id, currentId(request), article.status, nextStatus, note);
  return updated;
});
app.post("/admin/articles/:id/schedule", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const { publishAt } = z.object({ publishAt: z.string() }).parse(request.body);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "APPROVED") return reply.code(409).send({ error: "Seul un article déjà validé peut être programmé" });
  const updated = await prisma.article.update({ where: { id }, data: { scheduledAt: new Date(publishAt) } });
  await audit(currentId(request), "SCHEDULE_ARTICLE", "Article", id, { publishAt });
  return updated;
});
app.post("/admin/articles/:id/publish", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "APPROVED") return reply.code(409).send({ error: "Seul un article déjà validé peut être publié" });
  const updated = await prisma.article.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null } });
  await logArticleTransition(id, currentId(request), article.status, "PUBLISHED");
  return updated;
});
app.post("/admin/articles/:id/archive", { preHandler: roles(UserRole.ADMIN) }, async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  if (article.status !== "PUBLISHED") return reply.code(409).send({ error: "Seul un article publié peut être archivé" });
  const updated = await prisma.article.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  await logArticleTransition(id, currentId(request), article.status, "ARCHIVED");
  return updated;
});

// Génération IA de brouillons et de propositions sociales (§18) : toujours DRAFT, jamais publiée
// sans repasser par le circuit de validation ci-dessus.
app.post("/admin/articles/generate", { preHandler: roles(UserRole.ADMIN), config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const { topic, category } = z.object({ topic: z.string().min(3).max(200), category: z.string().min(2).max(60) }).parse(request.body);
  const draft = await aiProvider.generateDraft(topic, category);
  const slug = `${draft.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${randomUUID().slice(0, 6)}`;
  const article = await prisma.article.create({ data: { ...draft, slug, category, status: "DRAFT", aiGenerated: true, aiPrompt: topic, authorId: currentId(request) } });
  await audit(currentId(request), "GENERATE_ARTICLE_DRAFT", "Article", article.id, { topic, category });
  return reply.code(201).send(article);
});
app.post("/admin/articles/:id/social-copy", { preHandler: roles(UserRole.ADMIN) }, async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const article = await prisma.article.findUniqueOrThrow({ where: { id } });
  return aiProvider.generateSocialCopy(article);
});

app.get("/admin/articles/queue", { preHandler: roles(UserRole.ADMIN) }, async () => {
  const [count, next] = await Promise.all([
    prisma.articleQueueEntry.count(),
    prisma.articleQueueEntry.findMany({ orderBy: { position: "asc" }, take: 5, select: { title: true, category: true } })
  ]);
  return { count, next };
});
