/**
 * Reports module. Every report is produced by an authorized scope query
 * (college accounts, officer jurisdiction rows, or the administrator); the
 * same serialization feeds the JSON table and the CSV export so both are
 * always identical. All cells are display-ready strings (money already in
 * exact rupee form; dates as YYYY-MM-DD) so no consumer re-formats anything.
 *
 * SAMPLE framing: every report carries an explicit sample note; nothing here
 * claims to be an official register.
 */
import type {
  ReportColumn,
  ReportKind,
  ReportQuery,
  ReportResponse,
  ReportRow,
} from "@sih26265/contracts";
import { REPORT_KIND_LABELS } from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { validationError } from "../errors.js";
import { config } from "../config/env.js";
import { addDays, businessToday, parseLocalDate, toDateOnly } from "../utils/dates.js";
import { minorUnitsToRupeeString } from "../utils/money.js";
import { deriveDateCondition } from "../rules/dateCondition.js";
import { fieldLabel } from "../rules/checkFields.js";
import { recordAudit } from "./audit.service.js";
import { assertInstitutionInScope, getAccessScope, institutionCondition } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

const SAMPLE_NOTE =
  "SAMPLE data from this demonstration portal (capped dataset, simulated verification); not an official register.";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted - awaiting review",
  under_review: "Under review",
  discrepancy: "Corrections requested",
  verified: "Verified",
};

const RELEASE_LABELS: Record<string, string> = {
  none: "No release request",
  requested: "Release requested",
  recommended: "Recommended for approval",
  approved: "Approved - completion pending",
  rejected: "Release request rejected",
  completed: "Release completed with evidence",
};

const MATURITY_LABELS: Record<string, string> = {
  current: "Current",
  approaching_maturity: "Approaching maturity",
  matured: "Matured (renewal attention needed)",
};

/** Progress label for an instrument with an open replacement obligation. */
const REPLACEMENT_PROGRESS_LABELS: Record<string, string> = {
  draft: "Being prepared by the college",
  submitted: "Awaiting officer verification",
  under_review: "Under officer verification",
  discrepancy: "Corrections requested by the officer",
  verified: "Awaiting authority acceptance",
};

const INSTRUMENT_TYPE_LABELS: Record<string, string> = {
  SECURITY_DEPOSIT: "Security deposit",
  BANK_GUARANTEE: "Bank guarantee",
};

