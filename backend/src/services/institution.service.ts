/**
 * System-administration college module.
 *
 * The admin manages colleges, officer assignments and status. Deliberate
 * limitations (sample scope):
 * - Admins never gain review/approval capabilities; they only supervise.
 * - Deactivation never deletes anything: history stays readable, but new
 *   submissions are blocked (SAMPLE policy) and the college's users lose
 *   their sessions immediately.
 */
import type {
  InstitutionDetail,
  InstitutionInput,
  InstitutionListItem,
  InstitutionListResponse,
  JurisdictionRole,
  PortfolioSummary,
} from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { businessToday } from "../utils/dates.js";
import { serializeFdr } from "../dto/serialize.js";
import { deriveDateCondition } from "../rules/dateCondition.js";
import { config } from "../config/env.js";
import { recordAudit } from "./audit.service.js";
import { createNotification } from "./notification.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

export interface ListInstitutionsOptions {
  page: number;
  pageSize: number;
  q?: string;
  status?: "ACTIVE" | "INACTIVE";
  assignment?: "assigned" | "unassigned";
  role?: JurisdictionRole;
  officerId?: number;
  sort: "name_asc" | "name_desc" | "created_asc" | "created_desc";
}

export function assertAdmin(user: AuthenticatedUser): void {
  if (user.role !== "SYSTEM_ADMIN") {
    throw forbidden("Only the system administrator can administer colleges.");
  }
}

