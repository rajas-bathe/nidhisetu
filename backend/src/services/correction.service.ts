/**
 * Correction workflow: the reviewing officer lists fields that need correction,
 * the college responds with corrected values. The response is written as the
 * NEXT immutable version (never an overwrite of the reviewed snapshot), the
 * case returns to "under_review", and every recorded check that relied on a
 * changed field is invalidated transactionally. Any stale "recommended" release
 * decision is auto-withdrawn so a stale recommendation can never decide a case
 * whose data just changed.
 */
import type { Prisma } from "@prisma/client";
import type {
  CorrectionCreateRequest,
  CorrectionItem,
  CorrectionRespondRequest,
  WorkflowResult,
} from "@sih26265/contracts";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { businessToday } from "../utils/dates.js";
import { rupeesToMinorUnits } from "../utils/money.js";
import { fieldLabel, isCorrectableField } from "../rules/checkFields.js";
import { serializeCorrection } from "../dto/serialize.js";
import { createNotification, createNotifications } from "./notification.service.js";
import { assertOfficerCapability, getAccessScope } from "./scope.service.js";
import { closeTaskByKeyInTx } from "./task.service.js";
import { withdrawStaleRecommendationsInTx } from "./release.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";
import type { PaginatedResponse } from "./fdr.service.js";

export interface ListCorrectionsOptions {
  page: number;
  pageSize: number;
  status?: "OPEN" | "RESPONDED" | "CANCELLED";
  fdrId?: number;
  institutionId?: number;
}

