import { z } from "zod";
import { LocalDateSchema, MoneySchema, TimestampSchema } from "./common.js";
import { UserRoleSchema } from "./auth.js";
import { ActivityItemSchema } from "./dashboard.js";
import { FdrListItemSchema } from "./fdr.js";
import { ReviewStatusSchema } from "./fdr.js";

// ---------------------------------------------------------------------------
// Roles the college module knows (server-enforced; the UI only mirrors them)
// ---------------------------------------------------------------------------

export const JurisdictionRoleSchema = z.enum(["REVIEW_OFFICER", "APPROVING_AUTHORITY"]);

export type JurisdictionRole = z.infer<typeof JurisdictionRoleSchema>;

export const OFFICER_ROLE_LABELS: Record<JurisdictionRole, string> = {
  REVIEW_OFFICER: "Reviewing officer",
  APPROVING_AUTHORITY: "Approving authority",
};

// ---------------------------------------------------------------------------
// Institution (college) records
// ---------------------------------------------------------------------------

/** The internal code distinguishes demo/internal installation identifiers from official codes. */
export const InstitutionInputSchema = z.object({
  name: z.string().trim().min(2, "College name is required").max(160),
  code: z
    .string()
    .trim()
    .min(2, "Internal code is required")
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits and dashes"),
  officialCode: z
    .string()
    .trim()
    .max(40)
    .regex(/^$|^[A-Za-z0-9-]+$/, "Use letters, digits and dashes")
    .optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  addressLine: z.string().trim().max(240).optional(),
  postalCode: z.string().trim().max(12).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactDesignation: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email("Enter a valid email").max(200).optional(),
  contactPhone: z.string().trim().max(20).optional(),
});

export type InstitutionInput = z.infer<typeof InstitutionInputSchema>;

export const InstitutionStatusActionSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  /** Short note recorded with the change (required for deactivation). */
  note: z.string().trim().max(400).optional().default(""),
});

export type InstitutionStatusAction = z.infer<typeof InstitutionStatusActionSchema>;

export const OfficerRefSchema = z.object({
  id: z.number().int(),
  fullName: z.string(),
  email: z.string(),
  role: UserRoleSchema.nullable().optional(),
});

export type OfficerRef = z.infer<typeof OfficerRefSchema>;

export const InstitutionListItemSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  officialCode: z.string().nullable(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  isDemo: z.boolean(),
  reviewOfficers: z.array(OfficerRefSchema),
  authorityOfficers: z.array(OfficerRefSchema),
  /** Submissions permitted only while ACTIVE (sample deactivation policy). */
  canAcceptSubmissions: z.boolean(),
  createdAt: TimestampSchema,
});

export type InstitutionListItem = z.infer<typeof InstitutionListItemSchema>;

export const InstitutionListResponseSchema = z.object({
  items: z.array(InstitutionListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type InstitutionListResponse = z.infer<typeof InstitutionListResponseSchema>;

export const ListInstitutionsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  /** Institutions with/without the requested assignment kind. */
  assignment: z.enum(["assigned", "unassigned"]).optional(),
  role: JurisdictionRoleSchema.optional(),
  officerId: z.coerce.number().int().positive().optional(),
  sort: z.enum(["name_asc", "name_desc", "created_asc", "created_desc"]).default("name_asc"),
  /** Fallback single-page size for the officer directory (max 50). */
});

export type ListInstitutionsQuery = z.infer<typeof ListInstitutionsQuerySchema>;

export const PortfolioSummarySchema = z.object({
  instrumentsTotal: z.number().int(),
  drafts: z.number().int(),
  awaitingReview: z.number().int(),
  verified: z.number().int(),
  superseded: z.number().int(),
  activeAmount: MoneySchema,
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

export const AccountSummarySchema = z.object({
  id: z.number().int(),
  email: z.string(),
  fullName: z.string(),
  role: UserRoleSchema,
  designation: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: TimestampSchema,
  institutionId: z.number().int().nullable(),
});

export type AccountSummary = z.infer<typeof AccountSummarySchema>;

export const InstitutionDetailSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  officialCode: z.string().nullable(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  addressLine: z.string().nullable(),
  postalCode: z.string().nullable(),
  contactName: z.string().nullable(),
  contactDesignation: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  isDemo: z.boolean(),
  createdAt: TimestampSchema,
  officers: z.array(z.object({
    officerId: z.number().int(),
    officerName: z.string(),
    officerEmail: z.string(),
    role: JurisdictionRoleSchema,
    assignedAt: TimestampSchema.nullable(),
  })),
  accounts: z.array(AccountSummarySchema),
  portfolio: PortfolioSummarySchema,
  openWork: z.object({
    openCorrections: z.number().int(),
    openReleases: z.number().int(),
    pendingReplacements: z.number().int(),
    reviewTasks: z.number().int(),
  }),
  upcomingMaturity: z.array(FdrListItemSchema),
  recentSubmissions: z.array(FdrListItemSchema),
  cases: z.array(z.object({
    id: z.number().int(),
    publicCode: z.string(),
    bankName: z.string(),
    status: ReviewStatusSchema,
    dateCondition: z.enum(["current", "approaching_maturity", "matured"]),
    maturityDate: LocalDateSchema,
    amount: MoneySchema,
  })),
  recentActivity: z.array(ActivityItemSchema),
  contact: z.string().nullable(),
});

export type InstitutionDetail = z.infer<typeof InstitutionDetailSchema>;

// ---------------------------------------------------------------------------
// Account provisioning
// ---------------------------------------------------------------------------

export const ProvisionAccountRequestSchema = z.object({
  institutionId: z.number().int().positive(),
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(320),
  designation: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
});

export type ProvisionAccountRequest = z.infer<typeof ProvisionAccountRequestSchema>;

/**
 * The temporary password is returned exactly once, in this response only.
 * It is never stored in plaintext and never shown again; the account must
 * replace it at first sign-in.
 */
export const ProvisionAccountResponseSchema = z.object({
  account: AccountSummarySchema,
  temporaryPassword: z.string(),
  note: z.string(),
});

export type ProvisionAccountResponse = z.infer<typeof ProvisionAccountResponseSchema>;

export const ResetPasswordResponseSchema = z.object({
  account: AccountSummarySchema,
  temporaryPassword: z.string(),
  note: z.string(),
});

export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

export const ListUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: UserRoleSchema.optional(),
  institutionId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sort: z.enum(["created_desc", "created_asc", "name_asc", "name_desc"]).default("created_desc"),
});

export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const UserListResponseSchema = z.object({
  items: z.array(AccountSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const AssignmentUpdateRequestSchema = z.object({
  officerId: z.number().int().positive(),
  role: JurisdictionRoleSchema,
  action: z.enum(["assign", "unassign"]),
});

export type AssignmentUpdateRequest = z.infer<typeof AssignmentUpdateRequestSchema>;

/** SAMPLE deactivation policy: new submissions are blocked while history stays readable. */
export const SUBMISSION_BLOCK_POLICY_NOTE =
  "SAMPLE policy: a deactivated college cannot start new submissions; existing cases stay" +
  " readable and authorized officers can still complete them.";
