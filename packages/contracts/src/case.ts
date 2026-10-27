import { z } from "zod";
import {
  LocalDateSchema,
  MoneySchema,
  RupeeAmountSchema,
  TimestampSchema,
} from "./common.js";
import {
  DateConditionSchema,
  ReleaseStatusSchema,
  ReviewStatusSchema,
} from "./fdr.js";
import { ReadinessPanelSchema } from "./readiness.js";
import { ActivityItemSchema } from "./dashboard.js";
import { TaskListItemSchema } from "./tasks.js";

export const InstrumentTypeSchema = z.enum(["SECURITY_DEPOSIT", "BANK_GUARANTEE"]);

export type InstrumentType = z.infer<typeof InstrumentTypeSchema>;

export const INSTRUMENT_TYPE_LABELS: Record<InstrumentType, string> = {
  SECURITY_DEPOSIT: "Security deposit (FDR)",
  BANK_GUARANTEE: "Bank guarantee",
};

/** What the reviewer saw for one immutable submission version. */
export const FdrVersionSnapshotSchema = z.object({
  versionNo: z.number().int(),
  instrumentType: InstrumentTypeSchema,
  bankName: z.string(),
  bankBranch: z.string(),
  referenceNo: z.string(),
  ifsc: z.string().nullable(),
  beneficiaryName: z.string().nullable(),
  amount: MoneySchema,
  issueDate: LocalDateSchema,
  maturityDate: LocalDateSchema,
  remarks: z.string().nullable(),
  submittedByName: z.string().nullable(),
  createdAt: TimestampSchema,
});

export type FdrVersionSnapshot = z.infer<typeof FdrVersionSnapshotSchema>;

/** Draft payload. All required at draft save-time (the wizard collects them in step 1). */
export const FdrDraftInputSchema = z.object({
  instrumentType: InstrumentTypeSchema.default("SECURITY_DEPOSIT"),
  bankName: z.string().trim().min(2, "Bank name is required").max(140),
  bankBranch: z.string().trim().min(2, "Branch is required").max(200),
  referenceNo: z.string().trim().min(1, "Receipt/reference number is required").max(80),
  amountRupees: RupeeAmountSchema,
  issueDate: LocalDateSchema,
  maturityDate: LocalDateSchema,
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Use a valid IFSC code, or leave empty")
    .optional()
    .default(""),
  beneficiaryName: z.string().trim().max(140).optional().default(""),
  remarks: z.string().trim().max(1500).optional().default(""),
}).superRefine((value, ctx) => {
  if (value.issueDate && value.maturityDate && value.maturityDate <= value.issueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maturityDate"],
      message: "The maturity date must be after the issue date",
    });
  }
});

export type FdrDraftInput = z.infer<typeof FdrDraftInputSchema>;

/**
 * Draft edits may provide a subset of fields. When baseUpdatedAt is sent, the
 * server rejects edits based on an outdated copy (optimistic concurrency).
 */
export const FdrDraftUpdateSchema = z.object({
  instrumentType: InstrumentTypeSchema.optional(),
  bankName: z.string().trim().min(2).max(140).optional(),
  bankBranch: z.string().trim().min(2).max(200).optional(),
  referenceNo: z.string().trim().min(1).max(80).optional(),
  amountRupees: RupeeAmountSchema.optional(),
  issueDate: LocalDateSchema.optional(),
  maturityDate: LocalDateSchema.optional(),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Use a valid IFSC code, or leave empty")
    .optional(),
  beneficiaryName: z.string().trim().max(140).optional(),
  remarks: z.string().trim().max(1500).optional(),
  baseUpdatedAt: TimestampSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.issueDate && value.maturityDate && value.maturityDate <= value.issueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maturityDate"],
      message: "The maturity date must be after the issue date",
    });
  }
});

export type FdrDraftUpdate = z.infer<typeof FdrDraftUpdateSchema>;

/** Generic workflow action outcome so actions can update the active view. */
export const WorkflowResultSchema = z.object({
  fdrId: z.number().int(),
  status: ReviewStatusSchema.optional(),
  versionNo: z.number().int().optional(),
  message: z.string().optional(),
});

export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

export const CaseSubmissionResultSchema = z.object({
  fdrId: z.number().int(),
  publicCode: z.string(),
  versionNo: z.number().int(),
});

export type CaseSubmissionResult = z.infer<typeof CaseSubmissionResultSchema>;

/** The persistent "Next action" block shown on every case screen. */
export const NextActionSchema = z.object({
  /** Current stage, e.g. "with the reviewing officer". */
  stage: z.string(),
  /** Human-readable responsible role/person, e.g. "Reviewing officer". */
  responsible: z.string(),
  /** What must happen next. */
  action: z.string(),
  dueDate: LocalDateSchema.nullable(),
  /** Whether the acting viewer can perform it in the UI. */
  actionAvailable: z.boolean(),
  /** Where the action button navigates/acts. */
  actionPath: z.string().nullable(),
});

