import type { FdrListItem, ReleaseStatus, TaskListItem } from "@sih26265/contracts";
import type { CorrectionRequest, Fdr, FdrVersion, ReleaseRequest, Task, VerificationCheck } from "@prisma/client";
import { toDateOnly } from "../utils/dates.js";
import { deriveDateCondition, type DateCondition } from "../rules/dateCondition.js";
import { minorUnitsToRupeeString } from "../utils/money.js";

export type FdrRow = Fdr & {
  institution?: { id: number; code: string; name: string } | null;
};

export interface LatestReleaseInfo {
  status: "OPEN" | "DECIDED";
  decision: ReleaseStatus | null;
}

/** Derives the user-facing release status of an instrument from its latest request. */
export function deriveReleaseStatus(latest?: LatestReleaseInfo | null): ReleaseStatus {
  if (latest == null) {
    return "none";
  }
  if (latest.status === "OPEN") {
    return "requested";
  }
  return latest.decision ?? "none";
}

export function serializeFdr(
  row: FdrRow,
  today: string,
  approachingWindowDays: number,
  latestRelease?: LatestReleaseInfo | null,
): FdrListItem {
  const maturityDate = toDateOnly(row.maturityDate);
  const dateCondition: DateCondition = deriveDateCondition(today, maturityDate, approachingWindowDays);
  return {
    id: row.id,
    publicCode: row.publicCode,
    institution: row.institution
      ? { id: row.institution.id, code: row.institution.code, name: row.institution.name }
      : { id: row.institutionId, code: "", name: "" },
    instrumentType: row.instrumentType,
    bankName: row.bankName,
    bankBranch: row.bankBranch,
    referenceNo: row.referenceNo,
    amount: { currency: row.currency, amountMinor: row.amountMinor.toString() },
    issueDate: toDateOnly(row.issueDate),
    maturityDate,
    status: row.status,
    dateCondition,
    daysToMaturity: dateConditionDays(row, maturityDate, today),
    releaseStatus: deriveReleaseStatus(latestRelease),
    submittedAt: row.submittedAt == null ? null : row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function dateConditionDays(_row: FdrRow, maturityDate: string, today: string): number {
  const [tY, tM, tD] = today.split("-").map(Number) as [number, number, number];
  const [mY, mM, mD] = maturityDate.split("-").map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(mY, mM - 1, mD) - Date.UTC(tY, tM - 1, tD)) / 86_400_000,
  );
}

