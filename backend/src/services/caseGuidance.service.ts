/**
 * "Explain this case" guidance.
 *
 * The portal works entirely without external AI: the default derives a
 * deterministic, rule-based explanation from the recorded case facts, so the
 * behaviour is reproducible and offline-safe. If a DEEPSEEK_API_KEY is present
 * the request could be served by the model instead; that integration is
 * intentionally deferred and the fallback below is the shipped behaviour
 * (clearly labelled, never presented as official advice).
 */
import type { NextAction, ReadinessItem } from "@sih26265/contracts";
import { minorUnitsToRupeesLabel } from "../utils/money.js";

export interface CaseGuidanceFacts {
  publicCode: string;
  instrumentType: string;
  status: string;
  dateCondition: string;
  daysToMaturity: number;
  amountLabel: string;
  bankName: string;
  releaseStatus: string;
  openCorrections: number;
  openChecks: number;
  superseded: boolean;
  previousPublicCode: string | null;
  nextAction: NextAction | null;
  readinessBlockers: string[];
  readinessItems: ReadinessItem[];
}

export interface CaseGuidanceResult {
  /** Machine flag for the UI label. */
  origin: "sample_guidance";
  headline: string;
  bullets: string[];
  disclaimer: string;
}

export const GUIDANCE_DISCLAIMER =
  "Guidance is generated from recorded case facts using SAMPLE rules for demonstration only; it is not legal or regulatory advice.";

/** Deterministic "Case guidance" — no external service, no randomness. */
export function buildCaseGuidance(facts: CaseGuidanceFacts): CaseGuidanceResult {
  const bullets: string[] = [];

  bullets.push(
    `${facts.publicCode} is a ${describeInstrument(facts.instrumentType)} from ${facts.bankName} for ${facts.amountLabel}.`,
  );

  bullets.push(
    facts.dateCondition === "matured"
      ? `The instrument matured ${Math.abs(facts.daysToMaturity)} day(s) ago and is currently in the "${describeStatus(facts.status)}" stage.`
      : facts.dateCondition === "approaching_maturity"
        ? `Maturity is ${facts.daysToMaturity} day(s) away and the case is in the "${describeStatus(facts.status)}" stage.`
        : `Maturity is still ${facts.daysToMaturity} day(s) away; the case is in the "${describeStatus(facts.status)}" stage.`,
  );

  if (facts.superseded) {
    bullets.push("An accepted replacement already supersedes this instrument; it is kept for history only.");
  } else if (facts.previousPublicCode != null) {
    bullets.push(`This case replaces instrument ${facts.previousPublicCode} as its renewal.`);
  }

  if (facts.openCorrections > 0) {
    bullets.push(
      `The college still owes a response to ${facts.openCorrections} correction request(s) before review can complete.`,
    );
  }

  if (facts.openChecks > 0) {
    bullets.push(
      `${facts.openChecks} required evidence check(s) for the current version are missing — the reviewing officer must record them in the Verification tab.`,
    );
  }

  if (facts.readinessBlockers.length > 0) {
    bullets.push(`Readiness blockers: ${facts.readinessBlockers.join(" | ")}`);
  } else if (facts.readinessItems.length > 0) {
    const passed = facts.readinessItems.filter((item) => item.status === "pass").length;
    bullets.push(
      `All sample readiness requirements that can be evaluated so far are met (${passed} of ${facts.readinessItems.length} checks passed).`,
    );
  }

  if (facts.nextAction != null && facts.nextAction.action.length > 0) {
    bullets.push(`Next step (${facts.nextAction.responsible}): ${facts.nextAction.action}.`);
  }

  switch (facts.releaseStatus) {
    case "requested":
      bullets.push("A release request is open and waits for the reviewing officer's recommendation.");
      break;
    case "recommended":
      bullets.push("The release is recommended and waits for the approving authority's decision.");
      break;
    case "approved":
      bullets.push("The release is approved; completion evidence still has to be recorded.");
      break;
    case "completed":
      bullets.push("The release has completion evidence recorded and is closed.");
      break;
    case "rejected":
      bullets.push("The latest release request was rejected; see the Release History tab for the recorded reason.");
      break;
    default:
      bullets.push("No release request has been raised for this instrument.");
  }

  return {
    origin: "sample_guidance",
    headline: `Case guidance for ${facts.publicCode}`,
    bullets,
    disclaimer: GUIDANCE_DISCLAIMER,
  };
}

function describeInstrument(instrumentType: string): string {
  return instrumentType === "BANK_GUARANTEE" ? "bank guarantee" : "security deposit (FDR)";
}

function describeStatus(status: string): string {
  switch (status) {
    case "draft":
      return "draft (not submitted)";
    case "submitted":
      return "submitted, waiting for review";
    case "under_review":
      return "in review";
    case "discrepancy":
      return "in review with open discrepancies";
    case "verified":
      return "verified";
    default:
      return status;
  }
}

export function amountLabelFrom(amountMinor: bigint): string {
  return minorUnitsToRupeesLabel(amountMinor);
}