const SORT_ORDER: Record<string, Prisma.InstitutionOrderByWithRelationInput[]> = {
  name_asc: [{ name: "asc" }, { id: "asc" }],
  name_desc: [{ name: "desc" }, { id: "desc" }],
  created_asc: [{ createdAt: "asc" }, { id: "asc" }],
  created_desc: [{ createdAt: "desc" }, { id: "desc" }],
};

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listInstitutions(opts: ListInstitutionsOptions): Promise<InstitutionListResponse> {
  const where: Prisma.InstitutionWhereInput = {};

  if (opts.q != null && opts.q.length > 0) {
    where.OR = ["name", "code", "city", "state", "officialCode"].map((field) => ({
      [field]: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode },
    }));
  }
  if (opts.status != null) where.status = opts.status;
  if (opts.officerId != null) {
    where.jurisdictions = { some: { officerId: opts.officerId, ...(opts.role != null ? { role: opts.role } : {}) } };
  } else if (opts.assignment != null && opts.role != null) {
    where.jurisdictions = opts.assignment === "assigned"
      ? { some: { role: opts.role } }
      : { none: { role: opts.role } };
  }

  const [rows, total] = await Promise.all([
    prisma.institution.findMany({
      where,
      orderBy: SORT_ORDER[opts.sort] ?? SORT_ORDER.name_asc,
      skip: (opts.page - 1) * opts.pageSize,
      take: Math.min(opts.pageSize, 50),
      include: { jurisdictions: { include: { officer: { select: { id: true, fullName: true, email: true, role: true } } } } },
    }),
    prisma.institution.count({ where }),
  ]);

  return {
    items: rows.map(serializeInstitutionListItem),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

function serializeInstitutionListItem(row: Prisma.InstitutionGetPayload<{
  include: { jurisdictions: { include: { officer: { select: { id: true; fullName: true; email: true; role: true } } } } };
}>): InstitutionListItem {
  const reviewOfficers = [] as InstitutionListItem["reviewOfficers"];
  const authorityOfficers = [] as InstitutionListItem["authorityOfficers"];
  for (const jurisdiction of row.jurisdictions) {
    const ref = {
      id: jurisdiction.officer.id,
      fullName: jurisdiction.officer.fullName,
      email: jurisdiction.officer.email,
      role: jurisdiction.officer.role,
    };
    if (jurisdiction.role === "REVIEW_OFFICER") reviewOfficers.push(ref);
    else if (jurisdiction.role === "APPROVING_AUTHORITY") authorityOfficers.push(ref);
  }
  return {
    id: row.id,
    code: row.code,
    officialCode: row.officialCode,
    name: row.name,
    city: row.city,
    state: row.state,
    status: row.status,
    isDemo: row.isDemo,
    reviewOfficers,
    authorityOfficers,
    canAcceptSubmissions: row.status === "ACTIVE",
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

function normalizeInstitutionInput(input: InstitutionInput): { data: Prisma.InstitutionCreateInput; fieldErrors?: Record<string, string[]> } {
  const data: Prisma.InstitutionCreateInput = {
    name: input.name,
    code: input.code,
    officialCode: input.officialCode && input.officialCode.length > 0 ? input.officialCode : null,
    city: input.city && input.city.length > 0 ? input.city : null,
    state: input.state && input.state.length > 0 ? input.state : null,
    addressLine: input.addressLine && input.addressLine.length > 0 ? input.addressLine : null,
    postalCode: input.postalCode && input.postalCode.length > 0 ? input.postalCode : null,
    contactName: input.contactName && input.contactName.length > 0 ? input.contactName : null,
    contactDesignation: input.contactDesignation && input.contactDesignation.length > 0 ? input.contactDesignation : null,
    contactEmail: input.contactEmail && input.contactEmail.length > 0 ? input.contactEmail : null,
    contactPhone: input.contactPhone && input.contactPhone.length > 0 ? input.contactPhone : null,
    isDemo: false,
  };
  return { data };
}

export async function createInstitution(user: AuthenticatedUser, input: InstitutionInput): Promise<{ id: number }> {
  assertAdmin(user);

  const existing = await prisma.institution.findFirst({
    where: { OR: [{ code: input.code }, ...(input.officialCode && input.officialCode.length > 0 ? [{ officialCode: input.officialCode }] : [])] },
    select: { id: true, code: true, officialCode: true },
  });
  if (existing != null) {
    const fieldErrors: Record<string, string[]> = {};
    if (existing.code === input.code) fieldErrors.code = ["An institution with this internal code already exists."];
    if (input.officialCode != null && input.officialCode.length > 0 && existing.officialCode === input.officialCode) {
      fieldErrors.officialCode = ["An institution with this official code already exists."];
    }
    throw validationError(fieldErrors, "An institution with this code already exists.");
  }

  const { data } = normalizeInstitutionInput(input);
  const created = await prisma.institution.create({ data, select: { id: true, code: true, name: true } });

  await recordAudit({
    action: "ADMIN_INSTITUTION_CREATED",
    actorUserId: user.id,
    institutionId: created.id,
    entityType: "institution",
    entityId: String(created.id),
    detail: { code: created.code, name: created.name },
  });

  return { id: created.id };
}

export async function updateInstitution(user: AuthenticatedUser, institutionId: number, input: InstitutionInput): Promise<{ id: number }> {
  assertAdmin(user);
  const institution = await prisma.institution.findUnique({ where: { id: institutionId }, select: { id: true } });
  if (institution == null) throw notFound("The institution does not exist.");

  const clash = await prisma.institution.findFirst({
    where: {
      id: { not: institutionId },
      OR: [{ code: input.code }, ...(input.officialCode && input.officialCode.length > 0 ? [{ officialCode: input.officialCode }] : [])],
    },
    select: { id: true, code: true, officialCode: true },
  });
  if (clash != null) {
    throw conflict("Another institution already uses this code.");
  }

  const { data } = normalizeInstitutionInput(input);
  await prisma.institution.update({ where: { id: institutionId }, data });

  await recordAudit({
    action: "ADMIN_INSTITUTION_UPDATED",
    actorUserId: user.id,
    institutionId,
    entityType: "institution",
    entityId: String(institutionId),
    detail: { code: input.code, name: input.name },
  });

  return { id: institutionId };
}

export async function setInstitutionStatus(
  user: AuthenticatedUser,
  institutionId: number,
  status: "ACTIVE" | "INACTIVE",
  note: string,
): Promise<{ id: number; status: "ACTIVE" | "INACTIVE" }> {
  assertAdmin(user);

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, name: true, status: true },
  });
  if (institution == null) throw notFound("The institution does not exist.");
  if (institution.status === status) {
    throw conflict(`The institution is already ${status === "ACTIVE" ? "active" : "deactivated"}.`);
  }
  if (status === "INACTIVE" && note.trim().length < 5) {
    throw validationError(
      { note: ["A short deactivation reason is required (recorded in the audit trail)."] },
      "The deactivation needs attention.",
    );
  }

  const changedAt = new Date();
  let revokedSessions = 0;
  if (status === "INACTIVE") {
    // Revoke every session of the college's users immediately.
    revokedSessions = await prisma.session.count({
      where: { invalidatedAt: null, user: { institutionId } },
    });
    await prisma.session.updateMany({
      where: { invalidatedAt: null, user: { institutionId } },
      data: { invalidatedAt: changedAt },
    });
  }

  await prisma.institution.update({
    where: { id: institutionId },
    data: { status },
  });

  await recordAudit({
    action: "ADMIN_INSTITUTION_STATUS_CHANGED",
    actorUserId: user.id,
    institutionId,
    entityType: "institution",
    entityId: String(institutionId),
    detail: {
      status,
      note: note.trim(),
      ...(status === "INACTIVE" ? { count: revokedSessions } : {}),
    },
  });

  await createNotification({
    institutionId,
    title: status === "ACTIVE" ? "Institution activated" : "Institution deactivated",
    body:
      status === "ACTIVE"
        ? "New submissions are accepted again."
        : "New submissions are not accepted while deactivated; existing cases remain readable (sample policy).",
    linkPath: null,
  });

  return { id: institutionId, status };
}

