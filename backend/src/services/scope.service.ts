import { forbidden } from "../errors.js";
import type { AuthenticatedUser } from "../middleware/authenticate";
import { prisma } from "../db/client.js";

export interface AccessScope {
  /** The acting user. */
  user: AuthenticatedUser;
  /** Institution ids the user may read/write right now. */
  institutionIds: number[];
}

/**
 * Resolves the server-side data scope for a user.
 *
 * - College accounts are limited to their own institution (never a request body).
 * - Officers are limited to their recorded jurisdiction.
 * - An account with no scope yields an empty list; every query interprets an
 *   empty scope as "no rows", never "all rows".
 */
export async function getAccessScope(user: AuthenticatedUser): Promise<AccessScope> {
  if (user.role === "COLLEGE_USER") {
    return { user, institutionIds: user.institutionId == null ? [] : [user.institutionId] };
  }

  const jurisdictions = await prisma.officerJurisdiction.findMany({
    where: { officerId: user.id, institution: { status: "ACTIVE" } },
    select: { institutionId: true },
  });

  return { user, institutionIds: jurisdictions.map((row) => row.institutionId) };
}

/** Rejects requests that try to operate on an institution outside the scope. */
export function assertInstitutionInScope(scope: AccessScope, institutionId: number | undefined): void {
  if (institutionId == null) {
    return;
  }
  if (!scope.institutionIds.includes(institutionId)) {
    throw forbidden("This institution is outside your assigned scope.");
  }
}
