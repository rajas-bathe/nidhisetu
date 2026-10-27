/**
 * Deterministic readiness evaluation for verification, replacement acceptance
 * and release. Pure functions over recorded state: no randomness, no network,
 * no AI. Every illustrative threshold below is SAMPLE configuration - nothing
 * here claims an official AICTE rule.
 */
import type {
  CheckRecord,
  ReadinessPanel,
  ReadinessItem,
} from "@sih26265/contracts";
import { diffInDays } from "../utils/dates.js";

export const READINESS_POLICY_NOTE =
  "SAMPLE policy evaluation from recorded facts; thresholds are demonstration values, not official rules.";

export type InstitutionStatusFlag = "ACTIVE" | "INACTIVE";

export interface ReadinessCaseState {
  id: number;
  publicCode: string;
  status: "draft" | "submitted" | "under_review" | "discrepancy" | "verified";
  currentVersionNo: number;
  amountMinor: bigint;
  issueDate: string;
  maturityDate: string;
  supersededByFdrId: number | null;
  previousFdrId: number | null;
  institutionStatus: InstitutionStatusFlag;
}

export interface ReadinessDocumentState {
  count: number;
}

export interface ReadinessCheckState {
  currentVersionChecks: CheckRecord[];
}

export interface ReadinessCorrectionState {
  openCorrections: number;
}

export interface ReadinessReleaseState {
  reason: string | null;
  evidenceType: string | null;
  evidenceRef: string | null;
  status: "OPEN" | "DECIDED" | null;
  decision: string | null;
  completedAt: string | null;
}

export interface ReadinessPreviousState {
  id: number;
  publicCode: string;
  maturityDate: string;
  amountMinor: bigint;
  status: string;
  supersededByFdrId: number | null;
}

export interface ReadinessInput {
  today: string;
  case: ReadinessCaseState;
  documents: ReadinessDocumentState;
  checks: ReadinessCheckState;
  corrections: ReadinessCorrectionState;
  release: ReadinessReleaseState | null;
  previous: ReadinessPreviousState | null;
}

function item(
  key: string,
  label: string,
  status: ReadinessItem["status"],
  reason: string,
  options: Partial<Omit<ReadinessItem, "key" | "label" | "status" | "reason">> = {},
): ReadinessItem {
  return {
    key,
    label,
    status,
    reason,
    evidenceRef: options.evidenceRef ?? null,
    responsible: options.responsible ?? "reviewing_officer",
    nextAction: options.nextAction ?? null,
    isBlocker: options.isBlocker ?? false,
    source: options.source ?? "sample_policy",
  };
}

/** Checks for the current version only. Invalidated checks are not evidence. */
function activeChecksFor(checks: readonly CheckRecord[], versionNo: number): CheckRecord[] {
  return checks.filter(
    (check) => check.fdrVersionNo === versionNo && check.invalidatedAt == null,
  );
}

function latestCheckFor(
  checks: readonly CheckRecord[],
  field: string,
): CheckRecord | undefined {
  const candidates = checks.filter((check) => check.field === field);
  return candidates.length === 0 ? undefined : candidates[candidates.length - 1];
}

/**
 * Verification readiness: what the reviewing officer still needs before the
 * case can be marked verified.
 */
