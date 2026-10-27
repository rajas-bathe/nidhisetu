/**
 * Release request lifecycle.
 *
 * College request (reason + SAMPLE evidence category) -> reviewing officer
 * recommends or rejects (note required on reject) -> approving authority
 * approves or rejects (note required on reject) -> separate completion step
 * records the EXTERNAL completion evidence. An approval alone never marks a
 * release as completed. Duplicate open requests per case are prevented inside
 * a serializable transaction. When a correction response creates a new case
 * version, recommended-but-undecided requests are withdrawn automatically so
 * no stale recommendation is decided on outdated facts.
 */
import type { ReleaseItem, ReleaseListResponse, WorkflowResult } from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { businessToday } from "../utils/dates.js";
import { rupeesToMinorUnits } from "../utils/money.js";
import {
  RELEASE_COMPLETION_EVIDENCE_TYPES,
  RELEASE_REQUEST_EVIDENCE_TYPES,
} from "../rules/checkFields.js";
import { serializeRelease } from "../dto/serialize.js";
import { createNotifications } from "./notification.service.js";
import { assertOfficerCapability, getAccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

const RELEASE_LIFECYCLE_NOTE = "SAMPLE policy: an approved release still needs recorded completion evidence.";

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface ListReleasesOptions {
  page: number;
  pageSize: number;
  fdrId?: number;
  institutionId?: number;
  stage?: "open" | "recommended" | "decided" | "approved" | "completed";
}

function stageCondition(stage: NonNullable<ListReleasesOptions["stage"]>): Prisma.ReleaseRequestWhereInput {
  switch (stage) {
    case "open":
      return { status: "OPEN" };
    case "recommended":
      return { status: "OPEN", decision: "recommended" };
    case "decided":
      return { status: "DECIDED" };
    case "approved":
      return { status: "DECIDED", decision: "approved" };
    case "completed":
      return { status: "DECIDED", decision: "completed" };
  }
}

export async function listReleases(
  user: AuthenticatedUser,
  opts: ListReleasesOptions,
): Promise<ReleaseListResponse> {
  const scope = await getAccessScope(user);
  const conditions: Prisma.ReleaseRequestWhereInput[] = [];

  if (!scope.isGlobal) {
    conditions.push({ fdr: { institutionId: { in: scope.institutionIds } } });
  }
  if (opts.fdrId != null) {
    conditions.push(
      scope.isGlobal || scope.institutionIds.length === 0
        ? { fdrId: opts.fdrId }
        : { fdrId: opts.fdrId, fdr: { institutionId: { in: scope.institutionIds } } },
    );
  }
  if (opts.institutionId != null) {
    if (!scope.isGlobal && !scope.institutionIds.includes(opts.institutionId)) {
      throw forbidden("This institution is outside your assigned scope.");
    }
    conditions.push({ fdr: { institutionId: opts.institutionId } });
  }
  if (opts.stage != null) {
    conditions.push(stageCondition(opts.stage));
  }

  const where: Prisma.ReleaseRequestWhereInput = { AND: conditions };
  const [rows, total] = await Promise.all([
    prisma.releaseRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: Math.min(opts.pageSize, 50),
      include: {
        requestedBy: { select: { fullName: true } },
        recommendedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
        completedBy: { select: { fullName: true } },
        fdr: {
          select: {
            id: true,
            publicCode: true,
            institutionId: true,
            institution: { select: { name: true } },
          },
        },
      },
    }),
    prisma.releaseRequest.count({ where }),
  ]);

  return {
    items: rows.map(serializeRelease) as ReleaseItem[],
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Creation (college)
// ---------------------------------------------------------------------------

export async function createReleaseRequest(
  user: AuthenticatedUser,
  input: {
    fdrId: number;
    reason: string;
    evidenceType: string;
    evidenceRef: string;
  },
): Promise<WorkflowResult> {
  if (user.role !== "COLLEGE_USER" || user.institutionId == null) {
    throw forbidden("Only the college representative can request releases.");
  }

  const fdr = await prisma.fdr.findFirst({
    where: { id: input.fdrId, institutionId: user.institutionId },
    select: { id: true, publicCode: true, status: true, supersededByFdrId: true },
  });
  if (fdr == null) throw notFound("The case does not exist.");
  if (fdr.supersededByFdrId != null) {
    throw conflict("This instrument is already replaced; its funds cannot be released here.");
  }
  if (fdr.status !== "verified") {
    throw conflict("Only verified instruments can request a release.");
  }

  if (!RELEASE_REQUEST_EVIDENCE_TYPES.includes(input.evidenceType as never)) {
    throw validationError(
      { evidenceType: ["Choose an evidence category accepted for release requests (SAMPLE categories)."] },
      "The release request needs attention.",
    );
  }

  // Serializable duplicate guard: two concurrent submissions must yield one
  // request (and one 409, not two rows).
  await prisma.$transaction(
    async (tx) => {
      const openExisting = await tx.releaseRequest.findFirst({
        where: { fdrId: fdr.id, status: "OPEN" },
        select: { id: true },
      });
      if (openExisting != null) {
        throw conflict("There is already an open release request for this instrument.");
      }

      const approvedNotCompleted = await tx.releaseRequest.findFirst({
        where: { fdrId: fdr.id, status: "DECIDED", decision: "approved", completedAt: null },
        select: { id: true },
      });
      if (approvedNotCompleted != null) {
        throw conflict(
          "A release has already been approved for this instrument; completion evidence is pending.",
        );
      }

      const officerRows = await tx.officerJurisdiction.findMany({
        where: { institutionId: user.institutionId!, role: "REVIEW_OFFICER" },
        select: { officerId: true },
      });

      const created = await tx.releaseRequest.create({
        data: {
          fdrId: fdr.id,
          requestedByUserId: user.id,
          reason: input.reason,
          evidenceType: input.evidenceType,
          evidenceRef: input.evidenceRef.length > 0 ? input.evidenceRef : null,
          status: "OPEN",
          decision: "requested",
          policyVersion: "sample-v0.1",
        },
        select: { id: true },
      });

      const today = businessToday();
      if (officerRows.length > 0) {
        await tx.task.createMany({
          data: officerRows.map((officer) => ({
            fdrId: fdr.id,
            type: "RELEASE_RECOMMENDED" as const,
            title: `Recommend release for ${fdr.publicCode}`,
            detail: "Assess the reason and evidence, then recommend or reject the release.",
            status: "OPEN" as const,
            assigneeUserId: officer.officerId,
            dueDate: new Date(`${addDaysFrom(today, 4)}T00:00:00.000Z`),
            deduplicationKey: `REL:${created.id}:${officer.officerId}`,
            policyVersion: "sample-v0.1",
          })),
          skipDuplicates: true,
        });
      }

      await tx.auditEvent.create({
        data: {
          action: "RELEASE_REQUESTED",
          actorUserId: user.id,
          institutionId: user.institutionId!,
          fdrId: fdr.id,
          entityType: "release_request",
          entityId: String(created.id),
          detail: { publicCode: fdr.publicCode, note: `${input.evidenceType}` },
        },
      });

      return created;
    },
    { isolationLevel: "Serializable" },
  );

  await createNotifications([
    {
      institutionId: user.institutionId,
      title: `Release request created for ${fdr.publicCode}`,
      body: RELEASE_LIFECYCLE_NOTE,
      linkPath: `/cases/${fdr.id}`,
    },
  ]);

  return { fdrId: fdr.id, message: "Release request created; the reviewing officer will assess it." };
}

// ---------------------------------------------------------------------------
// Recommendation / decision / completion
// ---------------------------------------------------------------------------

export async function actOnRelease(
  user: AuthenticatedUser,
  input: { releaseId: number; action: "recommend" | "reject" | "approve"; note: string },
): Promise<WorkflowResult> {
  const selectShape = {
    id: true,
    fdrId: true,
    status: true,
    decision: true,
    decisionStage: true,
    recommendationNote: true,
    reason: true,
  } as const;

  const release = await prisma.releaseRequest.findUnique({
    where: { id: input.releaseId },
    select: selectShape,
  });
  if (release == null) throw notFound("The release request does not exist.");

  const fdr = await prisma.fdr.findUnique({
    where: { id: release.fdrId },
    select: { id: true, publicCode: true, institutionId: true, status: true },
  });
  if (fdr == null) throw notFound("The case for this release no longer exists.");

  const now = new Date();

  if (input.action === "recommend") {
    if (user.role !== "REVIEW_OFFICER") {
      throw forbidden("Only the reviewing officer can recommend a release.");
    }
    await assertOfficerCapability(user, fdr.institutionId, "REVIEW_OFFICER");
    if (release.status !== "OPEN") throw conflict("This request is already decided.");
    if (release.decision === "recommended") {
      throw conflict("The release is already recommended and waits for the approving authority.");
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.releaseRequest.updateMany({
        where: { id: release.id, status: "OPEN", decision: { not: "recommended" } },
        data: {
          recommendedById: user.id,
          recommendationNote: input.note.length > 0 ? input.note : null,
          decision: "recommended",
          updatedAt: now,
        },
      });
      if (claimed.count === 0) {
        throw conflict("The release request changed on the server; reload and try again.");
      }

      const authorityRows = await tx.officerJurisdiction.findMany({
        where: { institutionId: fdr.institutionId, role: "APPROVING_AUTHORITY" },
        select: { officerId: true },
      });
      if (authorityRows.length > 0) {
        await tx.task.createMany({
          data: authorityRows.map((officer) => ({
            fdrId: fdr.id,
            type: "RELEASE_DECISION" as const,
            title: `Decide release for ${fdr.publicCode}`,
            detail: "Approve or reject the recommended release (with a reason on rejection).",
            status: "OPEN" as const,
            assigneeUserId: officer.officerId,
            dueDate: new Date(`${addDaysFrom(businessToday(), 3)}T00:00:00.000Z`),
            deduplicationKey: `REL:${release.id}:${officer.officerId}`,
            policyVersion: "sample-v0.1",
          })),
          skipDuplicates: true,
        });
      }

      await tx.task.updateMany({
        where: {
          fdrId: fdr.id,
          type: "RELEASE_RECOMMENDED",
          status: { in: ["OPEN", "IN_PROGRESS"] },
          deduplicationKey: { startsWith: `REL:${release.id}` },
        },
        data: { status: "DONE", closedAt: now, closedNote: "Recommendation recorded." },
      });

      await tx.auditEvent.create({
        data: {
          action: "RELEASE_RECOMMENDED",
          actorUserId: user.id,
          institutionId: fdr.institutionId,
          fdrId: fdr.id,
          entityType: "release_request",
          entityId: String(release.id),
          detail: { publicCode: fdr.publicCode, note: input.note.length > 0 ? input.note : "recommended" },
        },
      });
    });

    await createNotifications([
      {
        institutionId: fdr.institutionId,
        title: `Release recommended for ${fdr.publicCode}`,
        body: "The reviewing officer recommended the release; the approving authority will decide.",
        linkPath: `/cases/${fdr.id}`,
      },
    ]);

    return { fdrId: fdr.id, message: "Release recommended; awaiting the approving authority's decision." };
  }

  if (input.action === "approve") {
    if (user.role !== "APPROVING_AUTHORITY") {
      throw forbidden("Only the approving authority can approve a release.");
    }
    await assertOfficerCapability(user, fdr.institutionId, "APPROVING_AUTHORITY");
    if (release.status !== "OPEN" || release.decision !== "recommended") {
      throw conflict("Only recommended releases can be approved.");
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.releaseRequest.updateMany({
        where: { id: release.id, status: "OPEN", decision: "recommended" },
        data: {
          status: "DECIDED",
          decision: "approved",
          decisionStage: "approving_authority",
          decidedById: user.id,
          decisionNote: input.note.length > 0 ? input.note : null,
          decidedAt: now,
          updatedAt: now,
        },
      });
      if (claimed.count === 0) {
        throw conflict("The release request changed on the server; reload and try again.");
      }

      await tx.task.updateMany({
        where: {
          fdrId: fdr.id,
          type: "RELEASE_DECISION",
          status: { in: ["OPEN", "IN_PROGRESS"] },
          deduplicationKey: { startsWith: `REL:${release.id}` },
        },
        data: { status: "DONE", closedAt: now, closedNote: "Release approved." },
      });

      await tx.auditEvent.create({
        data: {
          action: "RELEASE_DECIDED",
          actorUserId: user.id,
          institutionId: fdr.institutionId,
          fdrId: fdr.id,
          entityType: "release_request",
          entityId: String(release.id),
          detail: { publicCode: fdr.publicCode, outcome: "approved", note: input.note.length > 0 ? input.note : "approved" },
        },
      });
    });

    await createNotifications([
      {
        institutionId: fdr.institutionId,
        title: `Release approved for ${fdr.publicCode}`,
        body: RELEASE_LIFECYCLE_NOTE,
        linkPath: `/cases/${fdr.id}`,
      },
    ]);

    return { fdrId: fdr.id, message: "Release approved; completion evidence still has to be recorded." };
  }

  // reject
  const reason = input.note.trim();
  const rejecter = user.role === "APPROVING_AUTHORITY"
    ? "APPROVING_AUTHORITY"
    : user.role === "REVIEW_OFFICER"
      ? "REVIEW_OFFICER"
      : null;
  if (rejecter == null) {
    throw forbidden("Only assigned officers can reject a release request.");
  }
  await assertOfficerCapability(user, fdr.institutionId, rejecter);
  if (reason.length < 5) {
    throw validationError({ note: ["A rejection requires a short reason."] }, "The rejection needs attention.");
  }

  const isAuthorityReject = user.role === "APPROVING_AUTHORITY";
  const allowedPrior = isAuthorityReject
    ? { status: "OPEN" as const, decision: "recommended" as const }
    : { status: "OPEN" as const };

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.releaseRequest.updateMany({
      where: { id: release.id, ...allowedPrior },
      data: {
        status: "DECIDED",
        decision: "rejected",
        decisionStage: isAuthorityReject ? "approving_authority" : "reviewing_officer",
        decidedById: user.id,
        decisionNote: reason,
        decidedAt: now,
        updatedAt: now,
      },
    });
    if (claimed.count === 0) {
      throw conflict("The release request changed on the server; reload and try again.");
    }

    await tx.task.updateMany({
      where: {
        fdrId: fdr.id,
        type: { in: ["RELEASE_RECOMMENDED", "RELEASE_DECISION"] },
        status: { in: ["OPEN", "IN_PROGRESS"] },
        deduplicationKey: { startsWith: `REL:${release.id}` },
      },
      data: { status: "CANCELLED", closedAt: now, closedNote: `Release rejected: ${reason}` },
    });

    await tx.auditEvent.create({
      data: {
        action: "RELEASE_DECIDED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "release_request",
        entityId: String(release.id),
        detail: { publicCode: fdr.publicCode, outcome: "rejected", reason },
      },
    });
  });

  await createNotifications([
    {
      institutionId: fdr.institutionId,
      title: `Release rejected for ${fdr.publicCode}`,
      body: `Reason: ${reason}`,
      linkPath: `/cases/${fdr.id}`,
    },
  ]);

  return { fdrId: fdr.id, message: "Release request rejected." };
}

