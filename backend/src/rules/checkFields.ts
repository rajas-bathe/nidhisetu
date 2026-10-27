/**
 * Stable registry of the fields evidence checks and correction requests may
 * address. Field names are machine identifiers; labels are user-facing. The
 * dependency map drives transactional invalidation of stale checks when a
 * correction changes any field a check relied on.
 */
import type { CheckField } from "@sih26265/contracts";

export type CheckFieldKey = CheckField;

export interface CheckFieldMeta {
  label: string;
  /** Which value shape the field holds when parsed from free-text input. */
  valueType: "money" | "text" | "date" | "ifsc";
  /** Fields that must invalidate checks on THIS field when they change. */
  dependsOn: readonly CheckField[];
}

export const CHECK_FIELD_META: Record<CheckFieldKey, CheckFieldMeta> = {
  amount: { label: "Deposit amount", valueType: "money", dependsOn: ["amount"] },
  reference_no: { label: "Receipt / reference number", valueType: "text", dependsOn: ["reference_no"] },
  bank_name: { label: "Bank name", valueType: "text", dependsOn: ["bank_name", "bank_branch"] },
  bank_branch: { label: "Branch", valueType: "text", dependsOn: ["bank_name", "bank_branch"] },
  maturity_date: { label: "Maturity date", valueType: "date", dependsOn: ["maturity_date"] },
  issue_date: { label: "Issue date", valueType: "date", dependsOn: ["issue_date"] },
  ifsc: { label: "IFSC code", valueType: "ifsc", dependsOn: ["ifsc", "beneficiary_name"] },
  beneficiary_name: { label: "Beneficiary name", valueType: "text", dependsOn: ["ifsc", "beneficiary_name"] },
  instrument_type: { label: "Instrument type", valueType: "text", dependsOn: ["instrument_type"] },
};

/** True when the field may be corrected by the college through a correction request. */
export function isCorrectableField(field: string): boolean {
  return field in CHECK_FIELD_META;
}

/** The fields a check on `field` relies on (stored as VerificationCheck.dependentFields). */
export function dependentFieldsFor(field: CheckFieldKey): string[] {
  const own = CHECK_FIELD_META[field].dependsOn;
  return Array.from(new Set([field, ...own]));
}

export function fieldLabel(field: string): string {
  return (CHECK_FIELD_META as Record<string, CheckFieldMeta | undefined>)[field]?.label ?? field;
}

/** Fields whose change invalidates a check on `field`. */
export function invalidatingFieldsFor(field: CheckFieldKey): readonly string[] {
  return CHECK_FIELD_META[field].dependsOn;
}

// ---------------------------------------------------------------------------
// Sample categories for recorded completion/request evidence (labelled SAMPLE).
// ---------------------------------------------------------------------------

export const RELEASE_EVIDENCE_TYPES = [
  "ORIGINAL_FDR_RECEIPT",
  "BANK_ACCOUNT_STATEMENT",
  "BANK_REFUND_CONFIRMATION",
  "BANK_ADVICE_LETTER",
  "OTHER_DOCUMENT",
] as const;

export type ReleaseEvidenceTypeKey = (typeof RELEASE_EVIDENCE_TYPES)[number];

export const RELEASE_REQUEST_EVIDENCE_TYPES: readonly ReleaseEvidenceTypeKey[] = [
  "ORIGINAL_FDR_RECEIPT",
  "BANK_ACCOUNT_STATEMENT",
  "OTHER_DOCUMENT",
];

export const RELEASE_COMPLETION_EVIDENCE_TYPES: readonly ReleaseEvidenceTypeKey[] = [
  "BANK_REFUND_CONFIRMATION",
  "BANK_ADVICE_LETTER",
  "OTHER_DOCUMENT",
];
