import cluster from "node:cluster";
import { workerCount } from "./cluster-config.js";
import { SETTINGS_CHANGED_MESSAGE } from "./settings.js";

// index.ts itself is untouched: every worker runs the exact same full bootstrap
// (mkdir calls, Fastify setup, app.listen, the setInterval background jobs — each
// job checks ownsBackgroundJobs() before registering, so it still runs exactly once
// across the whole cluster). The primary process here never imports index.ts at all,
// so it never opens a Prisma connection or an HTTP listener of its own.
if (cluster.isPrimary && workerCount > 1) {
  for (let i = 0; i < workerCount; i++) cluster.fork();

  // Un réglage modifié par un worker est relayé à tous les autres (voir watchSettings, settings.ts).
  cluster.on("message", (sender, message) => {
    if ((message as { type?: string } | null)?.type !== SETTINGS_CHANGED_MESSAGE) return;
    for (const worker of Object.values(cluster.workers ?? {})) if (worker && worker.id !== sender.id) worker.send(message);
  });

  let shuttingDown = false;
  cluster.on("exit", (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(`Worker ${worker.process.pid} exited (code=${code}, signal=${signal}) — restarting`);
    cluster.fork();
  });

  // Forward shutdown to every worker via the cluster API (not a raw external signal)
  // so each one disconnects its IPC channel cleanly before exiting.
  const shutdown = () => {
    shuttingDown = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  await import("./index.js");
}