export type NextAction = z.infer<typeof NextActionSchema>;

/** An evidence check as recorded by the reviewer. */
export const CheckRecordSchema = z.object({
  id: z.number().int(),
  field: z.string(),
  source: z.enum(["SIMULATED_BANK_CHECK", "MANUAL_OFFICER_REVIEW", "DOCUMENT_FINGERPRINT"]),
  outcome: z.enum(["MATCH", "MISMATCH", "SOURCE_UNAVAILABLE", "MANUAL_REQUIRED", "NOT_YET_CHECKED"]),
  submittedValue: z.string().nullable(),
  observedValue: z.string().nullable(),
  reason: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  checkedByName: z.string().nullable(),
  checkedAt: TimestampSchema,
  fdrVersionNo: z.number().int(),
  /** Present when a later correction invalidated this evidence. */
  invalidatedAt: TimestampSchema.nullable(),
  invalidatedVersionNo: z.number().int().nullable(),
  invalidatedReason: z.string().nullable(),
  dependentFields: z.array(z.string()),
});

export type CheckRecord = z.infer<typeof CheckRecordSchema>;

/** Developer-facing stable names for checkable fields (label lives in the UI). */
export const CHECK_FIELDS = [
  "amount",
  "reference_no",
  "bank_name",
  "bank_branch",
  "maturity_date",
  "issue_date",
  "ifsc",
  "beneficiary_name",
  "instrument_type",
] as const;

export type CheckField = (typeof CHECK_FIELDS)[number];

/** Everything the case workspace needs, computed per acting viewer. */
export const CaseDetailSchema = z.object({
  id: z.number().int(),
  publicCode: z.string(),
  institution: z.object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
  }),
  status: ReviewStatusSchema,
  currentVersion: FdrVersionSnapshotSchema,
  currentVersionNo: z.number().int(),
  dateCondition: DateConditionSchema,
  daysToMaturity: z.number().int(),
  releaseStatus: ReleaseStatusSchema,
  draft: z
    .object({
      updatedAt: TimestampSchema.nullable(),
    })
    .nullable(),
  submittedAt: TimestampSchema.nullable(),
  verifiedAt: TimestampSchema.nullable(),
  instrumentNote: z.string().nullable(),
  remarks: z.string().nullable(),
  readiness: ReadinessPanelSchema,
  readinessReplacement: ReadinessPanelSchema.nullable(),
  readinessRelease: ReadinessPanelSchema.nullable(),
  checks: z.array(CheckRecordSchema),
  versions: z.array(FdrVersionSnapshotSchema),
  corrections: z.array(z.object({
    id: z.number().int(),
    status: z.enum(["OPEN", "RESPONDED", "CANCELLED"]),
    fdrVersionNo: z.number().int(),
    fields: z.array(z.object({
      field: z.string(),
      label: z.string(),
      reason: z.string(),
    })),
    note: z.string().nullable(),
    respondNote: z.string().nullable(),
    requestedByName: z.string(),
    respondedByName: z.string().nullable(),
    respondedVersionNo: z.number().int().nullable(),
    respondedAt: z.string().nullable(),
    createdAt: TimestampSchema,
  })),
  releases: z.array(z.object({
    id: z.number().int(),
    status: z.enum(["OPEN", "DECIDED"]),
    decision: z.enum(["requested", "recommended", "approved", "rejected", "completed", "none"]).nullable(),
    reason: z.string(),
    requestedByName: z.string(),
    createdAt: TimestampSchema,
  })),
  previousFdr: z.object({
    id: z.number().int(),
    publicCode: z.string(),
    maturityDate: LocalDateSchema,
    status: ReviewStatusSchema,
    supersededByFdrId: z.number().int().nullable(),
    supersededAt: z.string().nullable(),
  }).nullable(),
  successors: z.array(z.object({
    id: z.number().int(),
    publicCode: z.string(),
    status: ReviewStatusSchema,
  })),
  tasks: z.array(TaskListItemSchema),
  activity: z.array(ActivityItemSchema),
  permissions: z.object({
    canEditDraft: z.boolean(),
    canSubmit: z.boolean(),
    canUploadDocument: z.boolean(),
    canRespondCorrection: z.boolean(),
    canStartReview: z.boolean(),
    canRecordCheck: z.boolean(),
    canRequestCorrection: z.boolean(),
    canVerify: z.boolean(),
    canRecommendReplacement: z.boolean(),
    canAcceptReplacement: z.boolean(),
    canRequestRelease: z.boolean(),
    canDecideRelease: z.boolean(),
    canCompleteRelease: z.boolean(),
  }),
  nextAction: NextActionSchema.nullable(),
  generatedAt: TimestampSchema,
});

export type CaseDetail = z.infer<typeof CaseDetailSchema>;
