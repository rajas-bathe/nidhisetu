/**
 * College-side case writing: draft creation/edits and the atomic submit.
 *
 * Rules enforced here (server-side, never trusted from the client):
 * - Only the college of the institution may create/submit; admins cannot.
 * - Submitting requires the case to have a documented reason and all core
 *   fields on the current draft (validation errors are field-specific).
 * - Submit atomically creates version 1, moves the case, opens review tasks
 *   for the jurisdiction's reviewing officers, and writes an audit event.
 * - Submitted records are immutable for colleges: edits route through the
 *   correction workflow.
 */
import { Prisma } from "@prisma/client";
import type { CaseSubmissionResult, FdrDraftInput, FdrDraftUpdate } from "@sih26265/contracts";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { businessToday, parseLocalDate } from "../utils/dates.js";
import { rupeesToMinorUnits } from "../utils/money.js";
import { recordAudit } from "./audit.service.js";
import { createNotifications } from "./notification.service.js";
import { assertInstitutionInScope, assertInstitutionAcceptsSubmissions, getAccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

export function parseMoneyField(amountRupees: string, fieldErrors: Record<string, string[]>, key = "amountRupees"): bigint {
  const minor = rupeesToMinorUnits(amountRupees);
  if (minor == null) {
    fieldErrors[key] = ["Enter the deposit amount in rupees, at most two decimal places."];
    return 0n;
  }
  if (minor <= 0n) {
    fieldErrors[key] = ["The deposit amount must be greater than zero."];
    return 0n;
  }
  return minor;
}

export function draftValuesFromInput(input: FdrDraftInput, fieldErrors: Record<string, string[]>) {
  const amountMinor = parseMoneyField(input.amountRupees, fieldErrors);
  return {
    instrumentType: input.instrumentType,
    bankName: input.bankName,
    bankBranch: input.bankBranch,
    referenceNo: input.referenceNo,
    ifsc: input.ifsc && input.ifsc.length > 0 ? input.ifsc : null,
    beneficiaryName: input.beneficiaryName && input.beneficiaryName.length > 0 ? input.beneficiaryName : null,
    amountMinor,
    issueDate: input.issueDate,
    maturityDate: input.maturityDate,
    remarks: input.remarks && input.remarks.length > 0 ? input.remarks : null,
  };
}

function publicCodeFor(id: number): string {
  const year = new Date().getFullYear();
  return `FDR-${year}-${String(id).padStart(4, "0")}`;
}

function assertDraftFields(status: Record<string, unknown>, fieldErrors: Record<string, string[]>): void {
  const required: Array<[string, unknown]> = [
    ["bankName", status.bankName],
    ["bankBranch", status.bankBranch],
    ["referenceNo", status.referenceNo],
  ];
  for (const [key, value] of required) {
    if (typeof value !== "string" || value.trim().length < 2) {
      fieldErrors[key] = ["This field is required."];
    }
  }
  if (typeof status.amountMinor !== "bigint" || status.amountMinor === 0n) {
    fieldErrors.amountRupees = ["Enter the deposit amount in rupees."];
  }
}

// ---------------------------------------------------------------------------
// Draft lifecycle
// ---------------------------------------------------------------------------

export async function createDraft(
  user: AuthenticatedUser,
  input: FdrDraftInput,
  replacesFdrId?: number,
): Promise<CaseSubmissionResult> {
  if (user.role !== "COLLEGE_USER" || user.institutionId == null) {
    throw forbidden("Only college representatives can create case drafts.");
  }
  const fieldErrors: Record<string, string[]> = {};
  const values = draftValuesFromInput(input, fieldErrors);
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors);
  }

  const institutionId = user.institutionId;
  const scope = await getAccessScope(user);
  assertInstitutionInScope(scope, institutionId);
  await assertInstitutionAcceptsSubmissions(institutionId);

  let previousFdrId: number | null = null;
  if (replacesFdrId != null) {
    previousFdrId = await validateReplacementTarget(user, replacesFdrId, institutionId);
  }

  const created = await prisma.$transaction(async (tx) => {
    const fdr = await tx.fdr.create({
      data: {
        publicCode: `FDR-TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        institutionId,
        bankName: values.bankName,
        bankBranch: values.bankBranch,
        referenceNo: values.referenceNo,
        ifsc: values.ifsc,
        beneficiaryName: values.beneficiaryName,
        amountMinor: values.amountMinor,
        currency: "INR",
        issueDate: parseLocalDate(values.issueDate),
        maturityDate: parseLocalDate(values.maturityDate),
        remarks: values.remarks,
        instrumentType: values.instrumentType,
        status: "draft",
        previousFdrId,
      },
      select: { id: true },
    });
    const updated = await tx.fdr.update({
      where: { id: fdr.id },
      data: { publicCode: publicCodeFor(fdr.id) },
      select: { publicCode: true },
    });
    // Drafts carry no published version yet; submit() stamps version 1.
    return { fdrId: fdr.id, publicCode: updated.publicCode, versionNo: 0 };
  });

  await recordAudit({
    action: "CASE_DRAFT_CREATED",
    actorUserId: user.id,
    institutionId,
    fdrId: created.fdrId,
    entityType: "fdr",
    entityId: created.fdrId,
    detail: { publicCode: created.publicCode, instrumentType: values.instrumentType },
  });

  return created;
}

/**
 * Draft edits. Only the owning college may edit, and only while the case is a
 * draft. baseUpdatedAt provides lightweight optimistic concurrency.
 */
export async function updateDraft(
  user: AuthenticatedUser,
  fdrId: number,
  patch: FdrDraftUpdate,
): Promise<{ updatedAt: string }> {
  if (user.role !== "COLLEGE_USER" || user.institutionId == null) {
    throw forbidden("Only college representatives can edit drafts.");
  }

  const fdr = await prisma.fdr.findFirst({
    where: { id: fdrId, institutionId: user.institutionId },
    select: { id: true, status: true, updatedAt: true, instrumentType: true, currentVersion: true },
  });
  if (fdr == null) {
    // Same shape as a missing case: no scope leak.
    throw notFound("The case does not exist.");
  }
  if (fdr.status !== "draft") {
    throw conflict(
      "This case was already submitted. Corrections now flow through the correction workflow instead of editing.",
    );
  }
  if (patch.baseUpdatedAt != null && patch.baseUpdatedAt !== fdr.updatedAt.toISOString()) {
    throw conflict(
      "The draft changed on the server while you were editing. Reload the draft and try again.",
    );
  }

  const fieldErrors: Record<string, string[]> = {};
  const data: Prisma.FdrUpdateInput = {};
  if (patch.instrumentType != null) data.instrumentType = patch.instrumentType;
  if (patch.bankName != null) data.bankName = patch.bankName;
  if (patch.bankBranch != null) data.bankBranch = patch.bankBranch;
  if (patch.referenceNo != null) data.referenceNo = patch.referenceNo;
  if (patch.ifsc !== undefined) data.ifsc = patch.ifsc.length > 0 ? patch.ifsc : null;
  if (patch.beneficiaryName !== undefined) data.beneficiaryName = patch.beneficiaryName.length > 0 ? patch.beneficiaryName : null;
  if (patch.remarks !== undefined) data.remarks = patch.remarks.length > 0 ? patch.remarks : null;
  if (patch.amountRupees != null) {
    const minor = rupeesToMinorUnits(patch.amountRupees);
    if (minor == null || minor <= 0n) {
      fieldErrors.amountRupees = ["Enter the deposit amount in rupees, at most two decimal places."];
    } else {
      data.amountMinor = minor;
    }
  }
  if (patch.issueDate != null) data.issueDate = parseLocalDate(patch.issueDate);
  if (patch.maturityDate != null) data.maturityDate = parseLocalDate(patch.maturityDate);
  if (fieldErrors.issueDate === undefined && data.issueDate != null && data.maturityDate != null) {
    const issueAt = data.issueDate as Date;
    const maturityAt = data.maturityDate as Date;
    if (maturityAt.getTime() <= issueAt.getTime()) {
      fieldErrors.maturityDate = ["The maturity date must be after the issue date."];
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors);
  }

  const updated = await prisma.fdr.update({
    where: { id: fdr.id },
    data: { ...data, updatedAt: new Date() },
    select: { updatedAt: true },
  });

  await recordAudit({
    action: "CASE_DRAFT_UPDATED",
    actorUserId: user.id,
    institutionId: user.institutionId,
    fdrId: fdr.id,
    entityType: "fdr",
    entityId: fdr.id,
    detail: { fields: Object.keys(data) },
  });

  return { updatedAt: updated.updatedAt.toISOString() };
}

/**
 * Atomic submit. Preconditions (readiness gate):
 * - the case is a draft of the caller's institution;
 * - core fields are set and consistent;
 * - at least one supporting document is attached (SAMPLE rule).
 * The transaction writes: first version, status/submittedAt, review tasks for
 * every reviewing-officer jurisdiction row (or an institution task as
 * fallback), audit event. or notifications.
 */
export async function submitDraft(user: AuthenticatedUser, fdrId: number): Promise<CaseSubmissionResult> {
  if (user.role !== "COLLEGE_USER" || user.institutionId == null) {
    throw forbidden("Only college representatives can submit cases.");
  }

  const fdr = await prisma.fdr.findFirst({
    where: { id: fdrId, institutionId: user.institutionId },
    include: {
      _count: { select: { documents: true } },
      replaces: { select: { id: true, publicCode: true } },
    },
  });
  if (fdr == null) {
    throw notFound("The case does not exist.");
  }
  if (fdr.status !== "draft") {
    throw conflict("This case was already submitted.");
  }

  await assertInstitutionAcceptsSubmissions(user.institutionId);

  const fieldErrors: Record<string, string[]> = {};
  assertDraftFields(
    {
      bankName: fdr.bankName,
      bankBranch: fdr.bankBranch,
      referenceNo: fdr.referenceNo,
      amountMinor: fdr.amountMinor,
    },
    fieldErrors,
  );
  if (fdr._count.documents === 0) {
    fieldErrors.documents = ["Attach at least one supporting document before submitting (SAMPLE requirement)."];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The submission needs attention.");
  }

  const reviewerIds = await prisma.officerJurisdiction.findMany({
    where: { institutionId: user.institutionId, role: "REVIEW_OFFICER" },
    select: { officerId: true },
  });

  const submittedBy = user.id;
  const today = businessToday();

  const result = await prisma.$transaction(async (tx) => {
    const versionNo = 1;
    const createdVersion = await tx.fdrVersion.create({
      data: {
        fdrId: fdr.id,
        versionNo,
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
        submittedById: submittedBy,
      },
      select: { id: true },
    });

    const updatedCase = await tx.fdr.updateMany({
      where: { id: fdr.id, status: "draft" },
      data: { status: "submitted", submittedAt: new Date() },
    });
    if (updatedCase.count === 0) {
      throw conflict("This case was already submitted.");
    }
    void createdVersion;

    const tasks: Prisma.TaskCreateManyInput[] = reviewerIds.map((officer) => ({
      fdrId: fdr.id,
      type: "VERIFICATION_REVIEW" as const,
      title: `Review submission ${fdr.publicCode}`,
      detail: "Verify bank details, run the record checks and confirm the deposit amount.",
      status: "OPEN" as const,
      assigneeUserId: officer.officerId,
      dueDate: parseLocalDate(addDeadlineDays(today, 5)),
      deduplicationKey: `REVIEW:${fdr.id}:${officer.officerId}`,
      policyVersion: "sample-v0.1",
    }));
    if (tasks.length === 0) {
      tasks.push({
        fdrId: fdr.id,
        type: "VERIFICATION_REVIEW" as const,
        title: `Review submission ${fdr.publicCode}`,
        detail: "No reviewing officer is assigned yet; an administrator can assign one.",
        status: "OPEN" as const,
        assigneeUserId: null,
        assigneeInstitutionId: user.institutionId,
        dueDate: parseLocalDate(addDeadlineDays(today, 5)),
        deduplicationKey: `REVIEW:${fdr.id}`,
        policyVersion: "sample-v0.1",
      });
    }
    await tx.task.createMany({ data: tasks, skipDuplicates: true });

    await tx.fdr.update({
      where: { id: fdr.id },
      data: { currentVersion: 1 },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        action: "CASE_SUBMITTED",
        actorUserId: submittedBy,
        institutionId: user.institutionId,
        fdrId: fdr.id,
        entityType: "fdr",
        entityId: String(fdr.id),
        detail: { publicCode: fdr.publicCode, versionNo: 1 },
      },
    });

    return { fdrId: fdr.id, publicCode: fdr.publicCode, versionNo: 1 as const };
  });

  await createNotifications([
    ...reviewerIds.map((officer) => ({
      userId: officer.officerId,
      title: `New submission to review: ${fdr.publicCode}`,
      body: `${fdr.publicCode} was submitted and needs verification.`,
      linkPath: `/cases/${fdr.id}`,
    })),
    {
      institutionId: user.institutionId,
      title: `Submission created: ${fdr.publicCode}`,
      body: "Your case entered the review queue.",
      linkPath: `/cases/${fdr.id}`,
    },
  ]);

  return result;
}

/**
 * Validates a replacement target for a NEW linked instrument:
 * - target must be a case of the caller's own institution,
 * - not already superseded by an accepted replacement,
 * - have no other active successor (no pending replacement chain), so only
 *   one active replacement path exists per instrument at a time,
 * - never be a replacement itself (no chains: sample policy keeps the
 *   renewal history flat and auditable).
 */
export async function validateReplacementTarget(
  user: AuthenticatedUser,
  targetFdrId: number,
  institutionId: number,
): Promise<number> {
  const target = await prisma.fdr.findFirst({
    where: { id: targetFdrId, institutionId },
    select: {
      id: true,
      publicCode: true,
      supersededByFdrId: true,
      previousFdrId: true,
      successors: { select: { id: true, publicCode: true, supersededByFdrId: true } },
    },
  });
  if (target == null) {
    throw notFound("The instrument to replace does not exist in your institution.");
  }
  if (target.previousFdrId != null) {
    throw conflict(
      `${target.publicCode} is itself a replacement; chained replacements are not supported in this sample policy.`,
    );
  }
  if (target.supersededByFdrId != null) {
    throw conflict(
      `${target.publicCode} is already replaced and its renewal obligation is closed.`,
    );
  }
  const activeSuccessor = target.successors.find((row) => row.supersededByFdrId == null);
  if (activeSuccessor != null) {
    throw conflict(
      `${target.publicCode} already has an active replacement (${activeSuccessor.publicCode}). Each instrument supports one active replacement at a time.`,
    );
  }
  void user;
  return target.id;
}

function addDeadlineDays(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
