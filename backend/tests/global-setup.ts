/**
 * Global test setup: applies committed migrations to the TEST database with a
 * real PostgreSQL instance, then records reachability in a marker file.
 *
 * Docker-free: needs any reachable PostgreSQL with a database whose name
 * contains "test" (scripts/dev-postgres.mjs creates both locally, or supply
 * a hosted test database via TEST_DATABASE_URL).
 *
 * Missing/unreachable database is NOT fatal: the marker tells DB-dependent
 * suites to skip while pure tests keep running - and the summary says the
 * database-dependent tests were NOT RUN (never simulated).
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const backendDir = path.resolve(__dirname, "..");
loadEnv({ path: path.join(backendDir, ".env"), override: false });

process.env.NODE_ENV = "test";

function databaseName(url: string): string | null {
  try {
    return url ? new URL(url).pathname.replace(/^\//, "").split("/")[0] || null : null;
  } catch {
    return null;
  }
}

const devUrl = process.env.DATABASE_URL ?? "";
let testUrl = process.env.TEST_DATABASE_URL ?? "";
if (testUrl.length === 0 && process.env.TEST_USES_DATABASE_URL === "true") {
  testUrl = devUrl;
}

const markerPath = path.join(backendDir, "tests", ".db-status.json");

function writeMarker(reachable: boolean, detail?: string): void {
  try {
    writeFileSync(markerPath, JSON.stringify({ reachable, ...(detail ? { detail } : {}) }, null, 2), "utf8");
  } catch {
    // Ignore marker write failures (read-only checkouts still run pure tests).
  }
}

export async function setup(): Promise<void> {
  if (testUrl.length === 0) {
    process.stderr.write(
      "[global-setup] TEST_DATABASE_URL is not configured - DB-dependent tests will be skipped " +
        "(pure tests still run; database behaviour is NOT simulated nor verified).\n",
    );
    writeMarker(false, "TEST_DATABASE_URL not configured");
    return;
  }

  const name = databaseName(testUrl);
  if (name == null || !name.toLowerCase().includes("test")) {
    writeMarker(false, "TEST_DATABASE_URL does not point at a dedicated test database");
    throw new Error(
      `globalSetup: TEST_DATABASE_URL must reference a "test" database (got "${name ?? "none"}") - protecting the development database from test truncation.`,
    );
  }
  if (
    devUrl.length > 0 &&
    databaseName(devUrl) != null &&
    databaseName(devUrl)?.toLowerCase() === name.toLowerCase()
  ) {
    writeMarker(false, "TEST_DATABASE_URL equals DATABASE_URL");
    throw new Error("globalSetup: TEST_DATABASE_URL and DATABASE_URL must not share a database.");
  }

  const env = { ...process.env, DATABASE_URL: testUrl };
  process.stderr.write("[global-setup] applying migrations to the test database...\n");
  try {
    execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
      cwd: backendDir,
      env,
      stdio: "inherit",
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      timeout: 120_000,
    });
    writeMarker(true);
    process.stderr.write("[global-setup] test database ready.\n");
  } catch (error) {
    process.stderr.write(String(error));
    process.stderr.write(
      "[global-setup] test database unreachable or migration failed - DB-dependent tests will be SKIPPED " +
        "(they are NOT replaced by mocks). Start a test PostgreSQL (scripts/dev-postgres.mjs) and retry.\n",
    );
    writeMarker(false, "migrate deploy failed or database unreachable");
  }
}
