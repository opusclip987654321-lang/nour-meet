import { prisma } from "../context.js";

export const audit = (actorId: string | undefined, action: string, entity: string, entityId?: string, metadata?: unknown) => prisma.auditLog.create({ data: { actorId, action, entity, entityId, metadata: metadata as object | undefined } });