const COLUMNS: Record<ReportKind, ReportColumn[]> = {
  register: [
    { key: "case", label: "Case", type: "text" },
    { key: "institution", label: "Institution", type: "text" },
    { key: "type", label: "Instrument type", type: "text" },
    { key: "bank", label: "Bank", type: "text" },
    { key: "reference", label: "FDR reference", type: "text" },
    { key: "amount", label: "Amount (Rs)", type: "money" },
    { key: "issue_date", label: "Issue date", type: "date" },
    { key: "maturity_date", label: "Maturity date", type: "date" },
    { key: "status", label: "Review status", type: "note" },
    { key: "maturity_state", label: "Maturity state", type: "note" },
    { key: "release", label: "Release state", type: "note" },
    { key: "submitted", label: "Submitted", type: "date" },
  ],
  upcoming_maturity: [
    { key: "case", label: "Case", type: "text" },
    { key: "institution", label: "Institution", type: "text" },
    { key: "bank", label: "Bank", type: "text" },
    { key: "amount", label: "Amount (Rs)", type: "money" },
    { key: "maturity_date", label: "Maturity date", type: "date" },
    { key: "days_to_maturity", label: "Days to maturity", type: "number" },
    { key: "maturity_state", label: "Maturity state", type: "note" },
    { key: "status", label: "Review status", type: "note" },
    { key: "release", label: "Release state", type: "note" },
  ],
  pending_corrections: [
    { key: "case", label: "Case", type: "text" },
    { key: "institution", label: "Institution", type: "text" },
    { key: "fields", label: "Fields requested for correction", type: "text" },
    { key: "note", label: "Officer note", type: "text" },
    { key: "requested_on", label: "Requested on", type: "date" },
    { key: "case_status", label: "Case status", type: "note" },
    { key: "version", label: "Version", type: "number" },
  ],
  replacement_obligations: [
    { key: "case", label: "Replacement case", type: "text" },
    { key: "replaces", label: "Replaces case", type: "text" },
    { key: "institution", label: "Institution", type: "text" },
    { key: "bank", label: "Bank", type: "text" },
    { key: "amount", label: "Amount (Rs)", type: "money" },
    { key: "submitted_on", label: "Submitted on", type: "date" },
    { key: "status", label: "Review status", type: "note" },
    { key: "progress", label: "Next step", type: "note" },
  ],
  release_status: [
    { key: "case", label: "Case", type: "text" },
    { key: "institution", label: "Institution", type: "text" },
    { key: "bank", label: "Bank", type: "text" },
    { key: "amount", label: "Amount (Rs)", type: "money" },
    { key: "release", label: "Release state", type: "note" },
    { key: "requested_on", label: "Requested on", type: "date" },
    { key: "decided_on", label: "Decision / completion", type: "date" },
  ],
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function getReport(
  user: AuthenticatedUser,
  kind: ReportKind,
  query: ReportQuery,
): Promise<ReportResponse> {
  const scope = await getAccessScope(user);
  if (query.institutionId != null) {
    assertInstitutionInScope(scope, query.institutionId);
  }
  if (query.from != null && query.to != null && query.from > query.to) {
    throw validationError({ from: ["'From' must be on or before 'To'."] }, "The date range needs attention.");
  }
  if (kind !== "register" && kind !== "upcoming_maturity" && query.includeSuperseded) {
    throw validationError(
      { includeSuperseded: ["Superseded instruments can only appear in the register and maturity reports."] },
      "This filter does not apply to the selected report.",
    );
  }

  // Officers with an empty jurisdiction list see an empty report, never all data.
  const institutionFilter: Prisma.IntFilter | undefined =
    query.institutionId != null
      ? { equals: query.institutionId }
      : institutionCondition(scope) as Prisma.IntFilter | undefined;

  const today = businessToday();
  const windowDays = config.sampleApproachingMaturityDays;

  const rows: ReportRow[] =
    kind === "register"
      ? await registerRows(institutionFilter, query, today, windowDays)
      : kind === "upcoming_maturity"
        ? await upcomingMaturityRows(institutionFilter, query, today, windowDays)
        : kind === "pending_corrections"
          ? await pendingCorrectionRows(institutionFilter, query)
          : kind === "replacement_obligations"
            ? await replacementObligationRows(institutionFilter, query)
            : await releaseStatusRows(institutionFilter, query);

  return {
    kind,
    generatedAt: new Date().toISOString(),
    generatedFrom: "authorized_scope_query",
    columns: COLUMNS[kind],
    rows,
    count: rows.length,
    isSample: true,
    sampleNote: SAMPLE_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Release helper shared by register/upcoming/release reports
// ---------------------------------------------------------------------------

export interface ReleaseStateRow {
  fdrId: number;
  status: "OPEN" | "DECIDED";
  decision: "none" | "requested" | "recommended" | "approved" | "rejected" | "completed" | null;
  createdAt: Date;
  decidedAt: Date | null;
  completedAt: Date | null;
}

/** Newest release request per instrument (ties broken by descending id). */
export async function loadLatestReleaseStates(fdrIds: number[]): Promise<Map<number, ReleaseStateRow>> {
  const map = new Map<number, ReleaseStateRow>();
  if (fdrIds.length === 0) return map;
  const rows = await prisma.releaseRequest.findMany({
    where: { fdrId: { in: fdrIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      fdrId: true,
      status: true,
      decision: true,
      createdAt: true,
      decidedAt: true,
      completedAt: true,
    },
  });
  for (const row of rows) {
    if (!map.has(row.fdrId)) map.set(row.fdrId, row);
  }
  return map;
}

export function releaseStateLabel(
  release?: Pick<ReleaseStateRow, "status" | "decision" | "completedAt"> | null,
): string {
  if (release == null) return RELEASE_LABELS.none;
  if (release.status === "OPEN") {
    return release.decision === "recommended" ? RELEASE_LABELS.recommended : RELEASE_LABELS.requested;
  }
  if (release.decision === "approved") {
    return release.completedAt != null ? RELEASE_LABELS.completed : RELEASE_LABELS.approved;
  }
  if (release.decision === "rejected") return RELEASE_LABELS.rejected;
  if (release.decision === "completed") return RELEASE_LABELS.completed;
  return RELEASE_LABELS.requested;
}

function institutionLabel(institution: { code: string; name: string } | null): string {
  return institution == null ? "-" : `${institution.name} (${institution.code})`;
}

function signedDays(maturityDate: Date, today: string): number {
  return Math.round((parseLocalDate(toDateOnly(maturityDate)).getTime() - parseLocalDate(today).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Register (every instrument in the viewer's scope)
// ---------------------------------------------------------------------------

const FDR_REPORT_SELECT = {
  id: true,
  publicCode: true,
  instrumentType: true,
  bankName: true,
  referenceNo: true,
  amountMinor: true,
  issueDate: true,
  maturityDate: true,
  status: true,
  submittedAt: true,
  createdAt: true,
  supersededByFdrId: true,
  institution: { select: { code: true, name: true } },
} satisfies Prisma.FdrSelect;

type FdrReportRow = Prisma.FdrGetPayload<{ select: typeof FDR_REPORT_SELECT }>;

async function registerRows(
  institutionFilter: Prisma.IntFilter | undefined,
  query: ReportQuery,
  today: string,
  windowDays: number,
): Promise<ReportRow[]> {
  const conditions: Prisma.FdrWhereInput[] = [{ institutionId: institutionFilter }];
  if (!query.includeSuperseded) {
    conditions.push({ supersededByFdrId: null });
  }
  const maturity: Prisma.DateTimeFilter = {};
  if (query.from != null) maturity.gte = parseLocalDate(query.from);
  if (query.to != null) maturity.lte = parseLocalDate(query.to);
  if (maturity.gte != null || maturity.lte != null) conditions.push({ maturityDate: maturity });

  const fdrRows: FdrReportRow[] = await prisma.fdr.findMany({
    where: { AND: conditions },
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
    select: FDR_REPORT_SELECT,
  });
  const releaseStates = await loadLatestReleaseStates(fdrRows.map((row) => row.id));

  const rows: ReportRow[] = [];
  for (const row of fdrRows) {
    const maturityDate = toDateOnly(row.maturityDate);
    const condition = deriveDateCondition(today, maturityDate, windowDays);
    const release = releaseStates.get(row.id);
    rows.push({
      id: row.publicCode,
      cells: {
        case: row.publicCode,
        institution: institutionLabel(row.institution),
        type: INSTRUMENT_TYPE_LABELS[row.instrumentType],
        bank: row.bankName,
        reference: row.referenceNo,
        amount: minorUnitsToRupeeString(row.amountMinor),
        issue_date: toDateOnly(row.issueDate),
        maturity_date: maturityDate,
        status: STATUS_LABELS[row.status],
        maturity_state: MATURITY_LABELS[condition],
        release: releaseStateLabel(release),
        submitted: row.submittedAt == null ? null : toDateOnly(row.submittedAt),
      },
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Upcoming & matured instruments
// ---------------------------------------------------------------------------

async function upcomingMaturityRows(
  institutionFilter: Prisma.IntFilter | undefined,
  query: ReportQuery,
  today: string,
  windowDays: number,
): Promise<ReportRow[]> {
  const conditions: Prisma.FdrWhereInput[] = [
    { institutionId: institutionFilter },
    // Approaching OR matured: everything up to the end of the approach window.
    { maturityDate: { lte: parseLocalDate(addDays(today, windowDays)) } },
  ];
  if (!query.includeSuperseded) {
    conditions.push({ supersededByFdrId: null });
  }
  const maturity: Prisma.DateTimeFilter = {};
  if (query.from != null) maturity.gte = parseLocalDate(query.from);
  if (query.to != null) maturity.lte = parseLocalDate(query.to);
  if (maturity.gte != null || maturity.lte != null) conditions.push({ maturityDate: maturity });

  const fdrRows: FdrReportRow[] = await prisma.fdr.findMany({
    where: { AND: conditions },
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
    select: FDR_REPORT_SELECT,
  });
  const releaseStates = await loadLatestReleaseStates(fdrRows.map((row) => row.id));

  const rows: ReportRow[] = [];
  for (const row of fdrRows) {
    const maturityDate = toDateOnly(row.maturityDate);
    const condition = deriveDateCondition(today, maturityDate, windowDays);
    if (condition === "current") continue; // Defensive: the database filter already excludes these.
    const release = releaseStates.get(row.id);
    rows.push({
      id: row.publicCode,
      cells: {
        case: row.publicCode,
        institution: institutionLabel(row.institution),
        bank: row.bankName,
        amount: minorUnitsToRupeeString(row.amountMinor),
        maturity_date: maturityDate,
        days_to_maturity: String(signedDays(row.maturityDate, today)),
        maturity_state: MATURITY_LABELS[condition],
        status: STATUS_LABELS[row.status],
        release: releaseStateLabel(release),
      },
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pending corrections
// ---------------------------------------------------------------------------

async function pendingCorrectionRows(
  institutionFilter: Prisma.IntFilter | undefined,
  query: ReportQuery,
): Promise<ReportRow[]> {
  const conditions: Prisma.CorrectionRequestWhereInput[] = [{ status: "OPEN" }];
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from != null) createdAt.gte = parseLocalDate(query.from);
  if (query.to != null) createdAt.lte = parseLocalDate(addDays(query.to, 1));
  if (createdAt.gte != null || createdAt.lte != null) conditions.push({ createdAt });
  conditions.push({ fdr: { institutionId: institutionFilter } });

  const correctionRows = await prisma.correctionRequest.findMany({
    where: { AND: conditions },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fields: true,
      note: true,
      createdAt: true,
      fdrVersionNo: true,
      fdr: {
        select: {
          publicCode: true,
          status: true,
          institution: { select: { code: true, name: true } },
        },
      },
    },
  });

  return correctionRows.map((row) => {
    const entries = Array.isArray(row.fields) ? (row.fields as Array<{ field?: string; label?: string }>) : [];
    const fieldsText = entries
      .map((entry) => entry.label ?? fieldLabel(String(entry.field ?? "")))
      .join(", ");
    return {
      id: `${row.fdr.publicCode}-correction-${row.id}`,
      cells: {
        case: row.fdr.publicCode,
        institution: institutionLabel(row.fdr.institution),
        fields: fieldsText,
        note: row.note,
        requested_on: toDateOnly(row.createdAt),
        case_status: STATUS_LABELS[row.fdr.status],
        version: String(row.fdrVersionNo),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Replacement obligations (cases whose predecessor is not superseded yet)
// ---------------------------------------------------------------------------

async function replacementObligationRows(
  institutionFilter: Prisma.IntFilter | undefined,
  query: ReportQuery,
): Promise<ReportRow[]> {
  const conditions: Prisma.FdrWhereInput[] = [
    { previousFdrId: { not: null } },
    // The obligation is open exactly while the predecessor is not superseded.
    { supersededByFdrId: null },
    { replaces: { supersededByFdrId: null } },
    { institutionId: institutionFilter },
  ];

  const fdrRows = await prisma.fdr.findMany({
    where: { AND: conditions },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      publicCode: true,
      bankName: true,
      amountMinor: true,
      status: true,
      submittedAt: true,
      createdAt: true,
      replaces: { select: { publicCode: true } },
      institution: { select: { code: true, name: true } },
    },
  });

  const rows: ReportRow[] = [];
  for (const row of fdrRows) {
    const submittedOn = row.submittedAt == null ? toDateOnly(row.createdAt) : toDateOnly(row.submittedAt);
    if (query.from != null && submittedOn < query.from) continue;
    if (query.to != null && submittedOn > query.to) continue;
    rows.push({
      id: row.publicCode,
      cells: {
        case: row.publicCode,
        replaces: row.replaces?.publicCode ?? "-",
        institution: institutionLabel(row.institution),
        bank: row.bankName,
        amount: minorUnitsToRupeeString(row.amountMinor),
        submitted_on: submittedOn,
        status: STATUS_LABELS[row.status],
        progress: REPLACEMENT_PROGRESS_LABELS[row.status],
      },
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Release request status across live instruments
// ---------------------------------------------------------------------------

async function releaseStatusRows(
  institutionFilter: Prisma.IntFilter | undefined,
  query: ReportQuery,
): Promise<ReportRow[]> {
  const conditions: Prisma.FdrWhereInput[] = [
    { supersededByFdrId: null },
    { institutionId: institutionFilter },
  ];

  const fdrRows: FdrReportRow[] = await prisma.fdr.findMany({
    where: { AND: conditions },
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
    select: FDR_REPORT_SELECT,
  });

  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from != null) createdAt.gte = parseLocalDate(query.from);
  if (query.to != null) createdAt.lte = parseLocalDate(addDays(query.to, 1));
  const hasDateFilter = createdAt.gte != null || createdAt.lte != null;

  const releases = await prisma.releaseRequest.findMany({
    where: {
      fdrId: { in: fdrRows.map((row) => row.id) },
      ...(hasDateFilter ? { createdAt } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      fdrId: true,
      status: true,
      decision: true,
      createdAt: true,
      decidedAt: true,
      completedAt: true,
    },
  });
  // When a date window is requested, only instruments with a request inside
  // the window appear; without a window every live instrument is listed.
  const latestByFdr: Map<number, ReleaseStateRow> = new Map();
  if (!hasDateFilter) {
    const all = await loadLatestReleaseStates(fdrRows.map((row) => row.id));
    for (const [fdrId, release] of all) {
      if (fdrRows.some((row) => row.id === fdrId)) latestByFdr.set(fdrId, release);
    }
  } else {
    for (const release of releases) {
      if (!latestByFdr.has(release.fdrId)) {
        latestByFdr.set(release.fdrId, {
          fdrId: release.fdrId,
          status: release.status,
          decision: release.decision,
          createdAt: release.createdAt,
          decidedAt: release.decidedAt,
          completedAt: release.completedAt,
        });
      }
    }
  }

  const rows: ReportRow[] = [];
  for (const row of fdrRows) {
    const release = latestByFdr.get(row.id);
    if (hasDateFilter && release == null) continue;
    const decidedOn =
      release == null
        ? null
        : release.completedAt != null
          ? toDateOnly(release.completedAt)
          : release.decidedAt != null
            ? toDateOnly(release.decidedAt)
            : null;
    rows.push({
      id: row.publicCode,
      cells: {
        case: row.publicCode,
        institution: institutionLabel(row.institution),
        bank: row.bankName,
        amount: minorUnitsToRupeeString(row.amountMinor),
        release: releaseStateLabel(release),
        requested_on: release == null ? null : toDateOnly(release.createdAt),
        decided_on: decidedOn,
      },
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// CSV export (formula-injection guarded)
// ---------------------------------------------------------------------------

/**
 * Excel/LibreOffice treat a leading `=`, `+`, `-`, `@`, TAB or CR as a formula.
 * Every cell is neutralised by prefixing an apostrophe (the standard guard)
 * before quoting, so pasted report cells can never execute a formula.
 */
function csvCell(raw: string | null): string {
  if (raw == null) return "";
  let value = raw;
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`;
  }
  if (/[",\r\n]/.test(value)) {
    value = `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function renderReportCsv(report: ReportResponse): string {
  const lines: string[] = [];
  lines.push(`Report,${csvCell(REPORT_KIND_LABELS[report.kind])}`);
  lines.push(`Generated at,${csvCell(report.generatedAt)}`);
  lines.push(`Note,${csvCell(report.sampleNote)}`);
  lines.push("");
  lines.push(report.columns.map((column) => csvCell(column.label)).join(","));
  for (const row of report.rows) {
    lines.push(report.columns.map((column) => csvCell(row.cells[column.key] ?? null)).join(","));
  }
  lines.push("");
  lines.push(`Total rows,${report.count}`);
  return `${lines.join("\r\n")}\r\n`;
}

export function reportCsvFilename(kind: ReportKind, generatedAtIso: string): string {
  const stamp = generatedAtIso.slice(0, 10).replace(/-/g, "");
  return `nidhisetu-${kind}-report-${stamp}.csv`;
}

export async function auditReportExport(
  user: AuthenticatedUser,
  kind: ReportKind,
  query: ReportQuery,
  rowCount: number,
): Promise<void> {
  await recordAudit({
    action: "REPORT_EXPORTED",
    actorUserId: user.id,
    entityType: "report",
    entityId: kind,
    detail: {
      kind,
      count: rowCount,
      ...(query.institutionId != null ? { institution: query.institutionId } : {}),
      ...(query.includeSuperseded ? { includeSuperseded: true } : {}),
    },
  });
}
