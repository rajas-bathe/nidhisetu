import type { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "../db/client.js";
import { config } from "../config/env.js";
import { addDays, businessToday, diffInDays, parseLocalDate } from "../utils/dates.js";
import { logger } from "../logger.js";

/**
 * SAMPLE deadline-reminder job.
 *
 * Produces exactly one task per instrument and threshold level, deduplicated
 * by a stable `deduplicationKey` so repeated runs (or accidentally duplicated
 * schedulers) can never create copies. Thresholds come from
 * SAMPLE_REMINDER_THRESHOLDS_DAYS and are SAMPLE DEMONSTRATION CONFIGURATION,
 * not official AICTE rules.
 */
export const JOB_NAME = "deadline-reminders";

export interface DeadlineJobOutcome {
  processed: number;
  created: number;
  skipped: boolean;
}

export interface DeadlineRecordLite {
  id: number;
  publicCode: string;
  institutionId: number;
  maturityDate: Date;
}

/** Key for the threshold-stage reminder of one instrument. */
export function thresholdDeduplicationKey(fdrId: number, thresholdDays: number): string {
  return `DEADLINE_REMINDER:fdr:${fdrId}:t${thresholdDays}`;
}

/** Key for the matured-instrument renewal reminder of one instrument. */
export function maturedDeduplicationKey(fdrId: number): string {
  return `DEADLINE_REMINDER:fdr:${fdrId}:matured`;
}

function thresholdLabel(thresholds: number[], daysToMaturity: number): number | null {
  // The largest threshold already reached by this instrument.
  const reached = thresholds.filter((threshold) => daysToMaturity <= threshold);
  return reached.length > 0 ? (reached[reached.length - 1] ?? null) : null;
}

/**
 * Runs one pass. Pass a Prisma transaction client so the caller's advisory
 * lock (worker.ts) and the guarantees of this run share one database session
 * and one commit unit.
 */
export async function runDeadlineReminderJob(
  db: PrismaTransactionClient,
): Promise<Omit<DeadlineJobOutcome, "skipped">> {
  const startedAt = new Date();
  const today = businessToday();
  const thresholds = config.sampleReminderThresholdsDays;
  const horizonDays = thresholds[thresholds.length - 1] ?? 0;

  let processed = 0;
  let created = 0;

  // Superseded instruments are covered by their replacements and must not
  // produce fresh reminders.
  const rows = await db.fdr.findMany({
    where: {
      supersededByFdrId: null,
      maturityDate: { lte: parseLocalDate(addDays(today, horizonDays)) },
    },
    select: { id: true, publicCode: true, institutionId: true, maturityDate: true },
    orderBy: { maturityDate: "asc" },
  });

  const detailSuffix =
    `SAMPLE reminder policy version "sample-v0.1"; thresholds ${thresholds.join("/")} days. ` +
    "Illustrative configuration for the demo, not an official AICTE regulation.";

  for (const row of rows) {
    processed += 1;
    const maturityDate = row.maturityDate;
    const daysToMaturity = diffInDays(today, toDateOnly(maturityDate));
    const dueDate = maturityDate;

    if (daysToMaturity < 0) {
      created += await ensureReminderTask(db, {
        fdrId: row.id,
        institutionId: row.institutionId,
        deduplicationKey: maturedDeduplicationKey(row.id),
        title: `Security deposit FDR ${row.publicCode} has matured`,
        detail:
          "The instrument passed its maturity date. Decide renewal (new instrument) or release Claim. " +
          detailSuffix,
        dueDate,
      });
      continue;
    }

    const threshold = thresholdLabel(thresholds, daysToMaturity);
    // No threshold stage is crossed yet (e.g. instrument beyond the window).
    if (threshold == null) {
      continue;
    }

    created += await ensureReminderTask(db, {
      fdrId: row.id,
      institutionId: row.institutionId,
      deduplicationKey: thresholdDeduplicationKey(row.id, threshold),
      title: `Security deposit FDR ${row.publicCode} approaches maturity`,
      detail:
        `Matures ${toDateOnly(maturityDate)} (${daysToMaturity} day(s) from ${today}). ` +
        `Stage: ${threshold} days ahead. ` +
        detailSuffix,
      dueDate,
      thresholdDays: threshold,
    });
  }

  const finishedAt = new Date();
  await recordJobRun(db, {
    processed,
    created,
    startedAt,
    finishedAt,
  });

  return { processed, created };
}

async function ensureReminderTask(
  db: PrismaTransactionClient,
  args: {
    fdrId: number;
    institutionId: number | null;
    deduplicationKey: string;
    title: string;
    detail: string;
    dueDate: Date;
    thresholdDays?: number;
  },
): Promise<number> {
  const existing = await db.task.findUnique({
    where: { deduplicationKey: args.deduplicationKey },
    select: { id: true },
  });
  if (existing != null) {
    return 0;
  }

  const data: Prisma.TaskUncheckedCreateInput = {
    fdrId: args.fdrId,
    type: "RENEWAL_AFTER_MATURITY",
    title: args.title,
    detail: args.detail,
    status: "OPEN",
    assigneeInstitutionId: args.institutionId ?? undefined,
    dueDate: args.dueDate,
    deduplicationKey: args.deduplicationKey,
    createdByJob: true,
    policyVersion: "sample-v0.1",
  };

  try {
    await db.task.create({ data });
    return 1;
  } catch (error) {
    // Unique-violation just means a parallel run won the key race - not a failure.
    if ((error as Prisma.PrismaClientKnownRequestError).code === "P2002") {
      logger.warn({ key: args.deduplicationKey }, "deadline_reminder_dedup_race");
      return 0;
    }
    throw error;
  }
}

async function recordJobRun(
  db: PrismaTransactionClient,
  args: { processed: number; created: number; startedAt: Date; finishedAt: Date },
): Promise<void> {
  await db.jobRun.create({
    data: {
      jobName: JOB_NAME,
      status: "OK",
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      processed: args.processed,
      created: args.created,
    },
  });
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