export function serializeTask(
  row: Task & { fdr?: { id: number; publicCode: string } | null },
  today: string,
): TaskListItem {
  const dueDate = toDateOnly(row.dueDate);
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    detail: row.detail ?? null,
    status: row.status,
    dueDate,
    isOverdue: row.status === "OPEN" || row.status === "IN_PROGRESS" ? row.dueDate.getTime() < toUtcMidnight(today).getTime() : false,
    fdrId: row.fdrId ?? null,
    fdrPublicCode: row.fdr?.publicCode ?? null,
    assigneeUserId: row.assigneeUserId ?? null,
    assigneeInstitutionId: row.assigneeInstitutionId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toUtcMidnight(localDate: string): Date {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

// ---------------------------------------------------------------------------
// Case-workspace serializers
// ---------------------------------------------------------------------------

export type InstitutionNullable = { id: number; code: string; name: string } | null;

export interface VersionRowLike extends Omit<FdrVersion, "submittedBy"> {
  submittedBy?: { fullName: string } | null;
}

export function serializeVersion(row: VersionRowLike): import("@sih26265/contracts").FdrVersionSnapshot {
  return {
    versionNo: row.versionNo,
    instrumentType: row.instrumentType,
    bankName: row.bankName,
    bankBranch: row.bankBranch,
    referenceNo: row.referenceNo,
    ifsc: row.ifsc ?? null,
    beneficiaryName: row.beneficiaryName ?? null,
    amount: { currency: row.currency, amountMinor: row.amountMinor.toString() },
    issueDate: toDateOnly(row.issueDate),
    maturityDate: toDateOnly(row.maturityDate),
    remarks: row.remarks ?? null,
    submittedByName: row.submittedBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CheckRowLike extends Omit<VerificationCheck, "checkedBy"> {
  checkedBy?: { fullName: string } | null;
}

export function serializeCheck(row: CheckRowLike): import("@sih26265/contracts").CheckRecord {
  return {
    id: row.id,
    field: row.field,
    source: row.source,
    outcome: row.outcome,
    submittedValue: row.submittedValue ?? null,
    observedValue: row.observedValue ?? null,
    reason: row.reason ?? null,
    evidenceRef: row.evidenceRef ?? null,
    checkedByName: row.checkedBy?.fullName ?? null,
    checkedAt: row.checkedAt.toISOString(),
    fdrVersionNo: row.fdrVersionNo,
    invalidatedAt: row.invalidatedAt == null ? null : row.invalidatedAt.toISOString(),
    invalidatedVersionNo: row.invalidatedVersionNo ?? null,
    invalidatedReason: row.invalidatedReason ?? null,
    dependentFields: row.dependentFields ?? [],
  };
}

export type FdrLike = Fdr & {
  institution?: { id: number; code: string; name: string } | null;
  replaces?: { id: number; publicCode: string; maturityDate: Date; status: string; supersededByFdrId: number | null; supersededAt: Date | null } | null;
};

export function serializeCorrection(
  row: CorrectionRequest & {
    requestedBy?: { fullName: string } | null;
    respondedBy?: { fullName: string } | null;
    fdr?: { publicCode: string; institutionId: number; institution?: { name: string } | null } | null;
  },
): import("@sih26265/contracts").CorrectionItem {
  const fields = Array.isArray(row.fields) ? (row.fields as unknown[]) : [];
  const fieldItems = fields
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry != null)
    .map((entry) => {
      const rawField = typeof entry.field === "string" ? entry.field : "";
      return {
        field: rawField,
        label: typeof entry.label === "string" && entry.label.length > 0
          ? entry.label
          : fieldLabelFallback(rawField),
        reason: typeof entry.reason === "string" ? entry.reason : "",
      };
    });

  return {
    id: row.id,
    fdrId: row.fdrId,
    fdrPublicCode: row.fdr?.publicCode ?? null,
    institutionName: row.fdr?.institution?.name ?? null,
    fdrVersionNo: row.fdrVersionNo,
    status: row.status,
    fields: fieldItems,
    note: row.note ?? null,
    respondNote: row.respondNote ?? null,
    requestedByName: row.requestedBy?.fullName ?? null,
    respondedByName: row.respondedBy?.fullName ?? null,
    respondedVersionNo: row.respondedVersionNo ?? null,
    respondedAt: row.respondedAt == null ? null : row.respondedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export type ReleaseRowLike = ReleaseRequest & {
  requestedBy?: { fullName: string } | null;
  recommendedBy?: { fullName: string } | null;
  decidedBy?: { fullName: string } | null;
  completedBy?: { fullName: string } | null;
  fdr?: { id: number; publicCode: string; institutionId: number; institution?: { name: string } | null } | null;
};

export function serializeRelease(row: ReleaseRowLike): import("@sih26265/contracts").ReleaseItem {
  return {
    id: row.id,
    fdrId: row.fdrId,
    fdrPublicCode: row.fdr?.publicCode ?? null,
    institutionId: row.fdr?.institutionId ?? null,
    institutionName: row.fdr?.institution?.name ?? null,
    status: row.status,
    decision: row.decision == null ? "none" : row.decision,
    decisionStage: (row.decisionStage ?? null) as import("@sih26265/contracts").ReleaseItem["decisionStage"],
    reason: row.reason,
    evidenceType: row.evidenceType ?? null,
    evidenceRef: row.evidenceRef ?? null,
    requestedByName: row.requestedBy?.fullName ?? null,
    recommendedByName: row.recommendedBy?.fullName ?? null,
    recommendationNote: row.recommendationNote ?? null,
    decidedByName: row.decidedBy?.fullName ?? null,
    decisionNote: row.decisionNote ?? null,
    decidedAt: row.decidedAt == null ? null : row.decidedAt.toISOString(),
    completionEvidenceType: row.completionEvidenceType ?? null,
    completionEvidenceRef: row.completionEvidenceRef ?? null,
    completionEvidenceDate: row.completionEvidenceDate == null ? null : toDateOnly(row.completionEvidenceDate),
    completedAmount: row.completedAmountMinor == null ? null : minorUnitsToRupeeString(row.completedAmountMinor),
    completionNote: row.completionNote ?? null,
    completedByName: row.completedBy?.fullName ?? null,
    completedAt: row.completedAt == null ? null : row.completedAt.toISOString(),
    policyVersion: row.policyVersion ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function fieldLabelFallback(field: string): string {
  return field.replace(/_/g, " ");
}