// ---------------------------------------------------------------------------
// Completion (records external evidence; never executes payments)
// ---------------------------------------------------------------------------

export async function completeRelease(
  user: AuthenticatedUser,
  input: {
    releaseId: number;
    evidenceType: string;
    evidenceRef: string;
    evidenceDate: string;
    completedAmountRupees: string;
    note: string;
  },
): Promise<WorkflowResult> {
  const release = await prisma.releaseRequest.findUnique({
    where: { id: input.releaseId },
    select: { id: true, fdrId: true, status: true, decision: true },
  });
  if (release == null) throw notFound("The release request does not exist.");

  const fdr = await prisma.fdr.findUnique({
    where: { id: release.fdrId },
    select: { id: true, publicCode: true, institutionId: true },
  });
  if (fdr == null) throw notFound("The case for this release no longer exists.");

  const canComplete =
    (user.role === "REVIEW_OFFICER" || user.role === "APPROVING_AUTHORITY");
  if (!canComplete) {
    throw forbidden("Only assigned officers can record completion evidence.");
  }
  const capability = user.role === "REVIEW_OFFICER" ? "REVIEW_OFFICER" : "APPROVING_AUTHORITY";
  await assertOfficerCapability(user, fdr.institutionId, capability);

  if (release.status !== "DECIDED" || release.decision !== "approved") {
    throw conflict("Completion evidence can only be recorded for an approved release.");
  }

  const fieldErrors: Record<string, string[]> = {};
  if (!RELEASE_COMPLETION_EVIDENCE_TYPES.includes(input.evidenceType as never)) {
    fieldErrors.evidenceType = [
      "Choose a completion evidence category (SAMPLE: bank refund confirmation, bank advice/letter or other document).",
    ];
  }
  if (input.evidenceRef.trim().length === 0) {
    fieldErrors.evidenceRef = ["The evidence reference is required."];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.evidenceDate)) {
    fieldErrors.evidenceDate = ["Use the YYYY-MM-DD date format."];
  }
  let completedAmountMinor: bigint | null = null;
  if (input.completedAmountRupees.length > 0) {
    const minor = rupeesToMinorUnits(input.completedAmountRupees);
    if (minor == null) {
      fieldErrors.completedAmountRupees = ["Enter the amount in rupees, at most two decimal places."];
    } else if (minor <= 0n) {
      fieldErrors.completedAmountRupees = ["The amount must be greater than zero."];
    } else {
      completedAmountMinor = minor;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The completion record needs attention.");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.releaseRequest.updateMany({
      where: { id: release.id, status: "DECIDED", decision: "approved", completedAt: null },
      data: {
        decision: "completed",
        decisionStage: "approving_authority",
        completedById: user.id,
        completedAt: now,
        completionEvidenceType: input.evidenceType,
        completionEvidenceRef: input.evidenceRef.trim(),
        completionEvidenceDate: new Date(`${input.evidenceDate}T00:00:00.000Z`),
        completedAmountMinor,
        completionNote: input.note.length > 0 ? input.note : null,
        updatedAt: now,
      },
    });
    if (claimed.count === 0) {
      throw conflict("The release was completed on the server; reload and try again.");
    }

    await tx.auditEvent.create({
      data: {
        action: "RELEASE_COMPLETED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "release_request",
        entityId: String(release.id),
        detail: {
          publicCode: fdr.publicCode,
          evidenceType: input.evidenceType,
          evidenceRef: input.evidenceRef.trim(),
        },
      },
    });
  });

  await createNotifications([
    {
      institutionId: fdr.institutionId,
      title: `Release completed for ${fdr.publicCode}`,
      body: "Completion evidence was recorded by the assigned officer (recorded, not executed, by the portal).",
      linkPath: `/cases/${fdr.id}`,
    },
  ]);

  return { fdrId: fdr.id, message: "Release completion evidence recorded." };
}

