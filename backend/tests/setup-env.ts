/**
 * Test environment bootstrap. Runs before every test module (vitest setupFiles)
 * so that config/env.ts validation sees the test database.
 *
 * Docker-free safety model:
 * - Requires TEST_DATABASE_URL (a DEDICATED test database, never the dev one).
 * - Guards the URL: name must contain "test" and differ from DATABASE_URL.
 * - When no test database is configured, uses placeholders and marks the
 *   session TEST_DB_REACHABLE=false; DB-dependent suites then skip while pure
 *   unit tests still run and report the skipped suites honestly.
 */
import "dotenv/config";
import path from "node:path";

process.env.NODE_ENV = "test";

const backendDir = path.resolve(__dirname, "..");

function databaseName(url: string): string | null {
  try {
    return url
      ? new URL(url).pathname.replace(/^\//, "").split("/")[0] || null
      : null;
  } catch {
    return null;
  }
}

const devUrl = process.env.DATABASE_URL ?? "";
let chosenUrl = process.env.TEST_DATABASE_URL ?? "";
if (chosenUrl.length === 0 && process.env.TEST_USES_DATABASE_URL === "true") {
  chosenUrl = devUrl;
}

if (chosenUrl.length > 0) {
  const name = databaseName(chosenUrl);
  if (name == null || !name.toLowerCase().includes("test")) {
    throw new Error(
      `TEST_DATABASE_URL must point at a dedicated test database whose name contains "test" (got "${name ?? "none"}"). ` +
        "Tests truncate every table; they must never run against the development or production database.",
    );
  }
  if (devUrl.length > 0 && databaseName(chosenUrl)?.toLowerCase() === databaseName(devUrl)?.toLowerCase()) {
    throw new Error(
      "TEST_DATABASE_URL and DATABASE_URL must be different databases (tests truncate the test database).",
    );
  }
  // Keep the ORIGINAL dev URL for later belt-and-braces guards (helpers/guards.ts)
  // - DATABASE_URL below is intentionally replaced with the test database.
  process.env.DEV_DATABASE_URL_ORIGINAL = devUrl;
  process.env.DATABASE_URL = chosenUrl;
} else {
  // No dedicated test database available: placeholders keep module loading
  // quiet; suites guarded by DB_TESTS_ENABLED skip themselves.
  process.env.DATABASE_URL ??= "postgresql://unconfigured:unconfigured@localhost:5432/unconfigured_test";
  process.env.TEST_DB_REACHABLE = "false";
}

// Faster login rate limiting behaviour is covered by dedicated tests with their own config.
process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES = String(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES ?? "10");
process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = String(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS ?? "8");

// Local storage for tests: a scratch directory inside the backend tests area,
// outside frontend/public and outside committed source (backend/.gitignore covers tests/.test-storage).
// IMPORTANT: forced assignment (not ??=) - backend/.env legitimately sets these
// values and tests must never read/write the development storage area.
process.env.LOCAL_STORAGE_DIR = path.join(backendDir, "tests", ".test-storage");

// Tighter upload limit so the size-refusal path of the document suite can be
// exercised with small fixtures (force; the production default is 10 MB).
process.env.MAX_UPLOAD_MB = "1";
