import type { JurisdictionRole } from "@sih26265/contracts";
import { forbidden } from "../errors.js";
import type { AuthenticatedUser } from "../middleware/authenticate";
import { prisma } from "../db/client.js";

export interface AccessScope {
  /** The acting user. */
  user: AuthenticatedUser;
  /** Institution ids the user may access right now; empty when isGlobal. */
  institutionIds: number[];
  /** System administrators read plane-wide but never gain officer capabilities. */
  isGlobal: boolean;
}

/**
 * Resolves the server-side data scope for a user.
 *
 * - College accounts are limited to their own institution (never a request body).
 * - Officers are limited to their recorded jurisdiction (both rows matter:
 *   reviewing rows grant review capabilities, authority rows grant approvals).
 * - An account with no scope yields an empty list; every query interprets an
 *   empty scope as "no rows", never "all rows".
 * - System administrators range across all institutions for read/admin tasks,
 *   but every review/approval capability check below explicitly rejects them.
 */
export async function getAccessScope(user: AuthenticatedUser): Promise<AccessScope> {
  if (user.role === "SYSTEM_ADMIN") {
    return { user, institutionIds: [], isGlobal: true };
  }

  if (user.role === "COLLEGE_USER") {
    return {
      user,
      institutionIds: user.institutionId == null ? [] : [user.institutionId],
      isGlobal: false,
    };
  }

  const jurisdictions = await prisma.officerJurisdiction.findMany({
    where: { officerId: user.id },
    select: { institutionId: true, role: true },
  });

  const ids = Array.from(new Set(jurisdictions.map((row) => row.institutionId)));
  return { user, institutionIds: ids, isGlobal: false };
}

/**
 * Prisma condition for the acting viewer's institution set. `undefined` means
 * "no additional restriction" and is only produced for the global scope.
 */
export function institutionCondition(scope: AccessScope): { in: number[] } | undefined {
  if (scope.isGlobal) return undefined;
  return { in: scope.institutionIds };
}

/** Throws when the requested institution is not inside the acting scope. */
export function assertInstitutionInScope(scope: AccessScope, institutionId: number | null | undefined): void {
  if (scope.isGlobal) return;
  if (institutionId == null || !scope.institutionIds.includes(institutionId)) {
    throw forbidden("This institution is outside your assigned scope.");
  }
}

/**
 *Officers only work cases for institutions where they hold the requested
 * capability row. Admins deliberately never gain these capabilities.
 */
export async function assertOfficerCapability(
  user: AuthenticatedUser,
  institutionId: number,
  role: JurisdictionRole,
): Promise<void> {
  if (user.role !== "REVIEW_OFFICER" && user.role !== "APPROVING_AUTHORITY") {
    throw forbidden("Only assigned officers can perform this action.");
  }
  const row = await prisma.officerJurisdiction.findFirst({
    where: { officerId: user.id, institutionId, role },
    select: { id: true },
  });
  if (row == null) {
    throw forbidden(
      role === "REVIEW_OFFICER"
        ? "You are not the assigned reviewing officer for this institution."
        : "You are not an assigned approving authority for this institution.",
    );
  }
}

/** Convenience: does this user hold the given capability? (No throw.) */
export async function hasOfficerCapability(
  officerId: number,
  institutionId: number,
  role: JurisdictionRole,
): Promise<boolean> {
  const row = await prisma.officerJurisdiction.findFirst({
    where: { officerId, institutionId, role },
    select: { id: true },
  });
  return row != null;
}

/** Users (any officer role) granted the capability for a case's institution. */
export async function officerIdsWithCapability(
  institutionId: number,
  role: JurisdictionRole,
): Promise<number[]> {
  const rows = await prisma.officerJurisdiction.findMany({
    where: { institutionId, role },
    select: { officerId: true },
  });
  return rows.map((row) => row.officerId);
}

/**
 * Institutions (optionally scoped) that must not receive created rows from a
 * deactivated record. SAMPLE deactivation policy blocks ask new submissions;
 * officers may still finish existing cases.
 */
export const SUBMISSION_BLOCK_COMMENT =
  "SAMPLE policy: deactivated colleges cannot start new submissions; existing cases stay readable and officers may finish them.";

/** Checks that the institution accepts new college submissions. */
export async function assertInstitutionAcceptsSubmissions(institutionId: number): Promise<void> {
  const row = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { status: true, name: true },
  });
  if (row == null) {
    throw forbidden("This institution does not exist.");
  }
  if (row.status !== "ACTIVE") {
    throw forbidden(
      "This college is currently deactivated, so new submissions are not accepted. Existing cases remain readable (sample policy).",
    );
  }
}
