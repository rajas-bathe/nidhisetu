import type { FdrListItem, ReleaseStatus, TaskListItem } from "@sih26265/contracts";
import type { Fdr, Task } from "@prisma/client";
import { toDateOnly } from "../utils/dates.js";
import { deriveDateCondition, type DateCondition } from "../rules/dateCondition.js";

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
