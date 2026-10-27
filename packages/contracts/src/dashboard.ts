import { z } from "zod";
import { InstitutionRefSchema, TimestampSchema } from "./common.js";
import { UserRoleSchema } from "./auth.js";
import { FdrListItemSchema } from "./fdr.js";
import { TaskListItemSchema } from "./tasks.js";

export const DashboardCountersSchema = z.object({
  /** Cases in submitted/under_review/discrepancy that still need verification work. */
  pendingVerification: z.number().int(),
  /** Open tasks assigned to the acting role/institution (the "Action Required" list). */
  awaitingMyAction: z.number().int(),
  /** Open tasks whose due date has passed. */
  overdueTasks: z.number().int(),
  /** Non-superseded instruments approaching or past maturity inside the sample window. */
  approachingMaturity: z.number().int(),
  /** Live instruments that are not superseded by an accepted replacement. */
  currentInstruments: z.number().int(),
});

export type DashboardCounters = z.infer<typeof DashboardCountersSchema>;

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
  /** Configured sample window (days to maturity) used for "approaching" classification. */
  approachingWindowDays: z.number().int(),
  generatedAt: TimestampSchema,
});

export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
