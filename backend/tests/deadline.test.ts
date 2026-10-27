/**
 * Deadline reminder job tests against a real PostgreSQL instance:
 * - reminder creation at threshold stages with stable deduplication keys
 * - second run creates nothing (idempotent)
 * - superseded instruments are skipped
 * - JobRun records written per run
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { dbDescribe } from "./helpers/guards.js";
import { resetDatabase } from "./helpers/db.js";
import { prisma } from "../src/db/client.js";
import {
  config,
} from "../src/config/env.js";
import {
  JOB_NAME,
  maturedDeduplicationKey,
  runDeadlineReminderJob,
  thresholdDeduplicationKey,
} from "../src/jobs/deadlineReminders.js";
import {
  createFdr,
  createInstitution,
  createUser,
} from "./helpers/scenario.js";

let instId: number;
let collegeId: number;
let thresholds: number[];

beforeEach(async () => {
  await resetDatabase();
  const inst = await createInstitution(31);
  const college = await createUser({ email: `dl-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: inst.id });
  instId = inst.id;
  collegeId = college.id;
  thresholds = config.sampleReminderThresholdsDays;
});

afterEach(async () => {
  await resetDatabase();
});

function fdrArgs(daysToMaturity: number, code: string): Parameters<typeof createFdr>[0] {
  return {
    institutionId: instId,
    publicCode: `DL-${code}-${Date.now()}`,
    maturityInDays: daysToMaturity,
    issueInDays: -400,
    createdById: collegeId,
  };
}

dbDescribe("runDeadlineReminderJob", () => {
  it("creates staged reminders (matured + threshold stages) and none beyond the horizon", async () => {
    const max = thresholds[thresholds.length - 1]!;

    // Cases anchored to the exact sample thresholds.
    const matured = await createFdr(fdrArgs(-20, "M"));
    const atMax = await createFdr(fdrArgs(max, "E")); // boundary: exactly at the largest stage
    const mid = await createFdr(fdrArgs(10, "T")); // assumes a stage >= 10 days
    const beyond = await createFdr(fdrArgs(max + 30, "Z")); // outside the horizon entirely

    const outcome = await runDeadlineReminderJob(prisma);

    // The job creates ONE current-stage task per instrument: matured instruments
    // get the `matured` key; in-window ones get their LARGEST reached threshold.
    expect(outcome.processed).toBe(3); // matured, atMax, mid (beyond is filtered out)
    expect(outcome.created).toBe(3);

    const tasks = await prisma.task.findMany({ orderBy: { deduplicationKey: "asc" } });
    const keys = tasks.map((task) => task.deduplicationKey);

    expect(keys).toContain(maturedDeduplicationKey(matured.id));
    expect(keys).toContain(thresholdDeduplicationKey(atMax.id, max));

    // mid (10 days out): reached stages are those >= 10; the task must carry
    // exactly the LARGEST of them (14 by default), never one per crossed stage.
    const reached = thresholds.filter((t) => t >= 10);
    const midStage = reached[reached.length - 1];
    expect(midStage).toBeTruthy();
    expect(keys).toContain(thresholdDeduplicationKey(mid.id, midStage!));
    for (const stage of reached.filter((t) => t < midStage)) {
      expect(keys).not.toContain(thresholdDeduplicationKey(mid.id, stage));
    }
    // No matured key for instruments that have not matured.
    expect(keys).not.toContain(maturedDeduplicationKey(mid.id));

    // No tasks for the instrument beyond the horizon.
    expect(keys.some((key) => key?.includes(`:${beyond.id}:`))).toBe(false);

    // Reminder tasks belong to the owning institution and carry the SAMPLE label.
    for (const task of tasks) {
      expect(task.assigneeInstitutionId).toBe(instId);
      expect(task.createdByJob).toBe(true);
      expect(task.detail ?? "").toContain("SAMPLE");
      expect(task.type).toBe("RENEWAL_AFTER_MATURITY");
    }
  });

  it("is idempotent: a second run creates no new reminders", async () => {
    await createFdr(fdrArgs(-5, "M2"));
    await createFdr(fdrArgs(7, "T2"));

    const first = await runDeadlineReminderJob(prisma);
    expect(first.created).toBeGreaterThan(0);

    const second = await runDeadlineReminderJob(prisma);
    expect(second.created).toBe(0);
    expect(second.processed).toBe(first.processed);

    const count = await prisma.task.count();
    expect(count).toBe(first.created);
  });

  it("skips superseded instruments entirely", async () => {
    // The NEW instrument is current; the OLD one carries supersededByFdrId
    // pointing at it (set when the replacement is accepted), so the job must
    // forget the OLD matured instrument entirely.
    const replacement = await createFdr(fdrArgs(200, "NEW"));
    const old = await createFdr({ ...fdrArgs(-3, "OLD"), supersededById: replacement.id });

    await runDeadlineReminderJob(prisma);
    const keys = (await prisma.task.findMany()).map((task) => task.deduplicationKey);
    expect(keys).not.toContain(maturedDeduplicationKey(old.id));
    // The replacement itself is far in the future and inside no stage: no tasks.
    expect(keys).not.toContain(maturedDeduplicationKey(replacement.id));
  });

  it("records a JobRun row for every pass", async () => {
    await createFdr(fdrArgs(-1, "M3"));
    await runDeadlineReminderJob(prisma);
    await runDeadlineReminderJob(prisma);

    const runs = await prisma.jobRun.findMany({ where: { jobName: JOB_NAME } });
    expect(runs.length).toBe(2);
    for (const run of runs) {
      expect(run.status).toBe("OK");
      expect(run.processed).toBeGreaterThanOrEqual(1);
    }
  });

  it("handles many instruments without duplicating reminders (dedup stability)", async () => {
    for (let i = 0; i < 12; i += 1) {
      await createFdr(fdrArgs(5 + i, `BULK${i}`));
    }
    const first = await runDeadlineReminderJob(prisma);
    const second = await runDeadlineReminderJob(prisma);
    expect(second.created).toBe(0);
    expect(first.created).toBeGreaterThan(0);
  });
});