// ---------------------------------------------------------------------------
// Officer assignment
// ---------------------------------------------------------------------------

export async function assignOfficer(
  user: AuthenticatedUser,
  args: { institutionId: number; officerId: number; role: JurisdictionRole; action: "assign" | "unassign"; note?: string },
): Promise<{ ok: true }> {
  assertAdmin(user);

  const institution = await prisma.institution.findUnique({
    where: { id: args.institutionId },
    select: { id: true, code: true, name: true },
  });
  if (institution == null) throw notFound("The institution does not exist.");

  const officer = await prisma.user.findUnique({
    where: { id: args.officerId },
    select: { id: true, fullName: true, role: true, isActive: true },
  });
  if (officer == null) throw notFound("The officer account does not exist.");
  if (officer.role !== (args.role === "REVIEW_OFFICER" ? "REVIEW_OFFICER" : "APPROVING_AUTHORITY")) {
    throw conflict("The account role must match the assignment role.");
  }
  if (!officer.isActive) {
    throw conflict("The officer account is deactivated.");
  }

  if (args.action === "assign") {
    const created = await prisma.officerJurisdiction.upsert({
      where: {
        officerId_institutionId_role: {
          officerId: officer.id,
          institutionId: args.institutionId,
          role: args.role,
        },
      },
      update: {},
      create: { officerId: officer.id, institutionId: args.institutionId, role: args.role },
    });

    await recordAudit({
      action: "ADMIN_ASSIGNMENT_CHANGED",
      actorUserId: user.id,
      institutionId: args.institutionId,
      entityType: "officer_jurisdiction",
      entityId: String(created.id),
      detail: { role: args.role, note: `Assigned ${officer.fullName} as ${args.role === "REVIEW_OFFICER" ? "reviewing officer" : "approving authority"}` },
    });

    await createNotification({
      userId: officer.id,
      title: `New ${args.role === "REVIEW_OFFICER" ? "reviewing officer" : "approving authority"} assignment`,
      body: `You can now work on cases of ${institution.name}.`,
      linkPath: "/cases",
    });
  } else {
    const deleted = await prisma.officerJurisdiction.deleteMany({
      where: { officerId: officer.id, institutionId: args.institutionId, role: args.role },
    });
    if (deleted.count === 0) {
      throw conflict("This assignment does not exist.");
    }

    await recordAudit({
      action: "ADMIN_ASSIGNMENT_CHANGED",
      actorUserId: user.id,
      institutionId: args.institutionId,
      entityType: "officer_jurisdiction",
      entityId: String(officer.id),
      detail: { role: args.role, note: `Unassigned ${officer.fullName}` },
    });

    await createNotification({
      userId: officer.id,
      title: "Assignment removed",
      body: `Your ${args.role === "REVIEW_OFFICER" ? "reviewing" : "approval"} assignment for ${institution.name} was removed.`,
      linkPath: "/cases",
    });
  }

  void args.note;
  return { ok: true };
}

