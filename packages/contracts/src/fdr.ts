import { z } from "zod";
import { LocalDateSchema, MoneySchema, TimestampSchema } from "./common.js";

/**
 * Review state of a submission. Kept strictly separate from the derived
 * date condition and from the release status.
 */
export const ReviewStatusSchema = z.enum([
  "draft",
  "submitted",
  "under_review",
  "discrepancy",
  "verified",
]);

export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** Derived from recorded calendar dates only; never implies a legal conclusion. */
export const DateConditionSchema = z.enum(["current", "approaching_maturity", "matured"]);

export type DateCondition = z.infer<typeof DateConditionSchema>;

/** Release state of the instrument; approval records permission, completion requires separate evidence. */
export const ReleaseStatusSchema = z.enum([
  "none",
  "requested",
  "recommended",
  "approved",
  "rejected",
  "completed",
]);

export type ReleaseStatus = z.infer<typeof ReleaseStatusSchema>;

export const FdrListItemSchema = z.object({
  id: z.number().int(),
  publicCode: z.string(),
  institution: z.object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
  }),
  bankName: z.string(),
  bankBranch: z.string(),
  referenceNo: z.string(),
  amount: MoneySchema,
  issueDate: LocalDateSchema,
  maturityDate: LocalDateSchema,
  status: ReviewStatusSchema,
  dateCondition: DateConditionSchema,
  /** Business-date days until maturity; negative when matured. */
  daysToMaturity: z.number().int(),
  releaseStatus: ReleaseStatusSchema,
  submittedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
});

export type FdrListItem = z.infer<typeof FdrListItemSchema>;

export const FdrStatusFilterSchema = ReviewStatusSchema;

export const FdrSortOptionSchema = z.enum(["maturity_asc", "maturity_desc", "created_desc"]);

export type FdrSortOption = z.infer<typeof FdrSortOptionSchema>;

export const ListFdrsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: FdrStatusFilterSchema.optional(),
  /** Officers may narrow the list to one institution inside their jurisdiction. */
  institutionId: z.coerce.number().int().positive().optional(),
  dateCondition: DateConditionSchema.optional(),
  sort: FdrSortOptionSchema.default("maturity_asc"),
});

export type ListFdrsQuery = z.infer<typeof ListFdrsQuerySchema>;

export const FdrListResponseSchema = z.object({
  items: z.array(FdrListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type FdrListResponse = z.infer<typeof FdrListResponseSchema>;
