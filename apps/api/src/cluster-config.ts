import os from "node:os";
import { env } from "./env.js";

// One worker per CPU core in production so the API isn't limited to a single thread
// under load; dev/test keep a single process for simple debugging and fast reload.
// Shared between cluster-entry.ts (how many workers to fork) and index.ts (how to
// size each worker's Prisma pool, and which single worker owns the setInterval
// background jobs) so the three never drift apart.
export const workerCount = env.NODE_ENV === "production" ? Math.max(1, os.cpus().length) : 1;
