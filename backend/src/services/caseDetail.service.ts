/**
 * Case workspace aggregator. Builds the complete per-viewer case payload:
 * permissions (server-computed from role + jurisdiction + case state), the
 * persistent "Next action" block, the three deterministic readiness panels,
 * documents-independent tabs data (versions, checks, corrections, releases,
 * renewal links, tasks, activity).
 *
 * Access control: college accounts only ever see their own institution's
 * cases; officers only see cases in their assigned institutions; the
 * administrator ranges across all institutions for read purposes but is never
 * granted review/approval capabilities (they are computed false for admins).
 */
import type { ActivityItem, CaseDetail } from "@sih26265/contracts";
import type { NextAction as NextActionT } from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { notFound } from "../errors.js";
import { config } from "../config/env.js";
import { businessToday, toDateOnly } from "../utils/dates.js";
import { minorUnitsToRupeesLabel } from "../utils/money.js";
import { deriveDateCondition } from "../rules/dateCondition.js";
import {
  deriveReleaseStatus,
  serializeCheck,
  serializeTask,
  serializeVersion,
} from "../dto/serialize.js";
import {
  evaluateReleaseReadiness,
  evaluateReplacementReadiness,
  evaluateVerificationReadiness,
  type ReadinessInput,
} from "../rules/readiness.js";
import { hasOfficerCapability, getAccessScope, type AccessScope } from "./scope.service.js";
import { caseActivity } from "./audit.service.js";
import { buildCaseGuidance, type CaseGuidanceFacts, type CaseGuidanceResult } from "./caseGuidance.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

export type CaseDetailResult = CaseDetail;

const CASE_INCLUDE = {
  institution: { select: { id: true, code: true, name: true } },
  versions: {
    orderBy: { versionNo: "desc" as Prisma.SortOrder },
    include: { submittedBy: { select: { fullName: true } } },
  },
  checks: {
    orderBy: [{ checkedAt: "asc" as Prisma.SortOrder }, { id: "asc" as Prisma.SortOrder }],
    include: { checkedBy: { select: { fullName: true } } },
  },
  corrections: {
    orderBy: { createdAt: "desc" as Prisma.SortOrder },
    include: {
      requestedBy: { select: { fullName: true } },
      respondedBy: { select: { fullName: true } },
    },
  },
  releases: {
    orderBy: { createdAt: "desc" as Prisma.SortOrder },
    include: { requestedBy: { select: { fullName: true } } },
  },
  tasks: {
    orderBy: [{ dueDate: "asc" as Prisma.SortOrder }, { id: "asc" as Prisma.SortOrder }],
    include: { fdr: { select: { id: true, publicCode: true } } },
  },
  replaces: {
    select: {
      id: true,
      publicCode: true,
      maturityDate: true,
      amountMinor: true,
      status: true,
      supersededByFdrId: true,
      supersededAt: true,
    },
  },
  successors: { select: { id: true, publicCode: true, status: true } },
} satisfies Prisma.FdrInclude;

type CaseRow = Prisma.FdrGetPayload<{ include: typeof CASE_INCLUDE }>;

function fdrWhereFor(scope: AccessScope, fdrId: number): Prisma.FdrWhereInput {
  if (scope.isGlobal) return { id: fdrId };
  // Officers/colleges outside their scope get "not found" (never a 403 leak).
  return { id: fdrId, institutionId: { in: scope.institutionIds } };
}

