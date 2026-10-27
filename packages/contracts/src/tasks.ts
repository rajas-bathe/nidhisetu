import { z } from "zod";
import { LocalDateSchema, TimestampSchema } from "./common.js";
import { UserRoleSchema } from "./auth.js";

export const TaskTypeSchema = z.enum([
  "VERIFICATION_REVIEW",
  "DOCUMENT_CORRECTION",
  "RENEWAL_AFTER_MATURITY",
  "RELEASE_RECOMMENDED",
  "RELEASE_DECISION",
  "GENERIC_REVIEW",
  "REPLACEMENT_ACCEPTANCE",
]);

export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ListTasksQuerySchema = z.object({
  status: TaskStatusSchema.default("OPEN"),
  onlyOverdue: z.coerce.boolean().optional(),
  /** Narrow to one case (staff) / own institution's case (college). */
  fdrId: z.coerce.number().int().positive().optional(),
  /** Single type filter (drill-downs). */
  type: TaskTypeSchema.optional(),
  /** Free-text search in the task title/detail. */
  q: z.string().trim().max(120).optional(),
});

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

export const TaskListItemSchema = z.object({
  id: z.number().int(),
  type: TaskTypeSchema,
  title: z.string(),
  detail: z.string().nullable(),
  status: TaskStatusSchema,
  dueDate: LocalDateSchema,
  isOverdue: z.boolean(),
  /** Case reference when the task is tied to an FDR case. */
  fdrId: z.number().int().nullable(),
  fdrPublicCode: z.string().nullable(),
  /** Who is responsible: institution-level tasks name the institution. */
  assigneeUserId: z.number().int().nullable(),
  assigneeInstitutionId: z.number().int().nullable(),
  createdAt: TimestampSchema,
});

export type TaskListItem = z.infer<typeof TaskListItemSchema>;

export const TaskListResponseSchema = z.object({
  items: z.array(TaskListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

/** Convenience label map for the frontend (badge text). */
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  VERIFICATION_REVIEW: "Verification review",
  DOCUMENT_CORRECTION: "Document correction",
  RENEWAL_AFTER_MATURITY: "Renewal after maturity",
  RELEASE_RECOMMENDED: "Release recommendation",
  RELEASE_DECISION: "Release decision",
  GENERIC_REVIEW: "Review follow-up",
  REPLACEMENT_ACCEPTANCE: "Accept replacement",
};
