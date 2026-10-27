import { z } from "zod";
import { LocalDateSchema, TimestampSchema } from "./common.js";

export const ReportKindSchema = z.enum([
  /** Every instrument in the viewer's scope (register). */
  "register",
  /** Approaching or matured instruments inside the scope. */
  "upcoming_maturity",
  /** Open correction requests. */
  "pending_corrections",
  /** Instruments with an open renewal/replacement obligation. */
  "replacement_obligations",
  /** Release request lifecycle state. */
  "release_status",
]);

export type ReportKind = z.infer<typeof ReportKindSchema>;

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  register: "Instrument register",
  upcoming_maturity: "Upcoming & matured instruments",
  pending_corrections: "Pending corrections",
  replacement_obligations: "Replacement obligations",
  release_status: "Release request status",
};

export const ReportQuerySchema = z.object({
  institutionId: z.coerce.number().int().positive().optional(),
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
  /** Include superseded instruments in register/upcoming reports. */
  includeSuperseded: z.coerce.boolean().optional(),
});

export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const ReportColumnTypeSchema = z.enum(["text", "money", "date", "number", "note"]);

export const ReportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: ReportColumnTypeSchema,
});

export type ReportColumn = z.infer<typeof ReportColumnSchema>;

/**
 * Rows carry display-ready string cell values (money already in exact decimal
 * "rupees.paise", dates as YYYY-MM-DD) so the table and the CSV export are
 * produced from the identical serialization.
 */
export const ReportRowSchema = z.object({
  id: z.string(),
  cells: z.record(z.string(), z.string().nullable()),
});

export type ReportRow = z.infer<typeof ReportRowSchema>;

export const ReportResponseSchema = z.object({
  kind: ReportKindSchema,
  generatedAt: TimestampSchema,
  generatedFrom: z.literal("authorized_scope_query"),
  columns: z.array(ReportColumnSchema),
  rows: z.array(ReportRowSchema),
  count: z.number().int(),
  isSample: z.boolean(),
  sampleNote: z.string(),
});

export type ReportResponse = z.infer<typeof ReportResponseSchema>;
