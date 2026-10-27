/**
 * Approving-authority queue: verified replacements awaiting acceptance and
 * recommended releases awaiting decision, within the authority's jurisdictions.
 */
import type { ApprovalItem, ApprovalQueueResponse } from "@sih26265/contracts";
import { prisma } from "../db/client.js";
import { forbidden } from "../errors.js";
import { businessToday } from "../utils/dates.js";
import { getAccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

export interface ListApprovalsOptions {
  page: number;
  pageSize: number;
  kind?: "replacement_acceptance" | "release_decision";
  includeDecided?: boolean;
}

export async function listApprovalQueue(
  user: AuthenticatedUser,
  opts: ListApprovalsOptions,
): Promise<ApprovalQueueResponse> {
  if (user.role !== "APPROVING_AUTHORITY" && user.role !== "SYSTEM_ADMIN") {
    throw forbidden("Only the approving authority can view the decision queue.");
  }
  const scope = await getAccessScope(user);
  const today = businessToday();

  const items: ApprovalItem[] = [];

  if (scope.isGlobal || scope.institutionIds.length > 0) {
    const institutionWhere = scope.isGlobal ? {} : { institutionId: { in: scope.institutionIds } };

    if (opts.kind == null || opts.kind === "replacement_acceptance") {
      const rows = await prisma.fdr.findMany({
        where: {
          ...institutionWhere,
          previousFdrId: { not: null },
          status: "verified",
        },
        include: {
          replaces: { select: { id: true, publicCode: true, supersededByFdrId: true } },
          institution: { select: { name: true } },
        },
        orderBy: { verifiedAt: "desc" },
        take: opts.includeDecided === true ? 100 : 40,
      });
      for (const row of rows) {
        const accepted = row.replaces != null && row.replaces.supersededByFdrId === row.id;
        if (accepted && opts.includeDecided !== true) continue;
        if (!accepted && row.replaces != null && row.replaces.supersededByFdrId != null) continue;
        items.push({
          kind: "replacement_acceptance",
          id: row.id,
          fdrId: row.id,
          fdrPublicCode: row.publicCode,
          institutionName: row.institution?.name ?? "",
          stage: accepted ? "Accepted" : "Verified replacement awaiting acceptance",
          detail: row.replaces != null ? `Would supersede ${row.replaces.publicCode}.` : null,
          openedAt: row.verifiedAt?.toISOString() ?? row.updatedAt.toISOString(),
          dueDate: null,
          isOverdue: false,
        });
      }
    }

    if (opts.kind == null || opts.kind === "release_decision") {
      const rows = await prisma.releaseRequest.findMany({
        where: {
          ...institutionWhere,
          ...(
            opts.includeDecided === true
              ? {}
              : { status: "OPEN", decision: "recommended" }
          ),
        },
        include: {
          fdr: { select: { publicCode: true, institutionId: true, institution: { select: { name: true } } } },
        },
        orderBy: { updatedAt: "desc" },
        take: 40,
      });
      for (const row of rows) {
        const dueTask = await prisma.task.findFirst({
          where: { fdrId: row.fdrId, type: "RELEASE_DECISION", assigneeUserId: user.id, status: "OPEN" },
          orderBy: { dueDate: "asc" },
          select: { dueDate: true },
        });
        items.push({
          kind: "release_decision",
          id: row.id,
          fdrId: row.fdrId,
          fdrPublicCode: row.fdr.publicCode,
          institutionName: row.fdr.institution?.name ?? "",
          stage:
            row.status === "OPEN" && row.decision === "recommended"
              ? "Recommended release awaiting decision"
              : `Decided: ${row.decision ?? "none"}`,
          detail: row.reason.length > 160 ? `${row.reason.slice(0, 157)}...` : row.reason,
          openedAt: row.updatedAt.toISOString(),
          dueDate: dueTask ? dueTask.dueDate.toISOString().slice(0, 10) : null,
          isOverdue: dueTask != null && dueTask.dueDate.toISOString().slice(0, 10) < today,
        });
      }
    }
  }

  items.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0;
  });

  const start = (opts.page - 1) * opts.pageSize;
  const pageItems = items.slice(start, start + opts.pageSize);
  return { items: pageItems, total: items.length, page: opts.page, pageSize: opts.pageSize };
}
