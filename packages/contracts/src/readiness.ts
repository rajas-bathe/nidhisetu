import { z } from "zod";
import { LocalDateSchema, TimestampSchema } from "./common.js";

/**
 * Deterministic readiness checklist result for one workflow context
 * (verification, replacement acceptance, release). All rules shipped with this
 * repository are SAMPLE business rules for demonstration: they never claim
 * official AICTE deposit rules, minimum durations, or eligibility criteria.
 */
export const ReadinessItemStatusSchema = z.enum(["pass", "fail", "pending", "na"]);

export type ReadinessItemStatus = z.infer<typeof ReadinessItemStatusSchema>;

export const ReadinessItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: ReadinessItemStatusSchema,
  /** Human-readable explanation of why this requirement is in this state. */
  reason: z.string(),
  /** Stable reference to evidence backing the check (check id, document id, link). */
  evidenceRef: z.string().nullable(),
  /** Who can move this item forward. */
  responsible: z.enum(["college", "reviewing_officer", "approving_authority", "system_admin"]),
  /** Concrete next step, phrased for the responsible role. */
  nextAction: z.string().nullable(),
  /** True when this requirement must pass before any approval is possible. */
  isBlocker: z.boolean(),
  /** Where the rule derives from: recorded facts, sample policy, or simulated checks. */
  source: z.enum(["record", "check", "document", "sample_policy", "simulated_check"]),
});

export type ReadinessItem = z.infer<typeof ReadinessItemSchema>;

export const ReadinessPanelSchema = z.object({
  context: z.enum(["verification", "replacement_acceptance", "release"]),
  headline: z.string(),
  items: z.array(ReadinessItemSchema),
  /** Labels of blocking items; gates every approval decision. */
  blockers: z.array(z.string()),
  /**
   * Soft completeness percentage for display only. May be null when blockers
   * exist: a numerical score must never override a mandatory blocker.
   */
  scorePercent: z.number().int().nullable(),
  policyNote: z.string(),
  generatedAt: TimestampSchema,
  generatedFrom: z.literal("deterministic_sample_rules"),
});

export type ReadinessPanel = z.infer<typeof ReadinessPanelSchema>;

/** Records in the correction contract name the field when the panel is opened. */
export const ActionDeadlineSchema = z.object({
  dueDate: LocalDateSchema,
  label: z.string(),
});

export type ActionDeadline = z.infer<typeof ActionDeadlineSchema>;
