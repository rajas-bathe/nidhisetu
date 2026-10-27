/**
 * Reviewing-officer workflow: start review, record deterministic evidence
 * checks, verify the case.
 *
 * Server-side guarantees:
 * - Every action requires a REVIEW_OFFICER jurisdiction row for the case's
 *   institution (admins deliberately have none).
 * - SIMULATED_BANK_CHECK outcomes are derived, never asserted: MATCH only when
 *   the submitted value equals the observed value (comparison rules per field
 *   type below). The response labels simulated evidence clearly.
 * - Verification is only possible when the readiness panel has no blockers.
 */
import type { Prisma } from "@prisma/client";
import type { CheckRecordRequest, WorkflowResult } from "@sih26265/contracts";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { businessToday } from "../utils/dates.js";
import { minorUnitsToRupeeString, rupeesToMinorUnits } from "../utils/money.js";
import { CHECK_FIELD_META, dependentFieldsFor, fieldLabel, isCorrectableField } from "../rules/checkFields.js";
import {
  evaluateVerificationReadiness,
  type ReadinessInput,
} from "../rules/readiness.js";
import { recordAudit } from "./audit.service.js";
import { createNotification, createNotifications } from "./notification.service.js";
import { assertOfficerCapability } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

type CaseRow = Prisma.FdrGetPayload<{ include: typeof CASE_INCLUDE }>;

const CASE_INCLUDE = {
  _count: { select: { documents: true, corrections: true } },
} satisfies Prisma.FdrInclude;

async function caseForReview(user: AuthenticatedUser, fdrId: number, requireCapability = true): Promise<CaseRow> {
  if (requireCapability) {
    await assertReviewCapability(user, fdrId);
  }
  const fdr = await prisma.fdr.findUnique({
    where: { id: fdrId },
    include: CASE_INCLUDE,
  });
  if (fdr == null) throw notFound("The case does not exist.");
  return fdr;
}

/** Validates the reviewer capability by looking up the case first. */
export async function assertReviewCapability(user: AuthenticatedUser, fdrId: number): Promise<number> {
  const target = await prisma.fdr.findUnique({
    where: { id: fdrId },
    select: { id: true, institutionId: true, publicCode: true },
  });
  if (target == null) throw notFound("The case does not exist.");
  if (user.role !== "REVIEW_OFFICER") {
    throw forbidden("Only the assigned reviewing officer can perform this action.");
  }
  await assertOfficerCapability(user, target.institutionId, "REVIEW_OFFICER");
  return target.institutionId;
}

// ---------------------------------------------------------------------------
// Start review
// ---------------------------------------------------------------------------

export async function startReview(user: AuthenticatedUser, fdrId: number): Promise<WorkflowResult> {
  const institutionId = await assertReviewCapability(user, fdrId);

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.fdr.updateMany({
      where: { id: fdrId, status: "submitted" },
      data: { status: "under_review" },
    });
    if (claimed.count === 0) {
      const current = await tx.fdr.findUnique({ where: { id: fdrId }, select: { status: true, publicCode: true } });
      if (current?.status === "under_review" || current?.status === "discrepancy") {
        return { publicCode: current.publicCode, already: true as const };
      }
      throw conflict("Only submitted cases can enter review.");
    }

    await tx.task.updateMany({
      where: { fdrId, type: "VERIFICATION_REVIEW", assigneeUserId: user.id, status: "OPEN" },
      data: { status: "IN_PROGRESS" },
    });

    await tx.auditEvent.create({
      data: {
        action: "REVIEW_STARTED",
        actorUserId: user.id,
        institutionId,
        fdrId,
        entityType: "fdr",
        entityId: String(fdrId),
        detail: { note: "Review started" },
      },
    });
    return { publicCode: (await tx.fdr.findUnique({ where: { id: fdrId }, select: { publicCode: true } }))?.publicCode ?? "", already: false as const };
  });

  if (!result.already) {
    await createNotification({
      institutionId,
      title: `Review started for ${result.publicCode}`,
      body: "The reviewing officer started reviewing your case.",
      linkPath: `/cases/${fdrId}`,
    });
    await recordAudit({
      action: "REVIEW_STARTED",
      actorUserId: user.id,
      institutionId,
      fdrId,
      entityType: "fdr",
      entityId: String(fdrId),
      detail: { note: "Review started", publicCode: result.publicCode },
    });
  }

  return { fdrId, status: "under_review", message: result.already ? "The review is already in progress." : "Review started." };
}