export function evaluateVerificationReadiness(input: ReadinessInput): ReadinessPanel {
  const items: ReadinessItem[] = [];
  const versionNo = input.case.currentVersionNo;
  const currentChecks = activeChecksFor(input.checks.currentVersionChecks, versionNo);

  if (input.case.status === "draft") {
    items.push(
      item("submission", "Submitted for review", "pending",
        "The case is still a draft; upload documents and submit it.",
        { responsible: "college", nextAction: "Complete the draft and submit it.", isBlocker: true }),
    );
  } else {
    items.push(
      item("submission", "Submitted for review", "pass",
        "Submitted records are under review.",
        { evidenceRef: `version:${versionNo}`, responsible: "reviewing_officer" }),
    );
  }

  if (input.documents.count > 0) {
    items.push(
      item("documents", "Supporting document attached", "pass",
        `${input.documents.count} document(s) are part of the case.`,
        { evidenceRef: "documents", responsible: "college", source: "document" }),
    );
  } else {
    items.push(
      item("documents", "Supporting document attached", "fail",
        "No supporting document has been uploaded.",
        { responsible: "college", nextAction: "Upload the receipt/statement in the Documents tab.", isBlocker: true }),
    );
  }

  if (input.case.amountMinor > 0n) {
    items.push(
      item("amount", "Deposit amount recorded", "pass",
        "The submitted amount is present in the current version.",
        { evidenceRef: `version:${versionNo}`, responsible: "college", source: "record" }),
    );
  } else {
    items.push(
      item("amount", "Deposit amount recorded", "fail",
        "The deposit amount is missing from the current version.",
        { responsible: "college", nextAction: "Correct the amount through a correction request.", isBlocker: true }),
    );
  }

  // Required evidence checks (SAMPLE). Missing/MISMATCH/SOURCE_UNAVAILABLE outcomes gate verification.
  const requiredBankFields: Array<{ field: string; label: string; source: CheckRecord["source"] }> = [
    { field: "amount", label: "Amount check against the simulated bank response", source: "SIMULATED_BANK_CHECK" },
    { field: "reference_no", label: "Receipt/reference check", source: "MANUAL_OFFICER_REVIEW" },
    { field: "bank_name", label: "Bank & branch check", source: "MANUAL_OFFICER_REVIEW" },
  ];

  for (const required of requiredBankFields) {
    const check = latestCheckFor(currentChecks, required.field);
    if (check != null && check.outcome === "MATCH") {
      items.push(
        item(`check_${required.field}`, required.label, "pass",
          `Recorded check passed (${check.source === "SIMULATED_BANK_CHECK" ? "SIMULATED bank response" : "manual officer review"}).`,
          { evidenceRef: `check:${check.id}`, source: check.source === "SIMULATED_BANK_CHECK" ? "simulated_check" : "check" }),
      );
    } else if (check != null && (check.outcome === "MISMATCH" || check.outcome === "SOURCE_UNAVAILABLE")) {
      items.push(
        item(`check_${required.field}`, required.label, "fail",
          check.outcome === "MISMATCH"
            ? `The recorded check shows a mismatch${check.reason ? `: ${check.reason}` : ""}.`
            : "The source was unavailable when the check was recorded.",
          {
            evidenceRef: `check:${check.id}`,
            nextAction: input.case.status !== "draft" && check.outcome === "MISMATCH"
              ? "Raise a field-specific correction request or resolve the mismatch."
              : "Re-run the check.",
            isBlocker: true,
          },
        ),
      );
    } else {
      items.push(
        item(`check_${required.field}`, required.label, "pending",
          "This required check has not been recorded for the current version.",
          {
            nextAction: `Record the ${required.source === "SIMULATED_BANK_CHECK" ? "SIMULATED bank response check" : "manual check"} in Verification.`,
            isBlocker: true,
          },
        ),
      );
    }
  }

  if (input.corrections.openCorrections > 0) {
    items.push(
      item("corrections", "Outstanding correction requests", "fail",
        `${input.corrections.openCorrections} correction request(s) still await the college's response.`,
        { responsible: "college", nextAction: "Respond to the correction in Corrections & Versions.", isBlocker: true }),
    );
  } else {
    items.push(
      item("corrections", "Outstanding correction requests", "pass",
        "All correction requests have been answered.",
        { responsible: "reviewing_officer" }),
    );
  }

  const finalCheck = latestCheckFor(currentChecks, "instrument_type");
  items.push(
    finalCheck != null
      ? item("instrument_state", "Role check recorded", "pass",
          "Instrument state check present.",
          { evidenceRef: `check:${finalCheck.id}`, source: "check" })
      : item("instrument_state", "Instrument state recorded", "na",
          "Instrument type is recorded with the submission itself.",
          { responsible: "reviewing_officer", source: "record" }),
  );

  return finalize("verification", "Verification readiness", items);
}

/**
 * Replacement acceptance readiness: whether the approving authority may accept
 * the replacement for a submitted replacement instrument (previousFdrId set).
 */
export function evaluateReplacementReadiness(input: ReadinessInput): ReadinessPanel {
  const items: ReadinessItem[] = [];

  if (input.case.status === "verified") {
    items.push(
      item("verified", "Replacement verified", "pass",
        "Reviewing officer completed verification of the replacement.",
        { evidenceRef: `case:${input.case.id}`, source: "record" }),
    );
  } else {
    items.push(
      item("verified", "Replacement verified", "fail",
        "The replacement is not verified yet; acceptance is not possible.",
        { responsible: "reviewing_officer", nextAction: "Finish verification first.", isBlocker: true }),
    );
  }

  if (input.previous == null) {
    items.push(
      item("previous_link", "Linked previous instrument", "na",
        "This case does not replace another instrument; acceptance readiness is not applicable.",
        { responsible: "reviewing_officer" }),
    );
  } else {
    const alreadyReplaced = input.previous.supersededByFdrId != null;
    if (alreadyReplaced) {
      items.push(
        item("previous_link", "Previous instrument not yet replaced", "fail",
          `The previous instrument is already superseded by case #${input.previous.supersededByFdrId}.`,
          { responsible: "approving_authority", nextAction: "Accepting again is not possible.", isBlocker: true }),
      );
    } else {
      items.push(
        item("previous_link", "Previous instrument open for replacement", "pass",
          `Instrument ${input.previous.publicCode} has no accepted replacement yet.`,
          { evidenceRef: `case:${input.previous.id}`, source: "record" }),
      );
    }

    const gap = diffInDays(input.today, input.previous.maturityDate) >= 0
      ? diffInDays(input.previous.maturityDate, input.case.issueDate)
      : 0;
    if (gap <= 0) {
      items.push(
        item("date_gap", "Coverage continuity", "pass",
          "The replacement starts on/before the previous maturity date (no gap).",
          { source: "record" }),
      );
    } else if (gap <= 7) {
      items.push(
        item("date_gap", "Coverage continuity", "pass",
          `A ${gap}-day gap between instruments remains within the sample tolerance.`,
          { source: "record" }),
      );
    } else {
      items.push(
        item("date_gap", "Coverage continuity", "pending",
          `A ${gap}-day coverage gap is a potential policy risk, not a proven violation.`,
          {
            nextAction: "Have the officer note the gap reason in the recommendation.",
            isBlocker: false,
          },
        ),
      );
    }

    if (input.case.amountMinor >= input.previous.amountMinor) {
      items.push(
        item("amount_cover", "Amount coverage", "pass",
          "The replacement amount covers the previous instrument's amount.",
          { source: "record" }),
      );
    } else {
      items.push(
        item("amount_cover", "Amount coverage", "pending",
          "The replacement amount is lower than the previous instrument's amount.",
          { nextAction: "Note the reduced amount justification in the recommendation.", isBlocker: false }),
      );
    }
  }

  return finalize("replacement_acceptance", "Acceptance readiness", items);
}

