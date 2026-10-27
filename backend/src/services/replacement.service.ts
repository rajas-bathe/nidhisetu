/**
 * Replacement (renewal) workflow.
 *
 * The college attaches a new instrument to a matured/approaching old one and
 * submits it like any case. When the reviewing officer verifies the case, the
 * approving authority can ACCEPT it: acceptance is the ONLY operation that
 * establishes supersession (previous.supersededByFdrId = new.id) and closes
 * the old instrument's renewal obligation — atomically. Rejection cancels the
 * acceptance tasks and records the reason. Multiple concurrent acceptances are
 * prevented by a conditional update on the previous row inside the
 * transaction (affected 0 => somebody accepted first).
 */
import type { ReplacementDecisionRequest, ReplacementPendingItem, WorkflowResult } from "@sih26265/contracts";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound } from "../errors.js";
import { businessToday } from "../utils/dates.js";
import { createNotifications } from "./notification.service.js";
import { assertOfficerCapability } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

// ---------------------------------------------------------------------------
// Listing (officer drill-down)
// ---------------------------------------------------------------------------

export interface ListReplacementOptions {
  page: number;
  pageSize: number;
}

export async function listReplacements(
  user: AuthenticatedUser,
  opts: ListReplacementOptions,
): Promise<{ items: ReplacementPendingItem[]; total: number; page: number; pageSize: number }> {
  if (user.role === "COLLEGE_USER") {
    throw forbidden("Replacement queues are available to officers only.");
  }
  const scope = await prisma.officerJurisdiction.findMany({
    where: { officerId: user.id },
    select: { institutionId: true },
  });
  const ids = Array.from(new Set(scope.map((row) => row.institutionId)));
  if (ids.length === 0) {
    return { items: [], total: 0, page: opts.page, pageSize: opts.pageSize };
  }

  const rows = await prisma.fdr.findMany({
    where: { institutionId: { in: ids }, previousFdrId: { not: null } },
    orderBy: { updatedAt: "desc" },
    skip: (opts.page - 1) * opts.pageSize,
    take: Math.min(opts.pageSize, 50),
    include: {
      replaces: { select: { id: true, publicCode: true, status: true, supersededByFdrId: true, supersededAt: true } },
      institution: { select: { name: true } },
    },
  });
  const total = await prisma.fdr.count({
    where: { institutionId: { in: ids }, previousFdrId: { not: null } },
  });

  const items: ReplacementPendingItem[] = rows.map((row) => {
    const previous = row.replaces;
    let stage: ReplacementPendingItem["stage"];
    if (previous != null && previous.supersededByFdrId === row.id) {
      stage = "accepted";
    } else if (row.status === "verified" && previous != null && previous.supersededByFdrId == null) {
      stage = "recommended";
    } else if (row.status === "verified" && previous != null && previous.supersededByFdrId != null) {
      stage = "rejected";
    } else {
      stage = "review";
    }
    return {
      fdrId: row.id,
      fdrPublicCode: row.publicCode,
      institutionName: row.institution?.name ?? "",
      status: row.status,
      previousFdrId: previous?.id ?? row.previousFdrId!,
      previousPublicCode: previous?.publicCode ?? "",
      previousStatus: previous?.status ?? "verified",
      submittedAt: row.submittedAt?.toISOString() ?? null,
      stage,
    };
  });

  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

// ---------------------------------------------------------------------------
// Recommendation (reviewing officer)
// ---------------------------------------------------------------------------

export async function recommendReplacement(user: AuthenticatedUser, fdrId: number, note: string): Promise<WorkflowResult> {
  const fdr = await prisma.fdr.findUnique({
    where: { id: fdrId },
    select: {
      id: true,
      publicCode: true,
      status: true,
      institutionId: true,
      previousFdrId: true,
    },
  });
  if (fdr == null) throw notFound("The case does not exist.");
  if (user.role !== "REVIEW_OFFICER") {
    throw forbidden("Only the reviewing officer can recommend a replacement for acceptance.");
  }
  await assertOfficerCapability(user, fdr.institutionId, "REVIEW_OFFICER");
  if (fdr.previousFdrId == null) {
    throw conflict("This case is not a replacement of another instrument.");
  }
  if (fdr.status !== "verified") {
    throw conflict("Only verified replacements can be recommended for acceptance.");
  }

  const previous = await prisma.fdr.findUnique({
    where: { id: fdr.previousFdrId },
    select: { id: true, publicCode: true, institutionId: true, supersededByFdrId: true },
  });
  if (previous == null) {
    throw conflict("The previous instrument no longer exists.");
  }
  if (previous.institutionId !== fdr.institutionId) {
    throw conflict("The replacement must belong to the same institution as the previous instrument.");
  }
  if (previous.supersededByFdrId != null) {
    throw conflict("The previous instrument was already superseded; acceptance is no longer possible.");
  }

  const authorityRows = await prisma.officerJurisdiction.findMany({
    where: { institutionId: fdr.institutionId, role: "APPROVING_AUTHORITY" },
    select: { officerId: true },
  });

  const today = businessToday();

  await prisma.$transaction(async (tx) => {
    if (authorityRows.length > 0) {
      await tx.task.createMany({
        data: authorityRows.map((officer) => ({
          fdrId: fdr.id,
          type: "REPLACEMENT_ACCEPTANCE" as const,
          title: `Accept replacement ${fdr.publicCode}`,
          detail: note.length > 0 ? `${note} (replaces ${previous.publicCode})` : `Verified replacement of ${previous.publicCode} awaits acceptance.`,
          status: "OPEN" as const,
          assigneeUserId: officer.officerId,
          dueDate: new Date(`${dueDateFrom(today, 3)}T00:00:00.000Z`),
          deduplicationKey: `REPLACC:${fdr.id}:${officer.officerId}`,
          policyVersion: "sample-v0.1",
        })),
        skipDuplicates: true,
      });
    } else {
      await tx.task.createMany({
        data: [
          {
            fdrId: fdr.id,
            type: "REPLACEMENT_ACCEPTANCE" as const,
            title: `Accept replacement ${fdr.publicCode}`,
            detail: "No approving authority assigned yet; an administrator can assign one.",
            status: "OPEN" as const,
            assigneeUserId: null,
            assigneeInstitutionId: fdr.institutionId,
            dueDate: new Date(`${dueDateFrom(today, 3)}T00:00:00.000Z`),
            deduplicationKey: `REPLACC:${fdr.id}`,
            policyVersion: "sample-v0.1",
          },
        ],
        skipDuplicates: true,
      });
    }

    await tx.auditEvent.create({
      data: {
        action: "REPLACEMENT_RECOMMENDED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "fdr",
        entityId: String(fdr.id),
        detail: {
          publicCode: fdr.publicCode,
          note: note.length > 0 ? note : `Recommended for acceptance (replaces ${previous.publicCode})`,
        },
      },
    });
  });

  await createNotifications(
    authorityRows.map((officer) => ({
      userId: officer.officerId,
      title: `Replacement awaiting acceptance: ${fdr.publicCode}`,
      body: `Recommended replacement of ${previous.publicCode}.`,
      linkPath: `/cases/${fdr.id}`,
    })),
  );

  return { fdrId: fdr.id, message: "Replacement recommended for acceptance." };
}

// ---------------------------------------------------------------------------
// Acceptance (approving authority) — the ONLY supersession-establishing step
// ---------------------------------------------------------------------------

export async function acceptReplacement(user: AuthenticatedUser, input: ReplacementDecisionRequest): Promise<WorkflowResult> {
  const fdr = await prisma.fdr.findUnique({
    where: { id: input.fdrId },
    select: { id: true, publicCode: true, status: true, institutionId: true, previousFdrId: true },
  });
  if (fdr == null) throw notFound("The case does not exist.");

  if (user.role !== "APPROVING_AUTHORITY") {
    throw forbidden("Only the approving authority can accept a replacement.");
  }
  await assertOfficerCapability(user, fdr.institutionId, "APPROVING_AUTHORITY");
  if (fdr.previousFdrId == null) throw notFound("This case is not a replacement.");
  if (fdr.status !== "verified") {
    throw conflict("Only verified replacements can be accepted.");
  }

  const previous = await prisma.fdr.findUnique({
    where: { id: fdr.previousFdrId },
    select: { id: true, publicCode: true, institutionId: true, supersededByFdrId: true },
  });
  if (previous == null) throw conflict("The previous instrument no longer exists.");
  if (previous.institutionId !== fdr.institutionId) {
    throw conflict("Cross-institution replacement requests are not compatible.");
  }
  if (previous.supersededByFdrId != null) {
    throw conflict(
      previous.supersededByFdrId === fdr.id
        ? "This replacement was already accepted."
        : "Another accepted replacement already supersedes the previous instrument.",
    );
  }

  const acceptedAt = new Date();
  await prisma.$transaction(async (tx) => {
    // Conditional update: establishes supersession or detects the concurrent
    // acceptance (affected 0 => someone accepted first).
    const claimed = await tx.fdr.updateMany({
      where: { id: previous.id, supersededByFdrId: null },
      data: { supersededByFdrId: fdr.id, supersededAt: acceptedAt },
    });
    if (claimed.count === 0) {
      throw conflict("Another accepted replacement already supersedes the previous instrument.");
    }

    await tx.task.updateMany({
      where: {
        fdrId: fdr.id,
        type: "REPLACEMENT_ACCEPTANCE",
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      data: { status: "DONE", closedAt: acceptedAt, closedNote: "Replacement accepted by the approving authority." },
    });

    // The accepted replacement closes the old instrument's renewal obligation.
    await tx.task.updateMany({
      where: {
        fdrId: previous.id,
        type: "RENEWAL_AFTER_MATURITY",
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      data: { status: "DONE", closedAt: acceptedAt, closedNote: `Renewal obligation closed by accepted replacement ${fdr.publicCode}.` },
    });

    await tx.auditEvent.create({
      data: {
        action: "REPLACEMENT_ACCEPTED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "fdr",
        entityId: String(fdr.id),
        detail: {
          publicCode: fdr.publicCode,
          note: `Supersedes ${previous.publicCode}`,
        },
      },
    });
  });

  await createNotifications([
    {
      institutionId: fdr.institutionId,
      title: `Replacement accepted: ${fdr.publicCode}`,
      body: `${fdr.publicCode} now supersedes ${previous.publicCode}; the renewal obligation is closed.`,
      linkPath: `/cases/${fdr.id}`,
    },
  ]);

  return { fdrId: fdr.id, message: `${fdr.publicCode} supersedes ${previous.publicCode}.` };
}

// ---------------------------------------------------------------------------
// Rejection (approving authority)
// ---------------------------------------------------------------------------

export async function rejectReplacement(user: AuthenticatedUser, input: ReplacementDecisionRequest): Promise<WorkflowResult> {
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) {
    throw conflict("A rejection requires a short reason.");
  }

  const fdr = await prisma.fdr.findUnique({
    where: { id: input.fdrId },
    select: { id: true, publicCode: true, status: true, institutionId: true, previousFdrId: true },
  });
  if (fdr == null) throw notFound("The case does not exist.");

  if (user.role !== "APPROVING_AUTHORITY") {
    throw forbidden("Only the approving authority can reject a replacement.");
  }
  await assertOfficerCapability(user, fdr.institutionId, "APPROVING_AUTHORITY");

  const rejectedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.task.updateMany({
      where: {
        fdrId: fdr.id,
        type: "REPLACEMENT_ACCEPTANCE",
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      data: { status: "CANCELLED", closedAt: rejectedAt, closedNote: `Rejected: ${reason}` },
    });
    if (cancelled.count === 0) {
      throw conflict("There is no pending acceptance for this replacement.");
    }
    await tx.auditEvent.create({
      data: {
        action: "REPLACEMENT_REJECTED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "fdr",
        entityId: String(fdr.id),
        detail: { publicCode: fdr.publicCode, reason },
      },
    });
  });

  await createNotifications([
    {
      institutionId: fdr.institutionId,
      title: `Replacement rejected: ${fdr.publicCode}`,
      body: `The approving authority rejected the replacement: ${reason}`,
      linkPath: `/cases/${fdr.id}`,
    },
  ]);

  return { fdrId: fdr.id, message: "Replacement rejected; the previous instrument remains open." };
}

/** Task list view for the case workspace (replacementAcceptance subset). */
function dueDateFrom(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
