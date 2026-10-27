/**
 * Database-availability + safety helpers for the test suite.
 *
 * The globalSetup writes a marker file when the dedicated test PostgreSQL
 * instance is reachable and migrated. DB-dependent suites read DB_TESTS_ENABLED
 * and skip cleanly when no test database exists - the pure unit tests
 * (backend/src/rules) always run.
 *
 * Safety invariants enforced here:
 * - The test suite may only truncate a database whose name contains "test".
 * - TEST_DATABASE_URL must differ from DATABASE_URL (the development database)
 *   so the normal development data can never be cleared by tests.
 */
import { describe } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Reads the db name from a postgres:// URL ("fdr_portal_test" etc.). */
export function testDatabaseName(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\//, "");
    const name = pathname.split("/")[0] ?? "";
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function markerPath(): string {
  return path.resolve(__dirname, "..", ".db-status.json");
}

interface DbStatusMarker {
  reachable: boolean;
  detail?: string;
}

/**
 * Decided by globalSetup (which applies migrations). Missing marker => treat
 * the test database as unavailable (e.g. someone ran a single test file).
 */
export function readDbStatus(): DbStatusMarker {
  try {
    const marker = JSON.parse(readFileSync(markerPath(), "utf8")) as DbStatusMarker;
    return { reachable: marker.reachable === true, detail: marker.detail };
  } catch {
    return { reachable: false, detail: "marker file missing (globalSetup did not run)" };
  }
}

const status = readDbStatus();

/** Whether DB-integration suites may run in this session. */
export const DB_TESTS_ENABLED = status.reachable;

/** describe() that skips cleanly when no dedicated test database is available. */
export const dbDescribe = DB_TESTS_ENABLED ? describe : describe.skip;

/** Human-readable reason for the current skip decision (for diagnostics). */
export function explainDbSkip(): string {
  if (DB_TESTS_ENABLED) {
    return "database available";
  }
  return `database-dependent tests NOT RUN: ${status.detail ?? "test database unavailable"}`;
}

/** Refuses URLs that do not point at a dedicated test database. */
export function assertIsTestDatabase(url: string): void {
  const name = testDatabaseName(url);
  if (name == null || !name.toLowerCase().includes("test")) {
    throw new Error(
      `TEST_DATABASE_URL must point at a dedicated test database whose name contains "test" (got ${name ?? "none"}). ` +
        "Never point test truncation at the development or production database.",
    );
  }
}

/** The development database must not be the test target. */
export function assertTestUrlDiffersFromDev(testUrl: string): void {
  // The ORIGINAL dev URL (stashed by setup-env before DATABASE_URL was
  // replaced with the test database) is the only correct comparison partner.
  const devUrl = process.env.DEV_DATABASE_URL_ORIGINAL ?? "";
  if (devUrl.length === 0) {
    return; // No dev database known this session (e.g. tests-only environment).
  }
  const testName = testDatabaseName(testUrl);
  const devName = testDatabaseName(devUrl);
  if (testName != null && devName != null && testName.toLowerCase() === devName.toLowerCase()) {
    throw new Error(
      `TEST_DATABASE_URL and the development DATABASE_URL point at the same database ("${testName}"). Tests truncate every table - they must never run against the development database.`,
    );
  }
  if (testUrl === devUrl) {
    throw new Error("TEST_DATABASE_URL must not be identical to DATABASE_URL.");
  }
}

export { status };
