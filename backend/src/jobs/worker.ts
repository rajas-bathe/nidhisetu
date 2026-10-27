import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../logger.js";
import { JOB_NAME, runDeadlineReminderJob } from "./deadlineReminders.js";

/**
 * Scheduled-deadline worker entry point (no Docker, no extra runtime needed).
 *
 *   npm run worker:once   -> one pass, then exit (use this from OS schedulers)
 *   npm run worker:watch  -> long-running interval scheduler for local dev
 *
 * Duplicate-scheduler protection (local dev must not spawn a second copy):
 * 1. Local file lock (storage/worker.lock, contains the owning pid). A dead
 *    owner is detected by pid and the lock is recovered.
 * 2. PostgreSQL advisory lock held during each run: two concurrent passes
 *    cannot interleave; a second process merely skips that tick. Reminder
 *    rows are additionally deduplicated by a unique deduplicationKey.
 */

const ADVISORY_LOCK_NAME = "fdr-portal-jobs-worker";

/** File-lock lives next to the local storage dir (that tree is git-ignored). */
function workerLockPath(): string {
  return path.join(path.dirname(config.storage.localStorageDir), "worker.lock");
}

interface LockFileEntry {
  pid: number;
  startedAt: string;
}

function acquireLocalLock(): void {
  const lockPath = workerLockPath();
  mkdirSync(path.dirname(lockPath), { recursive: true });

  let handle: number;
  try {
    handle = openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    // Stale-lock recovery: if the recorded pid is not running, reclaim it.
    try {
      const entry = JSON.parse(readFileSync(lockPath, "utf8")) as LockFileEntry;
      if (typeof entry.pid === "number") {
        let alive = true;
        try {
          process.kill(entry.pid, 0);
        } catch (killError) {
          alive = (killError as NodeJS.ErrnoException).code === "EPERM";
        }
        if (!alive) {
          logger.warn({ stalePid: entry.pid, lockPath }, "stale_worker_lock_reclaimed");
          unlinkSync(lockPath);
          handle = openSync(lockPath, "wx");
        } else {
          console.error(
            `Another deadline worker is already running on this machine (pid ${entry.pid}).\n` +
              `Stop it first, or delete the lock file if you are sure it is dead: ${lockPath}`,
          );
          process.exit(3);
        }
      } else {
        throw error;
      }
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code === "EEXIST" || (readError as NodeJS.ErrnoException).code === "ENOENT") {
        unlinkSync(lockPath);
        handle = openSync(lockPath, "wx");
      } else {
        throw error;
      }
    }
  }

  const entry: LockFileEntry = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(handle, JSON.stringify(entry, null, 2), "utf8");
  closeSync(handle);

  const release = (): void => {
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8")) as LockFileEntry;
      if (current.pid === process.pid) {
        unlinkSync(lockPath);
      }
    } catch {
      // Lock disappeared or was never ours; nothing to clean.
    }
  };
  process.on("exit", release);
}

/** Runs one pass inside the advisory lock; `skipped` when another scheduler won. */
async function runLockedOnce(): Promise<void> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const lockRows = (await tx.$queryRaw`SELECT pg_try_advisory_lock(hashtext(${ADVISORY_LOCK_NAME})) AS locked`) as
        Array<{ locked: boolean }>;
      const locked = lockRows[0]?.locked === true;
      if (!locked) {
        return { skipped: true as const };
      }
      try {
        const result = await runDeadlineReminderJob(tx);
        return { skipped: false as const, ...result };
      } finally {
        await tx.$queryRaw`SELECT pg_advisory_unlock(hashtext(${ADVISORY_LOCK_NAME}))`;
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  if (outcome.skipped) {
    logger.warn("deadline_worker_lock_busy - another scheduler holds the advisory lock; this tick is skipped.");
    return;
  }
  logger.info(
    { processed: outcome.processed, created: outcome.created, jobName: JOB_NAME },
    "deadline_worker_run_complete",
  );
}

async function main(): Promise<void> {
  const mode: "once" | "watch" = process.argv.includes("--once") ? "once" : "watch";

  console.log(
    `Deadline worker starting (mode=${mode}, interval=${config.jobIntervalMinutes}min).\n` +
      `Reminder thresholds are SAMPLE configuration: ${config.sampleReminderThresholdsDays.join("/")} days (not an official AICTE rule).`,
  );

  acquireLocalLock();

  if (mode === "once") {
    try {
      await runLockedOnce();
      await prisma.$disconnect();
    } catch (error) {
      logger.error({ err: error }, "deadline_worker_run_failed");
      await prisma.$disconnect().catch(() => undefined);
      process.exitCode = 1;
    }
    return;
  }

  // Watch mode never lets a failed tick kill the scheduler; the guard above
  // keeps several ticks from overlapping even if the DB is momentarily slow.
  const runTick = async (): Promise<void> => {
    try {
      await runLockedOnce();
    } catch (error) {
      logger.error({ err: error }, "deadline_worker_tick_failed");
    }
  };

  await runTick();
  const intervalMs = config.jobIntervalMinutes * 60_000;
  const timer = setInterval(() => {
    void runTick();
  }, intervalMs);

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  logger.error({ err: error }, "deadline_worker_boot_failed");
  process.exitCode = 1;
});
