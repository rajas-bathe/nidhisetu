import { Prisma } from "@prisma/client";
import type { TaskListItem, TaskStatus, TaskType } from "@sih26265/contracts";
import { prisma } from "../db/client.js";
import { businessToday } from "../utils/dates.js";
import { serializeTask } from "../dto/serialize.js";
import { getAccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";
import type { PaginatedResponse } from "./fdr.service.js";

export interface ListTasksOptions {
  page: number;
  pageSize: number;
  status: TaskStatus;
  onlyOverdue?: boolean;
  fdrId?: number;
  /** Single-type drill-down (contract) — combined with legacy `types` when both given. */
  type?: TaskType;
  types?: TaskType[];
  /** Free text on the task title and case public code. */
  q?: string;
}

const MAX_PAGE_SIZE = 50;

/**
 * Task inbox for the acting user.
 * - College accounts see tasks assigned to their institution.
 * - Officers see tasks assigned to their account plus institution-wide queues
 *   for the institutions inside their jurisdiction (isOpenToJurisdiction rows
 *   with assigneeUserId null are shared queues, not personal work).
 * - Everything is filtered in SQL by server-derived scope; ids guessed by the
 *   client cannot widen the result.
 */
export async function listTasks(
  user: AuthenticatedUser,
  opts: ListTasksOptions,
): Promise<PaginatedResponse<TaskListItem>> {
  const scope = await getAccessScope(user);

  let assigneeFilter: Prisma.TaskWhereInput;
  if (user.role === "COLLEGE_USER") {
    assigneeFilter = { assigneeInstitutionId: user.institutionId ?? -1 };
  } else if (scope.institutionIds.length > 0) {
    assigneeFilter = {
      OR: [
        { assigneeUserId: user.id },
        { assigneeUserId: null, assigneeInstitutionId: { in: scope.institutionIds } },
      ],
    };
  } else {
    // Officers/admins with no scoped institutions see only their own tasks;
    // system admins never receive tasks, so their inbox is empty.
    assigneeFilter = user.role === "SYSTEM_ADMIN" ? { id: -1 } : { assigneeUserId: user.id };
  }

  const conditions: Prisma.TaskWhereInput[] = [assigneeFilter, { status: opts.status }];

  if (opts.onlyOverdue === true) {
    conditions.push({ dueDate: { lt: new Date(`${businessToday()}T00:00:00.000Z`) } });
  }
  if (opts.fdrId != null) {
    conditions.push({ fdrId: opts.fdrId });
  }
  const typeFilter: TaskType[] = [
    ...(opts.types ?? []),
    ...(opts.type != null ? [opts.type] : []),
  ];
  if (typeFilter.length > 0) {
    conditions.push({ type: { in: Array.from(new Set(typeFilter)) } });
  }
  if (opts.q != null && opts.q.length > 0) {
    conditions.push({
      OR: [
        { title: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode } },
        { detail: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode } },
        { fdr: { publicCode: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode } } },
      ],
    });
  }

  const where: Prisma.TaskWhereInput = { AND: conditions };
  const skip = (opts.page - 1) * opts.pageSize;
  const take = Math.min(opts.pageSize, MAX_PAGE_SIZE);

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { fdr: { select: { id: true, publicCode: true } } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.task.count({ where }),
  ]);

  const today = businessToday();
  return {
    items: rows.map((row) => serializeTask(row, today)),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

/**
 * Closes (or re-opens) a task by its deduplication key, in an existing
 * transaction. Idempotent: re-closing an already-closed key is a no-op.
 * Returns the number of rows affected (0 when the key does not exist for the
 * given task type — used by callers that treat absence as acceptable).
 */
export async function closeTaskByKeyInTx(
  tx: Prisma.TransactionClient,
  deduplicationKey: string,
  note: string | null,
): Promise<number> {
  const result = await tx.task.updateMany({
    where: { deduplicationKey, status: { in: ["OPEN", "IN_PROGRESS"] } },
    data: { status: "DONE", closedAt: new Date(), closedNote: note },
  });
  return result.count;
}

/** Same as closeTaskByKeyInTx but for a standalone (non-transactional) flow. */
export async function closeTaskByKey(
  deduplicationKey: string,
  note: string | null,
): Promise<number> {
  return closeTaskByKeyInTx(prisma, deduplicationKey, note);
}
