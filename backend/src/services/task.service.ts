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
  types?: TaskType[];
}

const MAX_PAGE_SIZE = 50;

/**
 * Task inbox for the acting user.
 * - College accounts see tasks assigned to their institution.
 * - Officers see tasks assigned to their own account.
 * Unassigned officer tasks (work queues) stay invisible until someone is
 * assigned - visible work is always attributable to a responsible party.
 */
export async function listTasks(
  user: AuthenticatedUser,
  opts: ListTasksOptions,
): Promise<PaginatedResponse<TaskListItem>> {
  const scope = await getAccessScope(user);

  const assigneeFilter: Prisma.TaskWhereInput =
    user.role === "COLLEGE_USER"
      ? { assigneeInstitutionId: user.institutionId ?? -1 }
      : { assigneeUserId: user.id };

  const conditions: Prisma.TaskWhereInput[] = [assigneeFilter, { status: opts.status }];

  if (opts.onlyOverdue === true) {
    conditions.push({ dueDate: { lt: new Date(`${businessToday()}T00:00:00.000Z`) } });
  }
  if (opts.fdrId != null) {
    conditions.push({ fdrId: opts.fdrId });
  }
  if (opts.types != null && opts.types.length > 0) {
    conditions.push({ type: { in: opts.types } });
  }

  if (user.role !== "COLLEGE_USER" && scope.institutionIds.length === 0 && user.institutionId == null) {
    // Officers with no jurisdiction still see tasks explicitly assigned to them.
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