export async function listCorrections(
  user: AuthenticatedUser,
  opts: ListCorrectionsOptions,
): Promise<PaginatedResponse<CorrectionItem>> {
  const scope = await getAccessScope(user);
  const conditions: Prisma.CorrectionRequestWhereInput[] = [];

  if (!scope.isGlobal) {
    conditions.push({ fdr: { institutionId: { in: scope.institutionIds } } });
  }
  if (opts.status != null) conditions.push({ status: opts.status });
  if (opts.fdrId != null) conditions.push({ fdrId: opts.fdrId });
  if (opts.institutionId != null) {
    if (scope.isGlobal || scope.institutionIds.includes(opts.institutionId)) {
      conditions.push({ fdr: { institutionId: opts.institutionId } });
    } else {
      // Never leak: a filter outside the scope yields no rows, not different rows.
      conditions.push({ id: -1 });
    }
  }

  const where: Prisma.CorrectionRequestWhereInput = { AND: conditions };

  const [rows, total] = await Promise.all([
    prisma.correctionRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: Math.min(opts.pageSize, 100),
      include: {
        fdr: { select: { publicCode: true, institutionId: true, institution: { select: { name: true } } } },
        requestedBy: { select: { fullName: true } },
        respondedBy: { select: { fullName: true } },
      },
    }),
    prisma.correctionRequest.count({ where }),
  ]);

  return {
    items: rows.map((row) =>
      serializeCorrection({
        ...row,
        fdr: {
          publicCode: row.fdr.publicCode,
          institutionId: row.fdr.institutionId,
          institution: row.fdr.institution,
        },
      }),
    ),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Officer raises a correction request
// ---------------------------------------------------------------------------

export async function createCorrection(
  user: AuthenticatedUser,
  input: CorrectionCreateRequest,
): Promise<WorkflowResult> {
  const fdr = await prisma.fdr.findUnique({
    where: { id: input.fdrId },
    select: { id: true, publicCode: true, institutionId: true, status: true, currentVersion: true },
  });
  if (fdr == null) throw notFound("The case does not exist.");

  if (user.role !== "REVIEW_OFFICER") {
    throw forbidden("Only the reviewing officer can request corrections.");
  }
  await assertOfficerCapability(user, fdr.institutionId, "REVIEW_OFFICER");

  const reviewable = ["submitted", "under_review", "discrepancy"];
  if (!reviewable.includes(fdr.status)) {
    throw conflict("Corrections can only be requested while a case is in review.");
  }

  // Farm the field list: unique, registry fields only, reason required per field.
  const fieldErrors: Record<string, string[]> = {};
  const seen = new Set<string>();
  const processedFields: Array<{ field: string; label: string; reason: string }> = [];
  input.fields.forEach((entry, index) => {
    if (!isCorrectableField(entry.field)) {
      fieldErrors[`fields.${index}.field`] = ["This field is not correctable."];
      return;
    }
    if (seen.has(entry.field)) {
      fieldErrors[`fields.${index}.field`] = ["The same field was listed twice."];
      return;
    }
    seen.add(entry.field);
    processedFields.push({ field: entry.field, label: fieldLabel(entry.field), reason: entry.reason });
  });

  // Reject corrections for fields already being corrected by an OPEN request.
  const openCorrections = await prisma.correctionRequest.findMany({
    where: { fdrId: fdr.id, status: "OPEN" },
    select: { fields: true, id: true },
  });
  for (const open of openCorrections) {
    const openFields = Array.isArray(open.fields)
      ? (open.fields as Array<{ field?: string }>).map((entry) => String(entry.field ?? ""))
      : [];
    for (const field of processedFields.map((entry) => entry.field)) {
      if (openFields.includes(field)) {
        fieldErrors.fields = [
          `An open correction already covers ${fieldLabel(field)} (correction #${open.id}). Respond to it first or cancel it.`,
        ];
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The correction request needs attention.");
  }

  await prisma.$transaction(async (tx) => {
    const correction = await tx.correctionRequest.create({
      data: {
        fdrId: fdr.id,
        fdrVersionNo: fdr.currentVersion,
        fields: processedFields,
        note: input.note && input.note.length > 0 ? input.note : null,
        status: "OPEN",
        requestedById: user.id,
      },
      select: { id: true },
    });

    await tx.task.createMany({
      data: [
        {
          fdrId: fdr.id,
          type: "DOCUMENT_CORRECTION" as const,
          title: `Correct fields on ${fdr.publicCode}`,
          detail: `The reviewing officer asked the college to correct: ${processedFields.map((entry) => entry.label).join(", ")}.`,
          status: "OPEN" as const,
          assigneeInstitutionId: fdr.institutionId,
          dueDate: new Date(`${addDaysFrom(businessToday(), 5)}T00:00:00.000Z`),
          deduplicationKey: `CORR:${correction.id}`,
          policyVersion: "sample-v0.1",
        },
      ],
      skipDuplicates: true,
    });

    await tx.auditEvent.create({
      data: {
        action: "CORRECTION_REQUESTED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "correction_request",
        entityId: String(correction.id),
        detail: {
          fields: processedFields.map((entry) => entry.field),
          note: input.note && input.note.length > 0 ? input.note : `Review of version ${fdr.currentVersion} needs corrections.`,
        },
      },
    });
  });

  await createNotification({
    institutionId: fdr.institutionId,
    title: `Corrections requested for ${fdr.publicCode}`,
    body: `The reviewing officer requested corrections to: ${processedFields.map((entry) => entry.label).join(", ")}.`,
    linkPath: `/fdrs/${fdr.id}`,
  });

  return { fdrId: fdr.id, message: "Correction request sent to the college." };
}

// ---------------------------------------------------------------------------
// College responds (next immutable version + transactional invalidation)
// ---------------------------------------------------------------------------

interface ParsedValue {
  field: string;
  display: string;
}

function parseCorrectedValue(field: string, raw: string, fieldErrors: Record<string, string[]>, index: number): ParsedValue | null {
  const path = `values.${index}.value`;

  switch (field) {
    case "amount": {
      const minor = rupeesToMinorUnits(raw);
      if (minor == null || minor <= 0n) {
        fieldErrors[path] = ["Enter the amount in rupees, at most two decimal places."];
        return null;
      }
      return { field, display: minorToRupees(minor) };
    }
    case "maturity_date":
    case "issue_date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
        fieldErrors[path] = ["Use the YYYY-MM-DD date format."];
        return null;
      }
      return { field, display: raw.trim() };
    }
    case "ifsc": {
      const value = raw.trim().toUpperCase();
      if (value.length === 0) {
        fieldErrors[path] = ["The IFSC code is required."];
        return null;
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value)) {
        fieldErrors[path] = ["Use a valid IFSC code."];
        return null;
      }
      return { field, display: value };
    }
    default: {
      const value = raw.trim();
      if (value.length === 0) {
        fieldErrors[path] = ["The value must not be empty."];
        return null;
      }
      if (value.length > 200) {
        fieldErrors[path] = ["Keep the value under 200 characters."];
        return null;
      }
      return { field, display: value };
    }
  }
}