/** Directory rows for the assignment select (admin UI). */
export async function listEligibleOfficers(user: AuthenticatedUser, role: JurisdictionRole): Promise<Array<{ id: number; fullName: string; email: string }>> {
  assertAdmin(user);
  const rows = await prisma.user.findMany({
    where: { role: role === "REVIEW_OFFICER" ? "REVIEW_OFFICER" : "APPROVING_AUTHORITY", isActive: true },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, email: true },
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Detail (admin workspace per college)
// ---------------------------------------------------------------------------

export async function getInstitutionDetail(user: AuthenticatedUser, institutionId: number): Promise<InstitutionDetail> {
  assertAdmin(user);

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    include: {
      jurisdictions: { include: { officer: { select: { id: true, fullName: true, email: true } } } },
    },
  });
  if (institution == null) throw notFound("The institution does not exist.");

  const today = businessToday();
  const windowDays = config.sampleApproachingMaturityDays;

  const fdrRows = await prisma.fdr.findMany({
    where: { institutionId },
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
    include: { institution: { select: { id: true, code: true, name: true } } },
  });
  const institutionUserRows = await prisma.user.findMany({
    where: { institutionId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      designation: true,
      isActive: true,
      mustChangePassword: true,
      createdAt: true,
      institutionId: true,
    },
  });

  const fdrIds = fdrRows.map((row) => row.id);
  const [openCorrections, openReleases, pendingReplacements, reviewTasks] = await Promise.all([
    prisma.correctionRequest.count({ where: { fdrId: { in: fdrIds }, status: "OPEN" } }),
    prisma.releaseRequest.count({ where: { fdrId: { in: fdrIds }, status: "OPEN" } }),
    prisma.fdr.count({ where: { institutionId, previousFdrId: { not: null }, status: { in: ["submitted", "under_review", "discrepancy", "verified"] } } }),
    prisma.task.count({ where: { assigneeInstitutionId: institutionId, status: "OPEN" } }),
  ]);

  const live = fdrRows.filter((row) => row.supersededByFdrId == null);
  const portfolio: PortfolioSummary = {
    instrumentsTotal: fdrRows.length,
    drafts: fdrRows.filter((row) => row.status === "draft").length,
    awaitingReview: live.filter((row) => ["submitted", "under_review", "discrepancy"].includes(row.status)).length,
    verified: live.filter((row) => row.status === "verified").length,
    superseded: fdrRows.filter((row) => row.supersededByFdrId != null).length,
    activeAmount: {
      currency: "INR",
      amountMinor: live.reduce((sum, row) => sum + row.amountMinor, 0n).toString(),
    },
  };

  const upcoming = composeListItems(
    live.filter((row) => deriveDateCondition(today, iso(row.maturityDate), windowDays) !== "current"),
    today,
    windowDays,
  ).slice(0, 6);
  const recentSubmissions = composeListItems(
    [...fdrRows].filter((row) => row.submittedAt != null).sort((a, b) => (b.submittedAt!.getTime() ?? 0) - (a.submittedAt!.getTime() ?? 0)),
    today,
    windowDays,
  ).slice(0, 6);

  const contactParts = [institution.contactName, institution.contactEmail, institution.contactPhone]
    .filter((part): part is string => part != null && part.length > 0);

  return {
    id: institution.id,
    code: institution.code,
    officialCode: institution.officialCode,
    name: institution.name,
    city: institution.city,
    state: institution.state,
    addressLine: institution.addressLine,
    postalCode: institution.postalCode,
    contactName: institution.contactName,
    contactDesignation: institution.contactDesignation,
    contactEmail: institution.contactEmail,
    contactPhone: institution.contactPhone,
    status: institution.status,
    isDemo: institution.isDemo,
    createdAt: institution.createdAt.toISOString(),
    officers: institution.jurisdictions.map((row) => ({
      officerId: row.officerId,
      officerName: row.officer.fullName,
      officerEmail: row.officer.email,
      role: row.role,
      assignedAt: row.createdAt.toISOString(),
    })),
    accounts: institutionUserRows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      designation: row.designation,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt.toISOString(),
      institutionId: row.institutionId,
    })),
    portfolio,
    openWork: {
      openCorrections,
      openReleases,
      pendingReplacements,
      reviewTasks,
    },
    upcomingMaturity: upcoming,
    recentSubmissions,
    cases: fdrRows.map((row) => ({
      id: row.id,
      publicCode: row.publicCode,
      bankName: row.bankName,
      status: row.status,
      dateCondition: deriveDateCondition(today, iso(row.maturityDate), windowDays),
      maturityDate: iso(row.maturityDate),
      amount: { currency: row.currency, amountMinor: row.amountMinor.toString() },
    })),
    recentActivity: [],
    contact: contactParts.length > 0 ? contactParts.join(" - ") : null,
  };
}

function composeListItems(
  rows: Array<Prisma.FdrGetPayload<{ include: { institution: { select: { id: true; code: true; name: true } } } }>>,
  today: string,
  windowDays: number,
) {
  return rows.map((row) => serializeFdr(row, today, windowDays, null));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