/**
 * Release readiness for an instrument: whether a release request may proceed
 * through recommendation, decision and completion.
 */
export function evaluateReleaseReadiness(input: ReadinessInput): ReadinessPanel {
  const items: ReadinessItem[] = [];

  if (input.case.status === "verified") {
    items.push(
      item("verified", "Instrument verified", "pass",
        "The instrument has completed review.",
        { evidenceRef: `case:${input.case.id}`, source: "record" }),
    );
  } else {
    items.push(
      item("verified", "Instrument verified", "fail",
        "Only verified instruments can be released.",
        { responsible: "reviewing_officer", nextAction: "Complete verification first.", isBlocker: true }),
    );
  }

  if (input.case.supersededByFdrId != null) {
    items.push(
      item("superseded", "Instrument not superseded", "fail",
        "An accepted replacement already covers this instrument; release is not applicable.",
        { responsible: "approving_authority", isBlocker: true }),
    );
  } else {
    items.push(
      item("superseded", "Instrument not superseded", "pass",
        "No accepted replacement covers this instrument yet.",
        { source: "record" }),
    );
  }

  const release = input.release;
  if (release == null || release.status === "DECIDED") {
    if (release != null && release.status === "DECIDED" && release.completedAt != null) {
      items.push(
        item("request", "Release request stage", "pass", "The release has completed evidence recorded.",
          { responsible: "college", source: "record" }),
      );
    } else if (release != null && release.status === "DECIDED" && release.decision === "approved") {
      items.push(
        item("request", "Release request stage", "pending",
          "The release is approved but completion evidence is still missing.",
          { responsible: "reviewing_officer", nextAction: "Record the completion evidence.", isBlocker: false }),
      );
    } else {
      items.push(
        item("request", "Release request stage", "pending",
          release == null ? "No release request has been created yet." : "The last release request was rejected; a new request can be made.",
          { responsible: "college", nextAction: release == null ? "Submit a release request with reason and evidence." : "Submit a new release request if still needed.", isBlocker: false }),
      );
    }
  } else if (!release.reason || release.reason.length < 10) {
    items.push(
      item("request", "Release request stage", "fail", "The requested release has no proper reason recorded.", { isBlocker: true }),
    );
  } else {
    items.push(
      item("request", "Release request stage", "pass",
        "The release request includes a reason.",
        { responsible: "college", source: "record" }),
    );
    if (release.evidenceType == null || release.evidenceType.length === 0) {
      items.push(
        item("request_evidence", "Request evidence category", "fail",
          "The release request has no evidence category recorded.",
          { responsible: "college", nextAction: "Update the request evidence (a correction re-evaluates readiness).", isBlocker: true }),
      );
    } else {
      items.push(
        item("request_evidence", "Request evidence category", "pass",
          "The request evidence category is recorded.",
          { evidenceRef: release.evidenceType, responsible: "college", source: "document" }),
      );
    }
  }

  return finalize("release", "Release readiness", items);
}

/** Computes blockers, score and policy note. Blockers always beat the score. */
function finalize(
  context: ReadinessPanel["context"],
  headline: string,
  items: ReadinessItem[],
): ReadinessPanel {
  const blockers = items
    .filter((entry) => entry.isBlocker && (entry.status === "fail" || entry.status === "pending"))
    .map((entry) => `${entry.label}: ${entry.reason}`);
  const eligible = items.filter((entry) => entry.status !== "na");
  const passed = eligible.filter((entry) => entry.status === "pass").length;
  const scorePercent =
    blockers.length > 0 || eligible.length === 0
      ? null
      : Math.round((passed / eligible.length) * 100);
  return {
    context,
    headline,
    items,
    blockers,
    scorePercent,
    policyNote: READINESS_POLICY_NOTE,
    generatedAt: new Date().toISOString(),
    generatedFrom: "deterministic_sample_rules",
  };
}
