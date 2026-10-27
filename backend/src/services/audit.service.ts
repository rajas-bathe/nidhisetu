import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { logger } from "../logger.js";

const LogActionSchema = z.enum([
  "AUTH_LOGIN_SUCCESS",
  "AUTH_LOGIN_FAILED",
  "AUTH_LOGIN_PORTAL_REJECTED",
  "AUTH_LOGOUT",
  "AUTH_SESSION_EXPIRED",
]);

export type AuditLogAction = z.infer<typeof LogActionSchema>;

export interface AuditRecordInput {
  action: string;
  actorUserId?: number | null;
  institutionId?: number | null;
  fdrId?: number | null;
  entityType?: string | null;
  entityId?: string | number | null;
  detail?: Record<string, unknown> | null;
  requestIp?: string | null;
  correlationId?: string | null;
}

/**
 * Appends an audit event. Audit writes are never failures for the caller: if
 * the insert fails we log loudly and continue, because blocking the user on an
 * auditing glitch would break the transactional flows further.
 */
export async function recordAudit(input: AuditRecordInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId ?? undefined,
        institutionId: input.institutionId ?? undefined,
        fdrId: input.fdrId ?? undefined,
        entityType: input.entityType ?? undefined,
        entityId:
          input.entityId == null ? undefined : typeof input.entityId === "number"
            ? String(input.entityId)
            : input.entityId,
        detail: input.detail == null ? undefined : (input.detail as Prisma.InputJsonValue),
        requestIp: input.requestIp ?? undefined,
        correlationId: input.correlationId ?? undefined,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action }, "audit_event_write_failed");
  }
}