// ---------------------------------------------------------------------------
// Record evidence check
// ---------------------------------------------------------------------------

/** Normalises a value for comparison per field type; returns {norm, label}. */
function normaliseForComparison(field: string, value: string): string {
  const meta = (CHECK_FIELD_META as Record<string, { valueType: string } | undefined>)[field];
  const valueType = meta?.valueType ?? "text";
  if (valueType === "money") {
    const minor = rupeesToMinorUnits(value);
    if (minor == null) return value.trim();
    return minorUnitsToRupeeString(minor).replace(/\.00$/, "");
  }
  if (valueType === "date" || valueType === "ifsc") {
    return value.trim().toUpperCase();
  }
  return value.trim().toLowerCase();
}

/** Value of a field as recorded in the submission version (display form). */
function submittedValueForField(field: string, fdr: CaseRow, version: { amountMinor: bigint; currency: string } | null): string {
  const versionRow = version ?? fdr;
  switch (field) {
    case "amount":
      return minorUnitsToRupeeString(versionRow.amountMinor);
    case "reference_no":
      return fdr.referenceNo;
    case "bank_name":
      return fdr.bankName;
    case "bank_branch":
      return fdr.bankBranch;
    case "maturity_date":
      return fdr.maturityDate.toISOString().slice(0, 10);
    case "issue_date":
      return fdr.issueDate.toISOString().slice(0, 10);
    case "ifsc":
      return fdr.ifsc ?? "";
    case "beneficiary_name":
      return fdr.beneficiaryName ?? "";
    case "instrument_type":
      return fdr.instrumentType;
    default:
      return "";
  }
}