// ---------------------------------------------------------------------------
// Withdrawal helper (called after a correction response created a new version)
// ---------------------------------------------------------------------------

/** Withdraws recommended-but-not-decided releases when case facts change. */
export async function withdrawStaleRecommendationsInTx(
  tx: Prisma.TransactionClient,
  fdrId: number,
  reason: string,
): Promise<void> {
  const withdrawn = await tx.releaseRequest.updateMany({
    where: { fdrId, status: "OPEN", decision: "recommended" },
    data: {
      status: "DECIDED",
      decision: "rejected",
      decisionStage: "reviewing_officer",
      decidedAt: new Date(),
      decisionNote: reason,
      updatedAt: new Date(),
    },
  });
  if (withdrawn.count > 0) {
    await tx.task.updateMany({
      where: {
        fdrId,
        type: "RELEASE_DECISION",
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      data: { status: "CANCELLED", closedAt: new Date(), closedNote: reason },
    });
    const releaseIds = await tx.releaseRequest.findMany({
      where: { fdrId },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        action: "RELEASE_RECOMMENDATION_WITHDRAWN",
        entityType: "release_request",
        entityId: releaseIds.length > 0 ? String(releaseIds[0]!.id) : null,
        detail: { count: withdrawn.count, reason },
      },
    });
  }
}

function addDaysFrom(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