/** Exact rupee display ("1234.50") from minor units. */
function minorToRupees(minor: bigint): string {
  const whole = minor / 100n;
  const paise = (minor % 100n).toString().padStart(2, "0");
  return `${whole}.${paise}`;
}

function patchFromDisplays(
  displays: ParsedValue[],
  fieldErrors: Record<string, string[]>,
): Partial<{
  instrumentType: "SECURITY_DEPOSIT" | "BANK_GUARANTEE";
  bankName: string;
  bankBranch: string;
  referenceNo: string;
  ifsc: string;
  beneficiaryName: string;
  amountMinor: bigint;
  issueDate: Date;
  maturityDate: Date;
}> {
  const patch: Parameters<typeof patchFromDisplays>[1] extends never ? never : Record<string, unknown> = {};
  for (const display of displays) {
    switch (display.field) {
      case "amount": {
        const minor = rupeesToMinorUnits(display.display);
        if (minor == null) {
          fieldErrors.amount = ["The amount could not be recorded."];
        } else {
          patch.amountMinor = minor;
        }
        break;
      }
      case "reference_no":
        patch.referenceNo = display.display;
        break;
      case "bank_name":
        patch.bankName = display.display;
        break;
      case "bank_branch":
        patch.bankBranch = display.display;
        break;
      case "ifsc":
        patch.ifsc = display.display;
        break;
      case "beneficiary_name":
        patch.beneficiaryName = display.display;
        break;
      case "issue_date":
        patch.issueDate = new Date(`${display.display}T00:00:00.000Z`);
        break;
      case "maturity_date":
        patch.maturityDate = new Date(`${display.display}T00:00:00.000Z`);
        break;
      case "instrument_type":
        if (display.display.toUpperCase() === "BANK_GUARANTEE") {
          patch.instrumentType = "BANK_GUARANTEE";
        } else if (display.display.toUpperCase() === "SECURITY_DEPOSIT") {
          patch.instrumentType = "SECURITY_DEPOSIT";
        } else {
          fieldErrors.instrumentType = ["The instrument type must be security deposit or bank guarantee."];
        }
        break;
      default:
        break;
    }
  }
  return patch;
}

