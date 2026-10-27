import type { DashboardResponse } from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { businessToday } from "../utils/dates.js";
import { serializeFdr, serializeTask } from "../dto/serialize.js";
import { deriveDateCondition } from "../rules/dateCondition.js";
import { getAccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

const PENDING_REVIEW_STATUSES = ["submitted", "under_review", "discrepancy"] as const;

/**
 * Role-aware dashboard payload. All numbers come from live database queries
 * over the acting user's scope; there are no hardcoded totals.
 */
export async function buildDashboard(user: AuthenticatedUser): Promise<DashboardResponse> {
  const scope = await getAccessScope(user);
  const today = businessToday();
  const windowDays = config.sampleApproachingMaturityDays;

  const fdrWhere: Prisma.FdrWhereInput = {
    institutionId: { in: scope.institutionIds },
    supersededByFdrId: null,
  };

  const taskWhere: Prisma.TaskWhereInput =
    user.role === "COLLEGE_USER"
      ? { assigneeInstitutionId: user.institutionId ?? -1, status: "OPEN" }
      : { assigneeUserId: user.id, status: "OPEN" };

  const [fdrRows, taskRows] = await Promise.all([
    prisma.fdr.findMany({
      where: fdrWhere,
      include: { institution: { select: { id: true, code: true, name: true } } },
      orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
    }),
    prisma.task.findMany({
      where: taskWhere,
      include: { fdr: { select: { id: true, publicCode: true } } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }),
  ]);

  const pendingVerification = fdrRows.filter((row) =>
    (PENDING_REVIEW_STATUSES as readonly string[]).includes(row.status),
  ).length;

  const overdueTasks = taskRows.filter((row) => {
    const due = row.dueDate.toISOString().slice(0, 10);
    return due < today;
  }).length;

  const approaching = fdrRows.filter(
    (row) => deriveDateCondition(today, toLocal(row.maturityDate), windowDays) === "approaching_maturity",
  ).length;

  const upcoming = fdrRows
    .filter((row) => deriveDateCondition(today, toLocal(row.maturityDate), windowDays) !== "current")
    .slice(0, 6);

  const recent = [...fdrRows]
    .filter((row) => row.submittedAt != null)
    .sort((a, b) => (b.submittedAt!.getTime() ?? 0) - (a.submittedAt!.getTime() ?? 0))
    .slice(0, 6);

  const withLatestRelease =
    fdrRows.length > 0
      ? await prisma.releaseRequest.findMany({
          where: { fdrId: { in: fdrRows.map((row) => row.id) } },
          orderBy: { createdAt: "desc" },
          select: { fdrId: true, status: true, decision: true },
        })
      : [];

  const latestByFdr = new Map<number, { status: "OPEN" | "DECIDED"; decision: "none" | "requested" | "recommended" | "approved" | "rejected" | "completed" | null }>();
  for (const row of withLatestRelease) {
    if (!latestByFdr.has(row.fdrId)) {
      latestByFdr.set(row.fdrId, { status: row.status, decision: row.decision ?? null });
    }
  }

  return {
    role: user.role,
    institution:
      user.institution == null
        ? null
        : { id: user.institution.id, code: user.institution.code, name: user.institution.name },
    counters: {
      pendingVerification,
      awaitingMyAction: taskRows.length,
      overdueTasks,
      approachingMaturity: approaching,
      currentInstruments: fdrRows.length,
    },
    upcomingMaturity: upcoming.map((row) =>
      serializeFdr(row, today, windowDays, latestByFdr.get(row.id) ?? null),
    ),
    recentSubmissions: recent.map((row) =>
      serializeFdr(row, today, windowDays, latestByFdr.get(row.id) ?? null),
    ),
    actionRequiredTasks: taskRows.slice(0, 6).map((row) => serializeTask(row, today)),
    approachingWindowDays: windowDays,
    generatedAt: new Date().toISOString(),
  };
}

function toLocal(date: Date): string {
  return date.toISOString().slice(0, 10);
}
