// Point d'entrée de l'API : context (Sentry, Prisma, Fastify, fournisseurs) → plugins (CORS, JWT,
// rate-limit, gestion d'erreurs) → routes → tâches de fond → écoute. Chaque fichier de routes/
// enregistre ses routes sur `app` au moment de son import ; la logique partagée entre plusieurs
// routes vit dans services/.
//
// Imports DYNAMIQUES attendus un par un, jamais de simples `import "./x.js"` : plusieurs de ces
// modules contiennent un await au niveau racine (app.register…), et des imports statiques frères
// ne s'attendent PAS entre eux dans ce cas — des routes seraient alors enregistrées avant le
// gestionnaire d'erreurs ou le rate-limit (constaté : ZodError renvoyée en 500 au lieu de 400).
import { app, prisma } from "./context.js";
import { env } from "./env.js";
import { loadSettings, watchSettings } from "./settings.js";

await import("./plugins.js");
await import("./routes/public.js");
await import("./routes/auth.js");
await import("./routes/me.js");
await import("./routes/events.js");
await import("./routes/applications.js");
await import("./routes/payments.js");
await import("./routes/social.js");
await import("./routes/restaurants.js");
await import("./routes/admin-team.js");
await import("./routes/admin-stats.js");
await import("./routes/admin-interviews.js");
await import("./routes/admin-events.js");
await import("./routes/admin-finance.js");
await import("./routes/admin-content.js");
await import("./routes/articles.js");
await import("./jobs.js");

const close = async () => { await prisma.$disconnect(); await app.close(); };
process.on("SIGINT", close); process.on("SIGTERM", close);
await loadSettings(prisma);
watchSettings(prisma, err => app.log.error(err));
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
