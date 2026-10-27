/** Truncates every table between tests so scenarios stay independent. */
import { prisma } from "../../src/db/client.js";

// db.ts is also the single import point for the shared client in test fixtures.
export { prisma };
import { DB_TESTS_ENABLED, assertIsTestDatabase, assertTestUrlDiffersFromDev } from "./guards.js";

// Belt-and-braces refusals (setup-env already validates):
assertIsTestDatabase(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
assertTestUrlDiffersFromDev(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "");

export async function resetDatabase(): Promise<void> {
  if (!DB_TESTS_ENABLED) {
    throw new Error("resetDatabase() called while the test database is unavailable (suites should be skipped).");
  }
  await prisma.releaseRequest.deleteMany();
  await prisma.verificationCheck.deleteMany();
  await prisma.fdrVersion.deleteMany();
  await prisma.document.deleteMany();
  await prisma.task.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.fdr.deleteMany();
  await prisma.session.deleteMany();
  await prisma.officerJurisdiction.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.user.deleteMany();
  await prisma.institution.deleteMany();
  await prisma.policyVersion.deleteMany();
}