export async function respondCorrection(
  user: AuthenticatedUser,
  input: CorrectionRespondRequest,
): Promise<WorkflowResult> {
  if (user.role !== "COLLEGE_USER" || user.institutionId == null) {
    throw forbidden("Only the college representative can respond to corrections.");
  }

  const correction = await prisma.correctionRequest.findUnique({
    where: { id: input.correctionId },
    include: {
      fdr: {
        select: {
          id: true,
          publicCode: true,
          institutionId: true,
          status: true,
          currentVersion: true,
          instrumentType: true,
          bankName: true,
          bankBranch: true,
          referenceNo: true,
          ifsc: true,
          beneficiaryName: true,
          amountMinor: true,
          currency: true,
          issueDate: true,
          maturityDate: true,
          remarks: true,
        },
      },
    },
  });
  if (correction == null) throw notFound("The correction does not exist.");
  if (correction.fdr.institutionId !== user.institutionId) {
    throw forbidden("This correction belongs to another institution.");
  }
  if (correction.status !== "OPEN") {
    throw conflict("This correction has already been answered or cancelled.");
  }
  const fdr = correction.fdr;
  if (fdr.status !== "under_review" && fdr.status !== "discrepancy") {
    throw conflict("Corrections can be answered only while the case is in review.");
  }

  const requestedFields = Array.isArray(correction.fields)
    ? (correction.fields as Array<{ field?: string; label?: string; reason?: string }>)
    : [];
  const requestedSet = new Set(requestedFields.map((entry) => String(entry.field ?? "")));

  // Every response value must target a requested field; each listed field need
  // not be answered at once, but at least one must be corrected.
  const fieldErrors: Record<string, string[]> = {};
  const displays: ParsedValue[] = [];
  input.values.forEach((entry, index) => {
    if (!requestedSet.has(entry.field)) {
      fieldErrors[`values.${index}.field`] = ["This field was not part of the correction request."];
      return;
    }
    if (!isCorrectableField(entry.field)) {
      fieldErrors[`values.${index}.field`] = ["This field is not correctable."];
      return;
    }
    const parsed = parseCorrectedValue(entry.field, entry.value, fieldErrors, index);
    if (parsed != null) displays.push(parsed);
  });
  if (displays.length === 0 && Object.keys(fieldErrors).length === 0) {
    fieldErrors.values = ["Provide the corrected value for at least one requested field."];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The response needs attention before it can be recorded.");
  }

  const patch = patchFromDisplays(displays, fieldErrors);
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The response needs attention before it can be recorded.");
  }

  const nextVersionNo = fdr.currentVersion + 1;
  const now = new Date();
  const reason = input.note && input.note.length > 0 ? input.note : "Correction response recorded.";

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.correctionRequest.updateMany({
      where: { id: correction.id, status: "OPEN" },
      data: {
        status: "RESPONDED",
        respondedById: user.id,
        respondedVersionNo: nextVersionNo,
        respondNote: input.note && input.note.length > 0 ? input.note : null,
        respondedAt: now,
      },
    });
    if (claimed.count === 0) {
      throw conflict("The correction changed on the server; reload and try again.");
    }

    const has = <K extends keyof typeof patch>(key: K): boolean => patch[key] !== undefined;

    // 1) The next immutable version snapshot (full reviewed state + corrections).
    await tx.fdrVersion.create({
      data: {
        fdrId: fdr.id,
        versionNo: nextVersionNo,
        instrumentType: has("instrumentType") ? (patch.instrumentType as "SECURITY_DEPOSIT" | "BANK_GUARANTEE") : fdr.instrumentType,
        bankName: has("bankName") ? (patch.bankName as string) : fdr.bankName,
        bankBranch: has("bankBranch") ? (patch.bankBranch as string) : fdr.bankBranch,
        referenceNo: has("referenceNo") ? (patch.referenceNo as string) : fdr.referenceNo,
        ifsc: has("ifsc") ? (patch.ifsc as string) : fdr.ifsc,
        beneficiaryName: has("beneficiaryName") ? (patch.beneficiaryName as string) : fdr.beneficiaryName,
        amountMinor: has("amountMinor") ? (patch.amountMinor as bigint) : fdr.amountMinor,
        currency: fdr.currency,
        issueDate: has("issueDate") ? (patch.issueDate as Date) : fdr.issueDate,
        maturityDate: has("maturityDate") ? (patch.maturityDate as Date) : fdr.maturityDate,
        remarks: fdr.remarks,
        submittedById: user.id,
      },
      select: { id: true },
    });

    // 2) The case row advances to the corrected content and state.
    await tx.fdr.update({
      where: { id: fdr.id },
      data: {
        ...patch,
        status: "under_review",
        currentVersion: nextVersionNo,
      },
    });

    // 3) Invalidate checks that relied on any changed field (same transaction).
    const checksInfluenced = await tx.verificationCheck.findMany({
      where: { fdrId: fdr.id, fdrVersionNo: fdr.currentVersion, invalidatedAt: null },
      select: { id: true, field: true, dependentFields: true },
    });
    const changedFields = new Set(displays.map((entry) => entry.field));
    const toInvalidate = checksInfluenced
      .filter(
        (check) =>
          changedFields.has(check.field) ||
          (check.dependentFields ?? []).some((dep) => changedFields.has(dep)),
      )
      .map((check) => check.id);
    if (toInvalidate.length > 0) {
      await tx.verificationCheck.updateMany({
        where: { id: { in: toInvalidate } },
        data: {
          invalidatedAt: now,
          invalidatedVersionNo: nextVersionNo,
          invalidatedReason: `Superseded by correction response #${correction.id} (version ${nextVersionNo}); re-check the corrected values.`,
        },
      });
    }

    // 4) The correction's task and stale release recommendations go with it.
    await closeTaskByKeyInTx(tx, `CORR:${correction.id}`, "Correction response recorded.");
    await withdrawStaleRecommendationsInTx(
      tx,
      fdr.id,
      "Release recommendation withdrawn: the case data changed through a correction response.",
    );

    await tx.auditEvent.create({
      data: {
        action: "CORRECTION_RESPONDED",
        actorUserId: user.id,
        institutionId: fdr.institutionId,
        fdrId: fdr.id,
        entityType: "correction_request",
        entityId: String(correction.id),
        detail: {
          fromVersion: fdr.currentVersion,
          toVersion: nextVersionNo,
          fields: displays.map((entry) => entry.field),
          note: reason,
        },
      },
    });
  });

  await createNotifications([
    {
      userId: correction.requestedById,
      title: `Correction response recorded for ${fdr.publicCode}`,
      body: `The college corrected ${displays.map((entry) => fieldLabel(entry.field)).join(", ")}. Checks relying on those fields were invalidated; the case is back under review.`,
      linkPath: `/fdrs/${fdr.id}`,
    },
    {
      institutionId: fdr.institutionId,
      title: `Response recorded for ${fdr.publicCode}`,
      body: "Your correction response created a new version; the reviewing officer will re-check it.",
      linkPath: `/fdrs/${fdr.id}`,
    },
  ]);

  return {
    fdrId: fdr.id,
    status: "under_review",
    versionNo: nextVersionNo,
    message: "Correction response recorded; a new version is under review.",
  };
}