async function loadCaseForViewer(user: AuthenticatedUser, fdrId: number): Promise<{ scope: AccessScope; fdr: CaseRow }> {
  const scope = await getAccessScope(user);
  const fdr = await prisma.fdr.findFirst({
    where: fdrWhereFor(scope, fdrId),
    include: CASE_INCLUDE,
  });
  if (fdr == null) throw notFound("The case does not exist or is outside your scope.");
  return { scope, fdr };
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

interface PermissionInputs {
  user: AuthenticatedUser;
  fdr: CaseRow;
  hasOpenCorrection: boolean;
  latestRelease: CaseRow["releases"][number] | null;
  previousNotSuperseded: boolean;
  verificationBlockers: number;
}

export async function computeCasePermissions(input: PermissionInputs): Promise<CaseDetail["permissions"]> {
  const { user, fdr, hasOpenCorrection, latestRelease, previousNotSuperseded, verificationBlockers } = input;
  const isCollege =
    user.role === "COLLEGE_USER" && user.institutionId != null && fdr.institutionId === user.institutionId;

  const [reviewCap, authorityCap] = await Promise.all([
    user.role === "REVIEW_OFFICER"
      ? hasOfficerCapability(user.id, fdr.institutionId, "REVIEW_OFFICER")
      : Promise.resolve(false),
    user.role === "APPROVING_AUTHORITY"
      ? hasOfficerCapability(user.id, fdr.institutionId, "APPROVING_AUTHORITY")
      : Promise.resolve(false),
  ]);

  const inReview = fdr.status === "submitted" || fdr.status === "under_review" || fdr.status === "discrepancy";
  const openRelease = latestRelease != null && latestRelease.status === "OPEN";
  const approvedPendingCompletion =
    latestRelease != null && latestRelease.status === "DECIDED" && latestRelease.decision === "approved" && latestRelease.completedAt == null;
  const notSuperseded = fdr.supersededByFdrId == null;

  return {
    canEditDraft: isCollege && fdr.status === "draft",
    canSubmit: isCollege && fdr.status === "draft",
    canUploadDocument: isCollege && fdr.status === "draft",
    canRespondCorrection:
      isCollege && hasOpenCorrection && (fdr.status === "under_review" || fdr.status === "discrepancy"),
    canStartReview: reviewCap && fdr.status === "submitted",
    canRecordCheck: reviewCap && inReview,
    canRequestCorrection: reviewCap && inReview,
    canVerify: reviewCap && inReview && verificationBlockers === 0,
    canRecommendReplacement: reviewCap && fdr.previousFdrId != null && previousNotSuperseded && fdr.status === "verified",
    canAcceptReplacement: authorityCap && fdr.previousFdrId != null && previousNotSuperseded && fdr.status === "verified",
    canRequestRelease:
      isCollege &&
      fdr.status === "verified" &&
      notSuperseded &&
      (latestRelease == null ||
        (latestRelease.status === "DECIDED" && latestRelease.decision !== "approved")),
    canDecideRelease:
      (reviewCap && openRelease && (latestRelease?.decision ?? null) !== "recommended") ||
      (authorityCap && openRelease && latestRelease?.decision === "recommended"),
    canCompleteRelease: (reviewCap || authorityCap) && approvedPendingCompletion,
  };
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

function nextActionFor(fdr: CaseRow, permissions: CaseDetail["permissions"], tasks: CaseRow["tasks"]): NextActionT | null {
  const earliestDue = (type: string): string | null => {
    const openRows = tasks.filter((task) => task.type === type && (task.status === "OPEN" || task.status === "IN_PROGRESS"));
    if (openRows.length === 0) return null;
    return toDateOnly(openRows[0]!.dueDate);
  };

  const previousOpen = fdr.replaces != null && fdr.replaces.supersededByFdrId == null;
  const hasOpenCorrection = fdr.corrections.some((row) => row.status === "OPEN");
  const latestRelease = fdr.releases[0] ?? null;

  if (fdr.supersededByFdrId != null) {
    return {
      stage: "replaced",
      responsible: "no further action",
      action: "An accepted replacement supersedes this instrument; it is kept for history only.",
      dueDate: null,
      actionAvailable: false,
      actionPath: null,
    };
  }

  switch (fdr.status) {
    case "draft":
      return {
        stage: "with the college",
        responsible: "College representative",
        action: "Complete the draft and submit it for review.",
        dueDate: null,
        actionAvailable: permissions.canSubmit,
        actionPath: permissions.canSubmit ? `/fdrs/${fdr.id}` : null,
      };
    case "submitted":
      return {
        stage: "with the reviewing officer",
        responsible: "Reviewing officer",
        action: "Start the review and record the evidence checks.",
        dueDate: earliestDue("VERIFICATION_REVIEW"),
        actionAvailable: permissions.canStartReview,
        actionPath: permissions.canStartReview ? `/fdrs/${fdr.id}/verification` : null,
      };
    case "under_review":
    case "discrepancy": {
      if (hasOpenCorrection) {
        return {
          stage: "awaiting the college's response",
          responsible: "College representative",
          action: "Respond to the open correction request(s) with corrected values.",
          dueDate: earliestDue("CORRECTION_REMINDER"),
          actionAvailable: permissions.canRespondCorrection,
          actionPath: permissions.canRespondCorrection ? `/fdrs/${fdr.id}` : null,
        };
      }
      return {
        stage: "with the reviewing officer",
        responsible: "Reviewing officer",
        action: "Record the remaining evidence checks, then verify the case.",
        dueDate: earliestDue("VERIFICATION_REVIEW"),
        actionAvailable: permissions.canRecordCheck || permissions.canVerify,
        actionPath: permissions.canRecordCheck || permissions.canVerify ? `/fdrs/${fdr.id}/verification` : null,
      };
    }
    case "verified": {
      if (fdr.previousFdrId != null && previousOpen) {
        return {
          stage: "awaiting the replacement decision",
          responsible: "Approving authority",
          action: "Accept or reject the verified replacement (accepting supersedes the earlier instrument).",
          dueDate: earliestDue("REPLACEMENT_ACCEPTANCE"),
          actionAvailable: permissions.canAcceptReplacement,
          actionPath: permissions.canAcceptReplacement ? `/fdrs/${fdr.id}` : null,
        };
      }
      if (latestRelease == null) {
        return {
          stage: "verified",
          responsible: "College representative",
          action: "Verified: a release may be requested if the instrument is being withdrawn (SAMPLE policy).",
          dueDate: null,
          actionAvailable: permissions.canRequestRelease,
          actionPath: permissions.canRequestRelease ? `/fdrs/${fdr.id}` : null,
        };
      }
      if (latestRelease.status === "OPEN") {
        if ((latestRelease.decision ?? null) === "recommended") {
          return {
            stage: "release awaiting the authority decision",
            responsible: "Approving authority",
            action: "Approve or reject the recommended release (a reason is required for rejection).",
            dueDate: earliestDue("RELEASE_DECISION"),
            actionAvailable: permissions.canDecideRelease,
            actionPath: null,
          };
        }
        return {
          stage: "release awaiting officer recommendation",
          responsible: "Reviewing officer",
          action: "Recommend or reject the release request.",
          dueDate: earliestDue("RELEASE_RECOMMENDED"),
          actionAvailable: permissions.canDecideRelease,
          actionPath: null,
        };
      }
      if (
        latestRelease.status === "DECIDED" &&
        latestRelease.decision === "approved" &&
        latestRelease.completedAt == null
      ) {
        return {
          stage: "release approved, completion pending",
          responsible: "Assigned officer",
          action: "Record the external completion evidence; approval alone does not complete the release.",
          dueDate: null,
          actionAvailable: permissions.canCompleteRelease,
          actionPath: null,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Readiness panels
// ---------------------------------------------------------------------------

async function readinessInputFor(fdr: CaseRow): Promise<ReadinessInput> {
  const today = businessToday();
  const documentCount = await prisma.document.count({ where: { fdrId: fdr.id, supersededById: null } });
  const openCorrections = fdr.corrections.filter((row) => row.status === "OPEN").length;
  const latestRelease = fdr.releases[0] ?? null;

  const previousRow = fdr.replaces;
  const institutionStatus =
    (await prisma.institution.findUnique({ where: { id: fdr.institutionId }, select: { status: true } }))?.status ?? "ACTIVE";

  return {
    today,
    case: {
      id: fdr.id,
      publicCode: fdr.publicCode,
      status: fdr.status,
      currentVersionNo: fdr.currentVersion,
      amountMinor: fdr.amountMinor,
      issueDate: toDateOnly(fdr.issueDate),
      maturityDate: toDateOnly(fdr.maturityDate),
      supersededByFdrId: fdr.supersededByFdrId,
      previousFdrId: fdr.previousFdrId,
      institutionStatus: institutionStatus === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    },
    documents: { count: documentCount },
    checks: { currentVersionChecks: fdr.checks.map((row) => serializeCheck(row)) },
    corrections: { openCorrections },
    release:
      latestRelease == null
        ? null
        : {
            reason: latestRelease.reason,
            evidenceType: latestRelease.evidenceType,
            evidenceRef: latestRelease.evidenceRef,
            status: latestRelease.status,
            decision: latestRelease.decision,
            completedAt: latestRelease.completedAt == null ? null : latestRelease.completedAt.toISOString(),
          },
    previous:
      previousRow == null
        ? null
        : {
            id: previousRow.id,
            publicCode: previousRow.publicCode,
            maturityDate: toDateOnly(previousRow.maturityDate),
            amountMinor: previousRow.amountMinor,
            status: previousRow.status,
            supersededByFdrId: previousRow.supersededByFdrId,
          },
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function getCaseDetail(user: AuthenticatedUser, fdrId: number): Promise<CaseDetailResult> {
  const { fdr } = await loadCaseForViewer(user, fdrId);
  const today = businessToday();
  const windowDays = config.sampleApproachingMaturityDays;

  const hasOpenCorrection = fdr.corrections.some((row) => row.status === "OPEN");
  const latestRelease = fdr.releases[0] ?? null;
  const previousNotSuperseded = fdr.replaces != null && fdr.replaces.supersededByFdrId == null;

  const readinessInput = await readinessInputFor(fdr);
  const readiness = evaluateVerificationReadiness(readinessInput);
  const readinessReplacement = fdr.previousFdrId != null ? evaluateReplacementReadiness(readinessInput) : null;
  const readinessRelease = evaluateReleaseReadiness(readinessInput);

  const permissions = await computeCasePermissions({
    user,
    fdr,
    hasOpenCorrection,
    latestRelease,
    previousNotSuperseded,
    verificationBlockers: readiness.blockers.length,
  });

  const dateCondition = deriveDateCondition(today, toDateOnly(fdr.maturityDate), windowDays);
  const days = Math.round((Date.parse(toDateOnly(fdr.maturityDate)) - Date.parse(today)) / 86_400_000);

  const openTasks = fdr.tasks.filter((task) => task.status !== "CANCELLED");
  const activity: ActivityItem[] = await caseActivity(fdr.id, 25);

  const releaseStatus = deriveReleaseStatus(
    latestRelease == null
      ? null
      : {
          status: latestRelease.status,
          decision: (latestRelease.decision ?? null) as "none" | "requested" | "recommended" | "approved" | "rejected" | "completed" | null,
        },
  );

  return {
    id: fdr.id,
    publicCode: fdr.publicCode,
    institution: fdr.institution ?? {
      id: fdr.institutionId,
      code: "",
      name: "",
    },
    status: fdr.status,
    currentVersion: serializeVersion(fdr.versions[0] ?? nullContent(fdr)),
    currentVersionNo: fdr.currentVersion,
    dateCondition,
    daysToMaturity: days,
    releaseStatus,
    draft: fdr.status === "draft" ? { updatedAt: fdr.updatedAt.toISOString() } : null,
    submittedAt: fdr.submittedAt == null ? null : fdr.submittedAt.toISOString(),
    verifiedAt: fdr.verifiedAt == null ? null : fdr.verifiedAt.toISOString(),
    instrumentNote: null,
    remarks: fdr.remarks,
    readiness,
    readinessReplacement,
    readinessRelease,
    checks: fdr.checks.map((row) => serializeCheck(row)),
    versions: fdr.versions.map((row) => serializeVersion(row)),
    corrections: fdr.corrections.map((row) => ({
      id: row.id,
      status: row.status,
      fdrVersionNo: row.fdrVersionNo,
      fields: correctionFields(row.fields),
      note: row.note,
      respondNote: row.respondNote,
      requestedByName: row.requestedBy?.fullName ?? "",
      respondedByName: row.respondedBy?.fullName ?? null,
      respondedVersionNo: row.respondedVersionNo,
      respondedAt: row.respondedAt == null ? null : row.respondedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    releases: fdr.releases.map((row) => ({
      id: row.id,
      status: row.status,
      decision: row.decision,
      reason: row.reason,
      requestedByName: row.requestedBy?.fullName ?? "",
      createdAt: row.createdAt.toISOString(),
    })),
    previousFdr:
      fdr.replaces == null
        ? null
        : {
            id: fdr.replaces.id,
            publicCode: fdr.replaces.publicCode,
            maturityDate: toDateOnly(fdr.replaces.maturityDate),
            status: fdr.replaces.status,
            supersededByFdrId: fdr.replaces.supersededByFdrId,
            supersededAt: fdr.replaces.supersededAt == null ? null : fdr.replaces.supersededAt.toISOString(),
          },
    successors: fdr.successors.map((row) => ({ id: row.id, publicCode: row.publicCode, status: row.status })),
    tasks: openTasks.map((row) => serializeTask(row, today)),
    activity,
    permissions,
    nextAction: nextActionFor(fdr, permissions, fdr.tasks),
    generatedAt: new Date().toISOString(),
  };
}

/** Fallback when a draft has no version rows yet (draft content lives on the Fdr row). */
function nullContent(fdr: CaseRow): {
  versionNo: number;
  instrumentType: CaseRow["instrumentType"];
  bankName: string;
  bankBranch: string;
  referenceNo: string;
  ifsc: string | null;
  beneficiaryName: string | null;
  amountMinor: bigint;
  currency: string;
  issueDate: Date;
  maturityDate: Date;
  remarks: string | null;
  submittedById: number | null;
  createdAt: Date;
  submittedBy?: { fullName: string } | null;
} {
  return {
    versionNo: fdr.currentVersion,
    instrumentType: fdr.instrumentType,
    bankName: fdr.bankName,
    bankBranch: fdr.bankBranch,
    referenceNo: fdr.referenceNo,
    ifsc: fdr.ifsc,
    beneficiaryName: fdr.beneficiaryName,
    amountMinor: fdr.amountMinor,
    currency: fdr.currency,
    issueDate: fdr.issueDate,
    maturityDate: fdr.maturityDate,
    remarks: fdr.remarks,
    submittedById: null,
    createdAt: fdr.createdAt,
    submittedBy: null,
  };
}

function correctionFields(raw: Prisma.JsonValue): Array<{ field: string; label: string; reason: string }> {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  return entries
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry != null && !Array.isArray(entry))
    .map((entry) => ({
      field: typeof entry.field === "string" ? entry.field : "",
      label: typeof entry.label === "string" && entry.label.length > 0 ? entry.label : String(entry.field ?? ""),
      reason: typeof entry.reason === "string" ? entry.reason : "",
    }));
}

// ---------------------------------------------------------------------------
// Deterministic "Explain this case" (fallback-only, clearly labelled)
// ---------------------------------------------------------------------------

export async function getCaseGuidance(user: AuthenticatedUser, fdrId: number): Promise<CaseGuidanceResult> {
  const { fdr } = await loadCaseForViewer(user, fdrId);
  const today = businessToday();
  const windowDays = config.sampleApproachingMaturityDays;

  const readinessInput = await readinessInputFor(fdr);
  const readiness = evaluateVerificationReadiness(readinessInput);
  const permissions = await computeCasePermissions({
    user,
    fdr,
    hasOpenCorrection: fdr.corrections.some((row) => row.status === "OPEN"),
    latestRelease: fdr.releases[0] ?? null,
    previousNotSuperseded: fdr.replaces != null && fdr.replaces.supersededByFdrId == null,
    verificationBlockers: readiness.blockers.length,
  });
  const dateCondition = deriveDateCondition(today, toDateOnly(fdr.maturityDate), windowDays);
  const days = Math.round((Date.parse(toDateOnly(fdr.maturityDate)) - Date.parse(today)) / 86_400_000);

  const facts: CaseGuidanceFacts = {
    publicCode: fdr.publicCode,
    instrumentType: fdr.instrumentType,
    status: fdr.status,
    dateCondition: dateCondition === "current" ? "Maturity is still ahead" : dateCondition,
    daysToMaturity: days,
    amountLabel: minorUnitsToRupeesLabel(fdr.amountMinor),
    bankName: fdr.bankName,
    releaseStatus: deriveReleaseStatus(
      fdr.releases[0] == null
        ? null
        : {
            status: fdr.releases[0]!.status,
            decision: (fdr.releases[0]!.decision ?? null) as "none" | "requested" | "recommended" | "approved" | "rejected" | "completed" | null,
          },
    ),
    openCorrections: fdr.corrections.filter((row) => row.status === "OPEN").length,
    openChecks: readiness.items.filter((item) => item.key.startsWith("check_") && item.status !== "pass").length,
    superseded: fdr.supersededByFdrId != null,
    previousPublicCode: fdr.replaces?.publicCode ?? null,
    nextAction: nextActionFor(fdr, permissions, fdr.tasks),
    readinessBlockers: readiness.blockers,
    readinessItems: readiness.items,
  };

  return buildCaseGuidance(facts);
}
