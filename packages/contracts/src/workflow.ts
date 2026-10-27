import { z } from "zod";
import { LocalDateSchema, RupeeAmountOptionalSchema, TimestampSchema } from "./common.js";
import { ReviewStatusSchema } from "./fdr.js";

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/** One field the officer asks the college to correct. Labels stay editable. */
export const CorrectionFieldInputSchema = z.object({
  field: z.string().trim().min(1, "Pick a field").max(60),
  reason: z.string().trim().min(5, "Explain what has to be corrected").max(600),
});

export const CorrectionCreateRequestSchema = z.object({
  fdrId: z.number().int().positive(),
  fields: z.array(CorrectionFieldInputSchema).min(1, "Select at least one field").max(10),
  note: z.string().trim().max(1000).optional(),
});

export type CorrectionCreateRequest = z.infer<typeof CorrectionCreateRequestSchema>;

export const CorrectionFieldItemSchema = z.object({
  field: z.string(),
  label: z.string(),
  reason: z.string(),
});

export const CorrectionItemSchema = z.object({
  id: z.number().int(),
  fdrId: z.number().int(),
  fdrPublicCode: z.string().nullable(),
  institutionName: z.string().nullable(),
  fdrVersionNo: z.number().int(),
  status: z.enum(["OPEN", "RESPONDED", "CANCELLED"]),
  fields: z.array(CorrectionFieldItemSchema),
  note: z.string().nullable(),
  respondNote: z.string().nullable(),
  requestedByName: z.string().nullable(),
  respondedByName: z.string().nullable(),
  respondedVersionNo: z.number().int().nullable(),
  respondedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export type CorrectionItem = z.infer<typeof CorrectionItemSchema>;

export const CorrectionListResponseSchema = z.object({
  items: z.array(CorrectionItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type CorrectionListResponse = z.infer<typeof CorrectionListResponseSchema>;

export const ListCorrectionsQuerySchema = z.object({
  status: z.enum(["OPEN", "RESPONDED", "CANCELLED"]).optional(),
  fdrId: z.coerce.number().int().positive().optional(),
  institutionId: z.coerce.number().int().positive().optional(),
});

export type ListCorrectionsQuery = z.infer<typeof ListCorrectionsQuerySchema>;

/**
 * The college's correction response: only the fields the officer listed, plus
 * a note. Each value is a plain string; the server re-parses it by field type
 * (amount in rupees, IFSC, dates) and writes the next immutable version.
 */
export const CorrectionRespondRequestSchema = z.object({
  correctionId: z.number().int().positive(),
  values: z
    .array(z.object({
      field: z.string().min(1),
      value: z.string().max(200),
    }))
    .min(1, "Correct at least one field"),
  note: z.string().trim().max(1000).optional(),
});

export type CorrectionRespondRequest = z.infer<typeof CorrectionRespondRequestSchema>;

// ---------------------------------------------------------------------------
// Replacements (renewal by a new instrument)
// ---------------------------------------------------------------------------

export const ReplacementRecommendRequestSchema = z.object({
  fdrId: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
});

export const ReplacementDecisionRequestSchema = z.object({
  fdrId: z.number().int().positive(),
  /** Required when rejecting; optional positive note when accepting. */
  reason: z.string().trim().max(1000).optional(),
});

export type ReplacementRecommendRequest = z.infer<typeof ReplacementRecommendRequestSchema>;

export type ReplacementDecisionRequest = z.infer<typeof ReplacementDecisionRequestSchema>;

export const ReplacementPendingItemSchema = z.object({
  fdrId: z.number().int(),
  fdrPublicCode: z.string(),
  institutionName: z.string(),
  status: ReviewStatusSchema,
  previousFdrId: z.number().int(),
  previousPublicCode: z.string(),
  previousStatus: ReviewStatusSchema,
  submittedAt: TimestampSchema.nullable(),
  stage: z.enum(["review", "recommended", "accepted", "rejected"]),
});

export type ReplacementPendingItem = z.infer<typeof ReplacementPendingItemSchema>;

/** Old -> proposed -> accepted chain readable in one structure. */
export const ReplacementChainItemSchema = z.object({
  oldFdr: z.object({ id: z.number().int(), publicCode: z.string(), maturityDate: LocalDateSchema, status: ReviewStatusSchema }),
  proposals: z.array(z.object({
    id: z.number().int(),
    publicCode: z.string(),
    status: ReviewStatusSchema,
    superseded: z.boolean(),
    submittedAt: TimestampSchema.nullable(),
  })),
});

export type ReplacementChainItem = z.infer<typeof ReplacementChainItemSchema>;

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

/** SAMPLE evidence categories for release requests and completions. */
export const ReleaseEvidenceTypeSchema = z.enum([
  "ORIGINAL_FDR_RECEIPT",
  "BANK_ACCOUNT_STATEMENT",
  "BANK_REFUND_CONFIRMATION",
  "BANK_ADVICE_LETTER",
  "OTHER_DOCUMENT",
]);

export type ReleaseEvidenceType = z.infer<typeof ReleaseEvidenceTypeSchema>;

export const RELEASE_EVIDENCE_TYPE_LABELS: Record<ReleaseEvidenceType, string> = {
  ORIGINAL_FDR_RECEIPT: "Original FDR receipt",
  BANK_ACCOUNT_STATEMENT: "Bank account statement",
  BANK_REFUND_CONFIRMATION: "Bank refund confirmation",
  BANK_ADVICE_LETTER: "Bank advice/letter",
  OTHER_DOCUMENT: "Other document",
};

export const ReleaseCreateRequestSchema = z.object({
  fdrId: z.number().int().positive(),
  reason: z.string().trim().min(10, "Explain briefly why this release is needed (min 10 characters)").max(1000),
  evidenceType: ReleaseEvidenceTypeSchema,
  evidenceRef: z.string().trim().max(100).optional().default(""),
});

export type ReleaseCreateRequest = z.infer<typeof ReleaseCreateRequestSchema>;

/** Recommendation (officer) or decision (authority); reject paths demand a reason. */
export const ReleaseActionRequestSchema = z.object({
  releaseId: z.number().int().positive(),
  action: z.enum(["recommend", "reject", "approve"]),
  note: z.string().trim().max(1000).optional(),
});

export type ReleaseActionRequest = z.infer<typeof ReleaseActionRequestSchema>;

/** Completion records the external evidence the portal merely *records*. */
export const ReleaseCompleteRequestSchema = z.object({
  releaseId: z.number().int().positive(),
  evidenceType: ReleaseEvidenceTypeSchema,
  evidenceRef: z.string().trim().min(1, "The evidence reference is required").max(100),
  evidenceDate: LocalDateSchema,
  completedAmountRupees: RupeeAmountOptionalSchema.optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

export type ReleaseCompleteRequest = z.infer<typeof ReleaseCompleteRequestSchema>;

export const ReleaseItemSchema = z.object({
  id: z.number().int(),
  fdrId: z.number().int(),
  fdrPublicCode: z.string().nullable(),
  institutionId: z.number().int().nullable(),
  institutionName: z.string().nullable(),
  status: z.enum(["OPEN", "DECIDED"]),
  decision: z.enum(["requested", "recommended", "approved", "rejected", "completed", "none"]).nullable(),
  decisionStage: z.enum(["reviewing_officer", "approving_authority"]).nullable(),
  reason: z.string(),
  evidenceType: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  requestedByName: z.string().nullable(),
  recommendedByName: z.string().nullable(),
  recommendationNote: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: TimestampSchema.nullable(),
  completionEvidenceType: z.string().nullable(),
  completionEvidenceRef: z.string().nullable(),
  completionEvidenceDate: LocalDateSchema.nullable(),
  completedAmount: z.string().nullable(),
  completionNote: z.string().nullable(),
  completedByName: z.string().nullable(),
  completedAt: TimestampSchema.nullable(),
  policyVersion: z.string().nullable(),
  createdAt: TimestampSchema,
});

export type ReleaseItem = z.infer<typeof ReleaseItemSchema>;

export const ReleaseListResponseSchema = z.object({
  items: z.array(ReleaseItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type ReleaseListResponse = z.infer<typeof ReleaseListResponseSchema>;

export const ListReleasesQuerySchema = z.object({
  fdrId: z.coerce.number().int().positive().optional(),
  institutionId: z.coerce.number().int().positive().optional(),
  /** Lifecycle filter derived from status+decision couples. */
  stage: z.enum(["open", "recommended", "decided", "approved", "completed"]).optional(),
});

export type ListReleasesQuery = z.infer<typeof ListReleasesQuerySchema>;

// ---------------------------------------------------------------------------
// Approval queue (authority)
// ---------------------------------------------------------------------------

export const ApprovalItemSchema = z.object({
  kind: z.enum(["replacement_acceptance", "release_decision"]),
  /** For replacements this is the new (replacement) Fdr id; for releases the ReleaseRequest id. */
  id: z.number().int(),
  fdrId: z.number().int(),
  fdrPublicCode: z.string(),
  institutionName: z.string(),
  /** Human stage summary, e.g. "Verified replacement - eligible for acceptance". */
  stage: z.string(),
  detail: z.string().nullable(),
  openedAt: TimestampSchema,
  dueDate: z.string().nullable(),
  isOverdue: z.boolean(),
});

export type ApprovalItem = z.infer<typeof ApprovalItemSchema>;

export const ApprovalQueueResponseSchema = z.object({
  items: z.array(ApprovalItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type ApprovalQueueResponse = z.infer<typeof ApprovalQueueResponseSchema>;

export const ListApprovalsQuerySchema = z.object({
  kind: z.enum(["replacement_acceptance", "release_decision"]).optional(),
  includeDecided: z.coerce.boolean().optional(),
});

export type ListApprovalsQuery = z.infer<typeof ListApprovalsQuerySchema>;

// ---------------------------------------------------------------------------
// Review workspace (evidence checks, verify)
// ---------------------------------------------------------------------------

/** Recording one evidence check for the current case version. */
export const CheckRecordRequestSchema = z.object({
  fdrId: z.number().int().positive(),
  field: z.string().trim().min(1, "Select the checked field").max(60),
  source: z.enum(["SIMULATED_BANK_CHECK", "MANUAL_OFFICER_REVIEW", "DOCUMENT_FINGERPRINT"]),
  /**
   * For SIMULATED_BANK_CHECK the outcome is derived server-side from the
   * submitted vs observed values (deterministic; never random) and MUST NOT
   * be provided. For manual sources the officer picks the outcome.
   */
  outcome: z
    .enum(["MATCH", "MISMATCH", "SOURCE_UNAVAILABLE", "MANUAL_REQUIRED"])
    .optional(),
  observedValue: z.string().trim().max(200).optional().default(""),
  reason: z.string().trim().max(600).optional().default(""),
  evidenceRef: z.string().trim().max(200).optional().default(""),
});

export type CheckRecordRequest = z.infer<typeof CheckRecordRequestSchema>;

/** Gates and outcomes surfaced by a verify attempt (409 lists blockers). */
export const VerifyRequestSchema = z.object({
  fdrId: z.number().int().positive(),
  note: z.string().trim().max(1000).optional().default(""),
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export const StartReviewRequestSchema = z.object({
  fdrId: z.number().int().positive(),
});

export type StartReviewRequest = z.infer<typeof StartReviewRequestSchema>;