// ---------------------------------------------------------------------------
// Officer cancels an open request
// ---------------------------------------------------------------------------

export async function cancelCorrection(user: AuthenticatedUser, correctionId: number): Promise<WorkflowResult> {
  const correction = await prisma.correctionRequest.findUnique({
    where: { id: correctionId },
    include: { fdr: { select: { id: true, publicCode: true, institutionId: true, status: true } } },
  });
  if (correction == null) throw notFound("The correction does not exist.");
  if (user.role !== "REVIEW_OFFICER") {
    throw forbidden("Only the reviewing officer can cancel corrections.");
  }
  await assertOfficerCapability(user, correction.fdr.institutionId, "REVIEW_OFFICER");
  if (correction.status !== "OPEN") {
    throw conflict("Only open corrections can be cancelled.");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.correctionRequest.updateMany({
      where: { id: correction.id, status: "OPEN" },
      data: { status: "CANCELLED", cancelledById: user.id, cancelledAt: now },
    });
    if (cancelled.count === 0) {
      throw conflict("The correction changed on the server; reload.");
    }
    await tx.task.updateMany({
      where: {
        fdrId: correction.fdr.id,
        type: "DOCUMENT_CORRECTION",
        deduplicationKey: { startsWith: `CORR:${correction.id}` },
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      data: { status: "CANCELLED", closedAt: now, closedNote: "Correction cancelled by the officer." },
    });
    await tx.auditEvent.create({
      data: {
        action: "CORRECTION_CANCELLED",
        actorUserId: user.id,
        institutionId: correction.fdr.institutionId,
        fdrId: correction.fdr.id,
        entityType: "correction_request",
        entityId: String(correction.id),
        detail: { note: "The officer cancelled the open correction request." },
      },
    });
  });

  await createNotification({
    institutionId: correction.fdr.institutionId,
    title: `Correction cancelled for ${correction.fdr.publicCode}`,
    body: "The reviewing officer cancelled an open correction request; the case stays in review.",
    linkPath: `/fdrs/${correction.fdr.id}`,
  });

  return { fdrId: correction.fdr.id, message: "Correction cancelled." };
}

function addDaysFrom(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
