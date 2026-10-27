/**
 * Role-aware dashboard payload (v2). All numbers come from live database
 * queries over the acting user's server-enforced scope; there are no hardcoded
 * totals. Counter shape depends on the acting role:
 * - College: portfolio + pending work for the institution.
 * - Reviewing officer: verification pipeline inside their jurisdictions.
 * - Approving authority: decisions and completions inside their jurisdictions.
 * - System administrator: plane-wide setup health (no review work).
 */
import type { DashboardResponse, FdrListItem, TaskListItem } from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { businessToday } from "../utils/dates.js";
import { serializeFdr, serializeTask, type LatestReleaseInfo } from "../dto/serialize.js";
import { deriveDateCondition } from "../rules/dateCondition.js";
import { recentActivity } from "./audit.service.js";
import { getAccessScope, type AccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

const PENDING_REVIEW_STATUSES = ["submitted", "under_review", "discrepancy"] as const;

const FDR_INCLUDE = { institution: { select: { id: true, code: true, name: true } } } as const;
const TASK_INCLUDE = { fdr: { select: { id: true, publicCode: true } } } as const;

async function latestReleaseMap(fdrIds: number[]): Promise<Map<number, LatestReleaseInfo>> {
  if (fdrIds.length === 0) return new Map();
  const rows = await prisma.releaseRequest.findMany({
    where: { fdrId: { in: fdrIds } },
    orderBy: { createdAt: "desc" },
    select: { fdrId: true, status: true, decision: true },
  });
  const map = new Map<number, LatestReleaseInfo>();
  for (const row of rows) {
    if (!map.has(row.fdrId)) {
      map.set(row.fdrId, { status: row.status, decision: row.decision ?? null });
    }
  }
  return map;
}

async function toListItems(
  rows: Prisma.FdrGetPayload<{ include: typeof FDR_INCLUDE }>[],
  today: string,
  windowDays: number,
  releases: Map<number, LatestReleaseInfo>,
): Promise<FdrListItem[]> {
  return rows.map((row) => serializeFdr(row, today, windowDays, releases.get(row.id) ?? null));
}

function isOverdueTask(row: Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>, today: string): boolean {
  return row.dueDate.toISOString().slice(0, 10) < today;
}

export async function buildDashboard(user: AuthenticatedUser): Promise<DashboardResponse> {
  const scope = await getAccessScope(user);
  const today = businessToday();
  const windowDays = config.sampleApproachingMaturityDays;
  const generatedAt = new Date().toISOString();

  switch (user.role) {
    case "COLLEGE_USER":
      return collegeDashboard(user, scope, today, windowDays, generatedAt);
    case "REVIEW_OFFICER":
      return officerDashboard(user, scope, today, windowDays, generatedAt);
    case "APPROVING_AUTHORITY":
      return authorityDashboard(user, scope, today, windowDays, generatedAt);
    case "SYSTEM_ADMIN":
      return adminDashboard(user, today, windowDays, generatedAt);
    default: {
      const exhaustive: never = user.role;
      throw new Error(`Unhandled role: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// College dashboard
// ---------------------------------------------------------------------------

async function collegeDashboard(
  user: AuthenticatedUser,
  scope: AccessScope,
  today: string,
  windowDays: number,
  generatedAt: string,
): Promise<DashboardResponse> {
  const institutionId = user.institutionId ?? -1;

  const fdrRows = await prisma.fdr.findMany({
    where: { institutionId, supersededByFdrId: null },
    include: FDR_INCLUDE,
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
  });

  const taskRows = await prisma.task.findMany({
    where: { assigneeInstitutionId: institutionId, status: "OPEN" },
    include: TASK_INCLUDE,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });

  const fdrIds = fdrRows.map((row) => row.id);
  const [openCorrections, releaseRows, releases] = await Promise.all([
    prisma.correctionRequest.count({ where: { status: "OPEN", fdrId: { in: fdrIds } } }),
    prisma.releaseRequest.findMany({
      where: { fdrId: { in: fdrIds }, status: "OPEN" },
      select: { fdrId: true, decision: true },
    }),
    latestReleaseMap(fdrIds),
  ]);

  const activeAmount = fdrRows.reduce((sum, row) => sum + row.amountMinor, 0n);
  const awaitingReview = fdrRows.filter(
    (row) => (PENDING_REVIEW_STATUSES as readonly string[]).includes(row.status),
  ).length;
  const approaching = fdrRows.filter(
    (row) => deriveDateCondition(today, toLocal(row.maturityDate), windowDays) !== "current",
  ).length;
  const releasesAwaiting = releaseRows.filter((row) => row.decision == null || row.decision === "requested").length;

  const upcoming = fdrRows
    .filter((row) => deriveDateCondition(today, toLocal(row.maturityDate), windowDays) !== "current")
    .slice(0, 6);

  const recent = [...fdrRows]
    .filter((row) => row.submittedAt != null)
    .sort((a, b) => (b.submittedAt!.getTime() ?? 0) - (a.submittedAt!.getTime() ?? 0))
    .slice(0, 6);

  const upcomingItems = await toListItems(upcoming, today, windowDays, releases);
  const recentItems = await toListItems(recent, today, windowDays, releases);
  const taskItems: TaskListItem[] = taskRows.slice(0, 6).map((row) => serializeTask(row, today));
  const activity = await recentActivity(
    { role: user.role, institutionIds: scope.institutionIds, isGlobal: false },
    8,
  );

  return {
    role: user.role,
    institution:
      user.institution == null
        ? null
        : { id: user.institution.id, code: user.institution.code, name: user.institution.name },
    counters: {
      activeInstruments: fdrRows.length,
      activeAmount: { currency: "INR", amountMinor: activeAmount.toString() },
      drafts: fdrRows.filter((row) => row.status === "draft").length,
      awaitingReview,
      correctionsRequired: openCorrections,
      approachingMaturity: approaching,
      openReplacementObligations: approaching,
      pendingReleaseRequests: releasesAwaiting,
    },
    upcomingMaturity: upcomingItems,
    recentSubmissions: recentItems,
    actionRequiredTasks: taskItems,
    recentActivity: activity,
    approachingWindowDays: windowDays,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// Reviewing officer dashboard
// ---------------------------------------------------------------------------

async function officerDashboard(
  user: AuthenticatedUser,
  scope: AccessScope,
  today: string,
  windowDays: number,
  generatedAt: string,
): Promise<DashboardResponse> {
  if (scope.institutionIds.length === 0) {
    return {
      role: user.role,
      institution: null,
      counters: {
        submittedAwaitingReview: 0,
        underReview: 0,
        correctionsAwaitingCollege: 0,
        correctedReadyForReReview: 0,
        replacementsAwaitingReview: 0,
        releasesAwaitingRecommendation: 0,
        assignedTasks: 0,
        overdueTasks: 0,
      },
      upcomingMaturity: [],
      recentSubmissions: [],
      actionRequiredTasks: [],
      recentActivity: [],
      approachingWindowDays: windowDays,
      generatedAt,
    };
  }

  const scopeWhere: Prisma.FdrWhereInput = { institutionId: { in: scope.institutionIds } };

  const fdrRows = await prisma.fdr.findMany({
    where: scopeWhere,
    include: FDR_INCLUDE,
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
  });
  const taskRows = await prisma.task.findMany({
    where: { assigneeUserId: user.id, status: "OPEN" },
    include: TASK_INCLUDE,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });

  const fdrIds = fdrRows.map((row) => row.id);
  const [openCorrections, respondedCorrections, releases] = await Promise.all([
    prisma.correctionRequest.count({ where: { status: "OPEN", fdrId: { in: fdrIds } } }),
    prisma.correctionRequest.count({
      where: { status: "RESPONDED", fdrId: { in: fdrIds }, respondedVersionNo: { not: null } },
    }),
    latestReleaseMap(fdrIds),
  ]);

  const pending = fdrRows.filter((row) => (PENDING_REVIEW_STATUSES as readonly string[]).includes(row.status));
  const replacementsPending = pending.filter((row) => row.previousFdrId != null);
  const releasesAwaitingRecommendation = (
    await prisma.releaseRequest.findMany({
      where: { status: "OPEN", fdrId: { in: fdrIds }, recommendedById: null },
      select: { id: true },
    })
  ).length;

  const upcoming = fdrRows
    .filter((row) => row.supersededByFdrId == null && deriveDateCondition(today, toLocal(row.maturityDate), windowDays) !== "current")
    .slice(0, 6);

  const recent = [...fdrRows]
    .filter((row) => row.submittedAt != null)
    .sort((a, b) => (b.submittedAt!.getTime() ?? 0) - (a.submittedAt!.getTime() ?? 0))
    .slice(0, 6);

  const upcomingItems = await toListItems(upcoming, today, windowDays, releases);
  const recentItems = await toListItems(recent, today, windowDays, releases);
  const taskItems: TaskListItem[] = taskRows.slice(0, 6).map((row) => serializeTask(row, today));
  const activity = await recentActivity(
    { role: user.role, institutionIds: scope.institutionIds, isGlobal: false },
    8,
  );

  return {
    role: user.role,
    institution: null,
    counters: {
      submittedAwaitingReview: pending.filter((row) => row.status === "submitted").length,
      underReview: pending.filter((row) => row.status !== "submitted").length,
      correctionsAwaitingCollege: openCorrections,
      correctedReadyForReReview: respondedCorrections,
      replacementsAwaitingReview: replacementsPending.length,
      releasesAwaitingRecommendation,
      assignedTasks: taskRows.length,
      overdueTasks: taskRows.filter((row) => isOverdueTask(row, today)).length,
    },
    upcomingMaturity: upcomingItems,
    recentSubmissions: recentItems,
    actionRequiredTasks: taskItems,
    recentActivity: activity,
    approachingWindowDays: windowDays,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// Approving authority dashboard
// ---------------------------------------------------------------------------

async function authorityDashboard(
  user: AuthenticatedUser,
  scope: AccessScope,
  today: string,
  windowDays: number,
  generatedAt: string,
): Promise<DashboardResponse> {
  if (scope.institutionIds.length === 0) {
    return {
      role: user.role,
      institution: null,
      counters: {
        releasesAwaitingDecision: 0,
        replacementsAwaitingAcceptance: 0,
        releasesAwaitingCompletion: 0,
        overdueDecisions: 0,
      },
      upcomingMaturity: [],
      recentSubmissions: [],
      actionRequiredTasks: [],
      recentActivity: [],
      approachingWindowDays: windowDays,
      generatedAt,
    };
  }

  const fdrRows = await prisma.fdr.findMany({
    where: { institutionId: { in: scope.institutionIds } },
    include: FDR_INCLUDE,
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
  });
  const fdrIds = fdrRows.map((row) => row.id);

  const [releaseRows, taskRows, releases] = await Promise.all([
    prisma.releaseRequest.findMany({
      where: { fdrId: { in: fdrIds } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.task.findMany({
      where: { assigneeUserId: user.id, status: "OPEN" },
      include: TASK_INCLUDE,
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }),
    latestReleaseMap(fdrIds),
  ]);

  // Deduplicate to the latest request per FDR (dashboard shows the live one).
  const latestByFdr = new Map<number, (typeof releaseRows)[number]>();
  for (const row of releaseRows) {
    if (!latestByFdr.has(row.fdrId)) latestByFdr.set(row.fdrId, row);
  }
  const latestRequests = Array.from(latestByFdr.values());

  const releasesAwaitingDecision = latestRequests.filter(
    (row) => row.status === "OPEN" && row.decision === "recommended",
  ).length;
  const releasesAwaitingCompletion = latestRequests.filter(
    (row) => row.status === "DECIDED" && row.decision === "approved" && row.completedAt == null,
  ).length;

  const supersededIds = new Set(fdrRows.filter((row) => row.supersededByFdrId != null).map((row) => row.id));
  const previousIds = new Set(fdrRows.map((row) => row.previousFdrId).filter((id): id is number => id != null));
  const replacementsAwaitingAcceptance = fdrRows.filter(
    (row) =>
      row.previousFdrId != null &&
      row.status === "verified" &&
      previousIds.has(row.previousFdrId) &&
      !supersededIds.has(row.previousFdrId),
  ).length;

  const upcoming = fdrRows
    .filter((row) => row.supersededByFdrId == null && deriveDateCondition(today, toLocal(row.maturityDate), windowDays) !== "current")
    .slice(0, 6);
  const recent = [...fdrRows]
    .filter((row) => row.submittedAt != null)
    .sort((a, b) => (b.submittedAt!.getTime() ?? 0) - (a.submittedAt!.getTime() ?? 0))
    .slice(0, 6);

  const upcomingItems = await toListItems(upcoming, today, windowDays, releases);
  const recentItems = await toListItems(recent, today, windowDays, releases);
  const taskItems: TaskListItem[] = taskRows.slice(0, 6).map((row) => serializeTask(row, today));
  const activity = await recentActivity(
    { role: user.role, institutionIds: scope.institutionIds, isGlobal: false },
    8,
  );

  return {
    role: user.role,
    institution: null,
    counters: {
      releasesAwaitingDecision,
      replacementsAwaitingAcceptance,
      releasesAwaitingCompletion,
      overdueDecisions: taskRows.filter((row) => isOverdueTask(row, today)).length,
    },
    upcomingMaturity: upcomingItems,
    recentSubmissions: recentItems,
    actionRequiredTasks: taskItems,
    recentActivity: activity,
    approachingWindowDays: windowDays,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// System administrator dashboard
// ---------------------------------------------------------------------------

async function adminDashboard(
  user: AuthenticatedUser,
  today: string,
  windowDays: number,
  generatedAt: string,
): Promise<DashboardResponse> {
  const [activeColleges, inactiveColleges, collegeUsers, reviewOfficers, authorities, institutions] =
    await Promise.all([
      prisma.institution.count({ where: { status: "ACTIVE" } }),
      prisma.institution.count({ where: { status: "INACTIVE" } }),
      prisma.user.count({ where: { role: "COLLEGE_USER" } }),
      prisma.user.count({ where: { role: "REVIEW_OFFICER" } }),
      prisma.user.count({ where: { role: "APPROVING_AUTHORITY" } }),
      prisma.institution.findMany({
        select: {
          id: true,
          jurisdictions: { select: { role: true } },
        },
      }),
    ]);

  const missingAssignmentColleges = institutions.filter((institution) => {
    const roles = new Set(institution.jurisdictions.map((row) => row.role));
    return !roles.has("REVIEW_OFFICER") || !roles.has("APPROVING_AUTHORITY");
  }).length;

  const fdrRows = await prisma.fdr.findMany({
    include: FDR_INCLUDE,
    orderBy: [{ maturityDate: "asc" }, { id: "asc" }],
    take: 24,
  });

  const releases = await latestReleaseMap(fdrRows.map((row) => row.id));

  const upcoming = fdrRows
    .filter((row) => row.supersededByFdrId == null && deriveDateCondition(today, toLocal(row.maturityDate), windowDays) !== "current")
    .slice(0, 6);
  const recent = [...fdrRows]
    .filter((row) => row.submittedAt != null)
    .sort((a, b) => (b.submittedAt!.getTime() ?? 0) - (a.submittedAt!.getTime() ?? 0))
    .slice(0, 6);

  const upcomingItems = await toListItems(upcoming, today, windowDays, releases);
  const recentItems = await toListItems(recent, today, windowDays, releases);
  const activity = await recentActivity({ role: user.role, institutionIds: [], isGlobal: true }, 8);

  return {
    role: user.role,
    institution: null,
    counters: {
      activeColleges,
      inactiveColleges,
      collegeUsers,
      reviewOfficers,
      authorities,
      missingAssignmentColleges,
    },
    upcomingMaturity: upcomingItems,
    recentSubmissions: recentItems,
    actionRequiredTasks: [],
    recentActivity: activity,
    approachingWindowDays: windowDays,
    generatedAt,
  };
}

function toLocal(date: Date): string {
  return date.toISOString().slice(0, 10);
}
