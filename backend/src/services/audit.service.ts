import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type {
  ActivityItem,
  AuditItem,
  AuditListResponse,
  UserRole,
} from "@sih26265/contracts";
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
 *
 * Never store passwords, tokens, session ids or raw request payloads here.
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

// ---------------------------------------------------------------------------
// Read models (audit view + dashboard activity)
// ---------------------------------------------------------------------------

/** Keys of `detail` that are safe to render in the audit view. */
const DETAIL_SAFE_KEYS = [
  "note",
  "title",
  "message",
  "context",
  "state",
  "stage",
  "status",
  "role",
  "publicCode",
  "code",
  "name",
  "versionNo",
  "fromVersion",
  "toVersion",
  "fields",
  "changedFields",
  "count",
  "institutions",
  "institutionCode",
  "outcome",
  "reason",
] as const;

export interface ListAuditOptions {
  page: number;
  pageSize: number;
  q?: string;
  action?: string;
  entityType?: string;
  actorId?: number;
  fdrId?: number;
  institutionId?: number;
  from?: string;
  to?: string;
}

export async function listAuditEvents(
  viewer: { role: UserRole; institutionIds: number[]; isGlobal: boolean },
  opts: ListAuditOptions,
): Promise<AuditListResponse> {
  const conditions: Prisma.AuditEventWhereInput[] = [];

  if (!viewer.isGlobal) {
    conditions.push({
      OR: [
        { institutionId: { in: viewer.institutionIds } },
        { fdr: { institutionId: { in: viewer.institutionIds } } },
      ],
    });
  }

  if (opts.action != null && opts.action.length > 0) {
    // Prefix search keeps drill-downs simple (AUTH_, CASE_, ADMIN_, ...).
    conditions.push({ action: { contains: opts.action, mode: "insensitive" as Prisma.QueryMode } });
  }

  if (opts.entityType != null && opts.entityType.length > 0) {
    conditions.push({ entityType: opts.entityType });
  }

  if (opts.actorId != null) {
    conditions.push({ actorUserId: opts.actorId });
  }

  if (opts.fdrId != null) {
    conditions.push({ fdrId: opts.fdrId });
  }

  if (opts.institutionId != null) {
    if (viewer.isGlobal || viewer.institutionIds.includes(opts.institutionId)) {
      conditions.push({ OR: [{ institutionId: opts.institutionId }, { fdr: { institutionId: opts.institutionId } }] });
    } else {
      // Non-admins may not filter outside their scope; keep the separator clean.
      conditions.push({ institutionId: -1 });
    }
  }

  if (opts.from != null && opts.to != null && opts.from.length === 10 && opts.to.length === 10) {
    conditions.push({ createdAt: { gte: new Date(`${opts.from}T00:00:00.000Z`), lte: new Date(`${opts.to}T23:59:59.999Z`) } });
  }

  if (opts.q != null && opts.q.length > 0) {
    // Free text searches actor names and entity ids only.
    conditions.push({
      OR: [
        { actor: { fullName: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode } } },
        { fdr: { publicCode: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode } } },
        { entityId: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode } },
      ],
    });
  }

  const where: Prisma.AuditEventWhereInput = { AND: conditions };

  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: {
        actor: { select: { id: true, fullName: true, role: true } },
        institution: { select: { name: true } },
        fdr: { select: { publicCode: true, institutionId: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  const items = rows.map((row) => serializeAuditItem(row));
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

type AuditEventRow = Prisma.AuditEventGetPayload<{
  include: {
    actor: { select: { id: true; fullName: true; role: true } };
    institution: { select: { name: true } };
    fdr: { select: { publicCode: true; institutionId: true } };
  };
}>;

export function serializeAuditItem(row: AuditEventRow): AuditItem {
  return {
    id: row.id.toString(),
    action: row.action,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    actorName: row.actor?.fullName ?? null,
    actorRole: row.actor?.role ?? null,
    institutionName: row.institution?.name ?? null,
    fdrPublicCode: row.fdr?.publicCode ?? null,
    summary: summarizeDetail(row.action, row.detail),
    createdAt: row.createdAt.toISOString(),
  };
}

function summarizeDetail(action: string, detail: unknown): string {
  const headline = AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, " ").toLowerCase();
  if (detail == null || typeof detail !== "object") return headline;
  const record = detail as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of DETAIL_SAFE_KEYS) {
    const value = record[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue; // lists are rendered only when non-empty
      parts.push(`${key}: ${value.slice(0, 6).map((entry) => String(entry)).join(", ")}`);
      continue;
    }
    parts.push(`${key}: ${String(value).slice(0, 160)}`);
  }
  if (parts.length === 0) return headline;
  return `${headline} - ${parts.join("; ")}`;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  AUTH_LOGIN_SUCCESS: "Signed in",
  AUTH_LOGIN_FAILED: "Sign-in failed",
  AUTH_LOGIN_PORTAL_REJECTED: "Sign-in rejected for the wrong entry point",
  AUTH_LOGOUT: "Signed out",
  AUTH_SESSION_EXPIRED: "Session expired",
  AUTH_PASSWORD_CHANGED: "Password changed",
  CASE_DRAFT_CREATED: "Draft created",
  CASE_DRAFT_UPDATED: "Draft updated",
  CASE_SUBMITTED: "Submitted for review",
  REVIEW_STARTED: "Review started",
  CHECK_RECORDED: "Evidence check recorded",
  CASE_VERIFIED: "Case verified",
  CORRECTION_REQUESTED: "Correction requested",
  CORRECTION_RESPONDED: "Correction response recorded (new version)",
  CORRECTION_CANCELLED: "Correction cancelled",
  RELEASE_REQUESTED: "Release requested",
  RELEASE_RECOMMENDED: "Release recommended",
  RELEASE_RECOMMENDATION_WITHDRAWN: "Release recommendation withdrawn",
  RELEASE_DECIDED: "Release decision recorded",
  RELEASE_COMPLETED: "Release completion evidence recorded",
  REPLACEMENT_SUBMITTED: "Replacement submitted",
  REPLACEMENT_RECOMMENDED: "Replacement recommended for acceptance",
  REPLACEMENT_ACCEPTED: "Replacement accepted (superseding link established)",
  REPLACEMENT_REJECTED: "Replacement rejected",
  ADMIN_INSTITUTION_CREATED: "College created",
  ADMIN_INSTITUTION_UPDATED: "College record updated",
  ADMIN_INSTITUTION_STATUS_CHANGED: "College activation changed",
  ADMIN_ASSIGNMENT_CHANGED: "Officer assignment changed",
  ADMIN_ACCOUNT_PROVISIONED: "Account provisioned",
  ADMIN_ACCOUNT_STATUS_CHANGED: "Account activated or deactivated",
  ADMIN_PASSWORD_RESET: "Temporary password issued",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_DOWNLOADED: "Document downloaded",
  SEED_DEMO_DATA: "Demo dataset re-asserted",
  JOB_REMINDERS: "Deadline reminders processed",
};

/** Dashboard-friendly activity rows in the viewer's scope. */
export async function recentActivity(
  viewer: { role: UserRole; institutionIds: number[]; isGlobal: boolean },
  limit: number,
): Promise<ActivityItem[]> {
  const where: Prisma.AuditEventWhereInput = viewer.isGlobal
    ? {}
    : {
        OR: [
          { institutionId: { in: viewer.institutionIds } },
          { fdr: { institutionId: { in: viewer.institutionIds } } },
        ],
      };

  const rows = await prisma.auditEvent.findMany({
    where,
    include: {
      actor: { select: { fullName: true } },
      institution: { select: { name: true } },
      fdr: { select: { id: true, publicCode: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => {
    const summary = summarizeDetail(row.action, row.detail);
    const item: ActivityItem = {
      id: row.id.toString(),
      actionLabel: row.action,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      summary,
      linkPath: row.fdrId != null ? `/cases/${row.fdrId}` : null,
      actorName: row.actor?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
    };
    return item;
  });
}

/** Recorded workflow history for one case (Activity tab; same safe labels). */
export async function caseActivity(fdrId: number, limit: number): Promise<ActivityItem[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { fdrId },
    include: { actor: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id.toString(),
    actionLabel: AUDIT_ACTION_LABELS[row.action] ?? row.action.replace(/_/g, " ").toLowerCase(),
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    summary: summarizeDetail(row.action, row.detail),
    linkPath: null,
    actorName: row.actor?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