export async function recordCheck(user: AuthenticatedUser, input: CheckRecordRequest): Promise<WorkflowResult> {
  const fdr = await caseForReview(user, input.fdrId);
  const fieldErrors: Record<string, string[]> = {};

  if (!isCorrectableField(input.field)) {
    fieldErrors.field = ["This field cannot be checked; pick one of the registry fields."];
  }

  if (input.source === "SIMULATED_BANK_CHECK") {
    if (input.outcome != null) {
      fieldErrors.outcome = [
        "The outcome of a SIMULATED bank check is derived from the submitted and observed values and must not be provided.",
      ];
    }
    if ((input.observedValue ?? "").length === 0) {
      fieldErrors.observedValue = ["Enter the value returned by the simulated bank query (SIMULATED data)."];
    }
  }
  if (input.source === "DOCUMENT_FINGERPRINT") {
    if (!/^document:\d+$/i.test(input.evidenceRef ?? "")) {
      fieldErrors.evidenceRef = ["Reference the uploaded document as document:<id>."];
    }
  }

  const versionRow = await prisma.fdrVersion.findFirst({
    where: { fdrId: fdr.id, versionNo: fdr.currentVersion },
    select: { amountMinor: true, currency: true },
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The check needs attention.");
  }

  const submittedDisplay = submittedValueForField(input.field, fdr, versionRow ?? null);

  // Deterministic derivation for the simulated source (never random).
  let outcome = input.outcome ?? null;
  if (input.source === "SIMULATED_BANK_CHECK") {
    const same = normaliseForComparison(input.field, submittedDisplay) === normaliseForComparison(input.field, input.observedValue ?? "");
    outcome = same ? "MATCH" : "MISMATCH";
  } else if (outcome == null) {
    throw validationError({ outcome: ["Choose the outcome of this manual check."] }, "The check needs attention.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const check = await tx.verificationCheck.create({
      data: {
        fdrId: fdr.id,
        fdrVersionNo: fdr.currentVersion,
        field: input.field,
        submittedValue: submittedDisplay,
        observedValue: (input.observedValue ?? "").length > 0 ? input.observedValue : null,
        source: input.source,
        outcome: outcome!,
        reason: (input.reason ?? "").length > 0 ? input.reason : null,
        evidenceRef: (input.evidenceRef ?? "").length > 0 ? input.evidenceRef : null,
        checkedById: user.id,
        dependentFields: dependentFieldsFor(input.field as never),
      },
      select: { id: true },
    });

    // SAMPLE rule: a recorded MISMATCH marks the case as a discrepancy.
    if (outcome === "MISMATCH" && fdr.status === "under_review") {
      await tx.fdr.updateMany({
        where: { id: fdr.id, status: "under_review" },
        data: { status: "discrepancy" },
      });
    }
    if (outcome === "MISMATCH" && fdr.status === "submitted") {
      await tx.fdr.updateMany({
        where: { id: fdr.id, status: "submitted" },
        data: { status: "discrepancy" },
      });
    }

    await tx.auditEvent.create({
      data: {
        action: "CHECK_RECORDED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "verification_check",
        entityId: String(check.id),
        detail: {
          field: input.field,
          outcome: outcome!,
          source: input.source,
          evidenceRef: input.evidenceRef ?? null,
          note: (input.reason ?? "").length > 0 ? input.reason : `Outcome ${outcome} on ${fieldLabel(input.field)}`,
        },
      },
    });

    return check;
  });

  await createNotification({
    institutionId: fdr.institutionId,
    title: `Check recorded on ${fdr.publicCode}`,
    body: `${fieldLabel(input.field)}: ${outcome === "MISMATCH" ? "a mismatch was recorded and needs a correction." : `outcome ${outcome}.`}`,
    linkPath: `/cases/${fdr.id}`,
  });

  await recordAudit({
    action: "CHECK_RECORDED",
    actorUserId: user.id,
    institutionId: fdr.institutionId,
    fdrId: fdr.id,
    entityType: "verification_check",
    entityId: String(created.id),
    detail: {
      field: input.field,
      outcome: outcome!,
      source: input.source,
      publicCode: fdr.publicCode,
    },
  });

  return { fdrId: fdr.id, message: `Check recorded for ${fieldLabel(input.field)}.` };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export async function verifyCase(
  user: AuthenticatedUser,
  fdrId: number,
  note: string,
): Promise<WorkflowResult> {
  const institutionId = await assertReviewCapability(user, fdrId);

  const fdr = await prisma.fdr.findUnique({ where: { id: fdrId }, include: CASE_INCLUDE });
  if (fdr == null) throw notFound("The case does not exist.");

  const [currentVersionNo, corrections, documentCount, checks] = await Promise.all([
    fdr.currentVersion,
    prisma.correctionRequest.count({ where: { fdrId, status: "OPEN" } }),
    fdr._count.documents,
    prisma.verificationCheck.findMany({
      where: { fdrId },
      orderBy: { checkedAt: "asc" },
    }),
  ]);

  const today = businessToday();
  const readinessInput: ReadinessInput = {
    today,
    case: {
      id: fdr.id,
      publicCode: fdr.publicCode,
      status: fdr.status,
      currentVersionNo,
      amountMinor: fdr.amountMinor,
      issueDate: fdr.issueDate.toISOString().slice(0, 10),
      maturityDate: fdr.maturityDate.toISOString().slice(0, 10),
      supersededByFdrId: fdr.supersededByFdrId,
      previousFdrId: fdr.previousFdrId,
      institutionStatus: (await prisma.institution.findUnique({
        where: { id: institutionId },
        select: { status: true },
      }))?.status ?? "ACTIVE",
    },
    documents: { count: documentCount },
    checks: {
      currentVersionChecks: checks.map((row) => ({
        id: row.id,
        field: row.field,
        source: row.source,
        outcome: row.outcome,
        submittedValue: row.submittedValue,
        observedValue: row.observedValue,
        reason: row.reason,
        evidenceRef: row.evidenceRef,
        checkedByName: null,
        checkedAt: row.checkedAt.toISOString(),
        fdrVersionNo: row.fdrVersionNo,
        invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
        invalidatedVersionNo: row.invalidatedVersionNo,
        invalidatedReason: row.invalidatedReason,
        dependentFields: row.dependentFields,
      })),
    },
    corrections: { openCorrections: corrections },
    release: null,
    previous:
      (await (fdr.previousFdrId == null
        ? Promise.resolve(null)
        : prisma.fdr.findUnique({
            where: { id: fdr.previousFdrId },
            select: {
              id: true,
              publicCode: true,
              maturityDate: true,
              amountMinor: true,
              status: true,
              supersededByFdrId: true,
            },
          }).then((row) =>
            row == null
              ? null
              : {
                  id: row.id,
                  publicCode: row.publicCode,
                  maturityDate: row.maturityDate.toISOString().slice(0, 10),
                  amountMinor: row.amountMinor,
                  status: row.status,
                  supersededByFdrId: row.supersededByFdrId,
                },
          )) as ReadinessInput["previous"]),
  };

  const readiness = evaluateVerificationReadiness(readinessInput);
  if (readiness.blockers.length > 0) {
    throw conflict(
      `This case cannot be verified yet. Remaining readiness blockers: ${readiness.blockers.join(" | ")}`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.fdr.updateMany({
      where: { id: fdrId, status: { in: ["submitted", "under_review", "discrepancy"] } },
      data: { status: "verified", verifiedAt: new Date() },
    });
    if (updated.count === 0) {
      throw conflict("Only submitted or in-review cases can be verified.");
    }

    await tx.task.updateMany({
      where: {
        fdrId,
        type: "VERIFICATION_REVIEW",
        status: { in: ["OPEN", "IN_PROGRESS"] },
        deduplicationKey: { startsWith: `REVIEW:${fdrId}` },
      },
      data: { status: "DONE", closedAt: new Date(), closedNote: "Verification completed." },
    });

    // Renewal case: open acceptance tasks for every approving authority row.
    let previous: { id: number; supersededByFdrId: number | null; publicCode: string } | null = null;
    if (fdr.previousFdrId != null) {
      const row = await tx.fdr.findUnique({
        where: { id: fdr.previousFdrId },
        select: { id: true, publicCode: true, supersededByFdrId: true },
      });
      previous = row;
    }

    const authorityRows =
      fdr.previousFdrId != null && previous != null && previous.supersededByFdrId == null
        ? await tx.officerJurisdiction.findMany({
            where: { institutionId: fdr.institutionId, role: "APPROVING_AUTHORITY" },
            select: { officerId: true },
          })
        : [];

    if (authorityRows.length > 0) {
      await tx.task.createMany({
        data: authorityRows.map((officer) => ({
          fdrId,
          type: "REPLACEMENT_ACCEPTANCE" as const,
          title: `Accept replacement ${fdr.publicCode}`,
          detail: `The verified replacement of ${previous!.publicCode} awaits acceptance.`,
          status: "OPEN" as const,
          assigneeUserId: officer.officerId,
          dueDate: new Date(`${addDaysFrom(today, 3)}T00:00:00.000Z`),
          deduplicationKey: `REPLACC:${fdrId}:${officer.officerId}`,
          policyVersion: "sample-v0.1",
        })),
        skipDuplicates: true,
      });
    }

    await tx.auditEvent.create({
      data: {
        action: "CASE_VERIFIED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId,
        entityType: "fdr",
        entityId: String(fdrId),
        detail: { publicCode: fdr.publicCode, note: note.length > 0 ? note : "verified", versionNo: fdr.currentVersion },
      },
    });

    return { authorityOfficerIds: authorityRows.map((row) => row.officerId), publicCode: fdr.publicCode };
  });

  await createNotifications([
    {
      institutionId: fdr.institutionId,
      title: `${fdr.publicCode} verified`,
      body: "The reviewing officer completed verification of your case.",
      linkPath: `/cases/${fdrId}`,
    },
    ...result.authorityOfficerIds.map((officerId) => ({
      userId: officerId,
      title: `Replacement awaiting acceptance: ${fdr.publicCode}`,
      body: `The verified replacement of instrument ${fdr.publicCode} awaits your acceptance.`,
      linkPath: `/cases/${fdrId}`,
    })),
  ]);

  return { fdrId, status: "verified", message: "Case verified." };
}

function addDaysFrom(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
