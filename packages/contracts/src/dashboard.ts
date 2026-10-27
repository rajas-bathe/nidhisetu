import { z } from "zod";
import { InstitutionRefSchema, MoneySchema, TimestampSchema } from "./common.js";
import { UserRoleSchema } from "./auth.js";
import { FdrListItemSchema } from "./fdr.js";
import { TaskListItemSchema } from "./tasks.js";

/**
 * A compact entry for recent workflow history used by dashboards and the case
 * activity tab. There are no secrets here: actor names and public codes only.
 */
export const ActivityItemSchema = z.object({
  id: z.string(),
  /** Human-readable action label, e.g. "Submitted for review". */
  actionLabel: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  /** Free-text summary safe to display; secrets are stripped at recording time. */
  summary: z.string().nullable(),
  /** App route where the record can be opened, when applicable. */
  linkPath: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: TimestampSchema,
});

export type ActivityItem = z.infer<typeof ActivityItemSchema>;

/** College representative counters (all scoped to their own institution). */
export const CollegeCountersSchema = z.object({
  /** Non-superseded instruments; activeAmount is their combined deposit value. */
  activeInstruments: z.number().int(),
  activeAmount: MoneySchema,
  drafts: z.number().int(),
  /** Submitted/under_review/discrepancy cases that still need review work. */
  awaitingReview: z.number().int(),
  /** Open correction requests the college must respond to. */
  correctionsRequired: z.number().int(),
  /** Non-superseded instruments approaching or past maturity (sample window). */
  approachingMaturity: z.number().int(),
  /** Open renewal obligations: matured/approaching instruments without an accepted replacement. */
  openReplacementObligations: z.number().int(),
  /** Release requests that are not fully decided yet. */
  pendingReleaseRequests: z.number().int(),
});

export type CollegeCounters = z.infer<typeof CollegeCountersSchema>;

/** Reviewing officer counters (jurisdiction-scoped). */
export const OfficerCountersSchema = z.object({
  /** Cases in "submitted" state awaiting review start or checks. */
  submittedAwaitingReview: z.number().int(),
  underReview: z.number().int(),
  /** Open correction requests waiting for the college's response. */
  correctionsAwaitingCollege: z.number().int(),
  /** Corrections already responded with a newer version to re-check. */
  correctedReadyForReReview: z.number().int(),
  /** Replacement submissions in submitted/under_review/discrepancy state. */
  replacementsAwaitingReview: z.number().int(),
  /** Release requests with no recommendation yet. */
  releasesAwaitingRecommendation: z.number().int(),
  assignedTasks: z.number().int(),
  overdueTasks: z.number().int(),
});

export type OfficerCounters = z.infer<typeof OfficerCountersSchema>;

/** Approving authority counters (jurisdiction-scoped). */
export const AuthorityCountersSchema = z.object({
  /** Recommended release requests awaiting the decision. */
  releasesAwaitingDecision: z.number().int(),
  /** Verified replacement recommendations awaiting acceptance. */
  replacementsAwaitingAcceptance: z.number().int(),
  /** Approved releases whose completion evidence is still missing. */
  releasesAwaitingCompletion: z.number().int(),
  /** Open acceptance/decision tasks past their due date. */
  overdueDecisions: z.number().int(),
});

export type AuthorityCounters = z.infer<typeof AuthorityCountersSchema>;

/** System administrator counters. */
export const AdminCountersSchema = z.object({
  activeColleges: z.number().int(),
  inactiveColleges: z.number().int(),
  collegeUsers: z.number().int(),
  reviewOfficers: z.number().int(),
  authorities: z.number().int(),
  /** Institutions missing a reviewing officer or an approving authority assignment. */
  missingAssignmentColleges: z.number().int(),
});

export type AdminCounters = z.infer<typeof AdminCountersSchema>;

export const DashboardCountersSchema = z.union([
  CollegeCountersSchema,
  OfficerCountersSchema,
  AuthorityCountersSchema,
  AdminCountersSchema,
]);

export type DashboardCounters = CollegeCounters | OfficerCounters | AuthorityCounters | AdminCounters;

export const DashboardResponseSchema = z.object({
  role: UserRoleSchema,
  institution: InstitutionRefSchema.nullable(),
  counters: DashboardCountersSchema,
  /** Instruments outside "current" (approaching or matured), nearest maturity first. */
  upcomingMaturity: z.array(FdrListItemSchema),
  /** Most recent submissions, newest first. */
  recentSubmissions: z.array(FdrListItemSchema),
  /** Open work assigned to the acting role/institution, most urgent first. */
  actionRequiredTasks: z.array(TaskListItemSchema),
  /** Recent workflow history meaningful for this viewer. */
  recentActivity: z.array(ActivityItemSchema),
  /** Configured sample window (days to maturity) used for "approaching" classification. */
  approachingWindowDays: z.number().int(),
  generatedAt: TimestampSchema,
});

export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
