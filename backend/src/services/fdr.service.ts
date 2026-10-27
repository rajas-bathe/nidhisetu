import { Prisma } from "@prisma/client";
import type { FdrListItem, ListFdrsQuery } from "@sih26265/contracts";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { forbidden } from "../errors.js";
import { addDays, businessToday, parseLocalDate } from "../utils/dates.js";
import { serializeFdr, type LatestReleaseInfo } from "../dto/serialize.js";
import { institutionCondition, getAccessScope, type AccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

export interface ListFdrsOptions extends ListFdrsQuery {
  page: number;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 50;

const SORT_MAP: Record<string, Prisma.FdrOrderByWithRelationInput[]> = {
  maturity_asc: [{ maturityDate: "asc" }, { id: "asc" }],
  maturity_desc: [{ maturityDate: "desc" }, { id: "desc" }],
  created_desc: [{ createdAt: "desc" }, { id: "desc" }],
};

/**
 * Institution-scoped, filtered FDR listing.
 *
 * Access control is server-enforced:
 * - College accounts always read only their own institution; a foreign
 *   institution filter is rejected.
 * - Officers read only institutions inside their recorded jurisdiction.
 * - System administrators range plane-wide for supervision screens.
 * - An empty scope yields no rows. Guessing ids cannot leak other data.
 */
export async function listFdrs(
  user: AuthenticatedUser,
  opts: ListFdrsOptions,
): Promise<PaginatedResponse<FdrListItem>> {
  const scope = await getAccessScope(user);
  const scopeCondition = institutionCondition(scope);

  if (scopeCondition == null) {
    return listForInstitutions(scope, opts, null);
  }

  return listForInstitutions(scope, opts, scopeCondition.in);
}

async function listForInstitutions(
  scope: AccessScope,
  opts: ListFdrsOptions,
  allowedIds: number[] | null,
): Promise<PaginatedResponse<FdrListItem>> {
  if (allowedIds != null && allowedIds.length === 0) {
    return { items: [], total: 0, page: opts.page, pageSize: opts.pageSize };
  }

  let activeInstitutionIds = allowedIds;
  if (scope.user.role === "COLLEGE_USER" && opts.institutionId != null) {
    if (opts.institutionId !== scope.user.institutionId) {
      throw forbidden("This institution is outside your assigned scope.");
    }
  } else if (opts.institutionId != null) {
    if (allowedIds != null && !allowedIds.includes(opts.institutionId)) {
      throw forbidden("This institution is outside your assigned scope.");
    }
    activeInstitutionIds = [opts.institutionId];
  }

  const conditions: Prisma.FdrWhereInput[] = [];
  if (activeInstitutionIds != null) {
    conditions.push({ institutionId: { in: activeInstitutionIds } });
  }

  if (opts.status != null) {
    conditions.push({ status: opts.status });
  }

  if (opts.dateCondition != null) {
    const today = businessToday();
    const window = config.sampleApproachingMaturityDays;
    if (opts.dateCondition === "matured") {
      conditions.push({ maturityDate: { lt: parseLocalDate(today) } });
    } else if (opts.dateCondition === "approaching_maturity") {
      conditions.push({
        maturityDate: {
          gte: parseLocalDate(today),
          lte: parseLocalDate(addDays(today, window)),
        },
      });
    } else {
      conditions.push({ maturityDate: { gt: parseLocalDate(addDays(today, window)) } });
    }
  }

  if (opts.q != null && opts.q.length > 0) {
    conditions.push({
      OR: ["publicCode", "referenceNo", "bankName", "bankBranch"].map((field) => ({
        [field]: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode },
      })),
    });
  }

  if (opts.superseded === "exclude") {
    conditions.push({ supersededByFdrId: null });
  } else if (opts.superseded === "only") {
    conditions.push({ supersededByFdrId: { not: null } });
  }

  if (opts.replacement === "only") {
    conditions.push({ previousFdrId: { not: null } });
  } else if (opts.replacement === "none") {
    conditions.push({ previousFdrId: null });
  }

  const where: Prisma.FdrWhereInput = { AND: conditions };
  const orderBy = SORT_MAP[opts.sort] ?? SORT_MAP.maturity_asc!;
  const skip = (opts.page - 1) * opts.pageSize;
  const take = Math.min(opts.pageSize, MAX_PAGE_SIZE);

  const [rows, total] = await Promise.all([
    prisma.fdr.findMany({
      where,
      include: { institution: { select: { id: true, code: true, name: true } } },
      orderBy,
      skip,
      take,
    }),
    prisma.fdr.count({ where }),
  ]);

  const releaseRows =
    rows.length > 0
      ? await prisma.releaseRequest.findMany({
          where: { fdrId: { in: rows.map((row) => row.id) } },
          orderBy: { createdAt: "desc" },
          select: { fdrId: true, status: true, decision: true },
        })
      : [];

  const latestByFdr = new Map<number, LatestReleaseInfo>();
  for (const row of releaseRows) {
    if (!latestByFdr.has(row.fdrId)) {
      latestByFdr.set(row.fdrId, { status: row.status, decision: row.decision ?? null });
    }
  }

  const today = businessToday();
  const items = rows.map((row) =>
    serializeFdr(row, today, config.sampleApproachingMaturityDays, latestByFdr.get(row.id) ?? null),
  );

  return { items, total, page: opts.page, pageSize: opts.pageSize };
}
