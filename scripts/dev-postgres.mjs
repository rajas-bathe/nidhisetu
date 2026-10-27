/**
 * Local development PostgreSQL without Docker.
 *
 * Runs a bundled PostgreSQL 17 binary (via embedded-postgres +
 * @embedded-postgres/windows-x64) with EXACTLY the same credentials and port
 * as docker-compose.yml used, so backend/.env keeps working unchanged:
 *
 *   postgresql://fdr_portal:fdr_dev_password@localhost:5433/fdr_portal
 *   test database: fdr_portal_test
 *
 * Data lives in <repo>/storage/local-postgres (git-ignored). The cluster is
 * persistent across runs. Press Ctrl+C to stop the server.
 *
 * This is a LOCAL DEVELOPMENT database only - never point production URLs of
 * any kind at it, and never run this with real data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const dataDir = path.join(repoRoot, "storage", "local-postgres", "data");

dotenv.config({ path: path.join(backendDir, ".env"), override: false });

const DEFAULTS = {
  user: "fdr_portal",
  password: "fdr_dev_password",
  port: 5433,
  database: "fdr_portal",
  testDatabase: "fdr_portal_test",
};

// Credentials come from backend/.env DATABASE_URL when present and parseable,
// so the runner and the backend can never drift apart silently.
function connectionDefaultsFromEnv(databaseUrl) {
  const defaults = { ...DEFAULTS };
  try {
    if (databaseUrl) {
      const url = new URL(databaseUrl);
      if (url.username) defaults.user = decodeURIComponent(url.username);
      if (url.password) defaults.password = decodeURIComponent(url.password);
      if (url.port) defaults.port = Number(url.port) || defaults.port;
    }
  } catch {
    // Keep defaults; instructions below tell the user how to align their .env.
  }
  return defaults;
}

const settings = connectionDefaultsFromEnv(process.env.DATABASE_URL);

let EmbeddedPostgres;
try {
  EmbeddedPostgres = (await import("embedded-postgres")).default;
} catch (error) {
  console.error([
    "Could not load 'embedded-postgres'.",
    "Install the local database runtime once:",
    "  npm i -D embedded-postgres@17.10.0-beta.17 @embedded-postgres/windows-x64@17.10.0-beta.17",
    "  npm approve-scripts embedded-postgres @embedded-postgres/windows-x64",
    String(error),
  ].join("\n"));
  process.exit(1);
}

function localUrl(database) {
  return `postgresql://${encodeURIComponent(settings.user)}:${encodeURIComponent(settings.password)}@localhost:${settings.port}/${database}?schema=public`;
}

async function ensureDatabases(pgInstance) {
  const names = [settings.database, settings.testDatabase];
  const client = pgInstance.getPgClient("postgres");
  try {
    await client.connect();
    for (const name of names) {
      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        throw new Error(`Unsafe database name: ${JSON.stringify(name)}`);
      }
      const existing = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
      if (existing.rowCount === 0) {
        console.log(`Creating database "${name}"...`);
        await pgInstance.createDatabase(name);
      } else {
        console.log(`Database "${name}" already exists.`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: settings.user,
  password: settings.password,
  port: settings.port,
  persistent: true,
});

const firstRun = !fs.existsSync(dataDir);

async function main() {
  console.log([
    "",
    "=== SIH26265 local development PostgreSQL (no Docker) ===",
    `data dir:   ${dataDir}`,
    `database:   ${localUrl(settings.database)}`,
    `test db:    ${settings.testDatabase}`,
    "keep this window running; press Ctrl+C to stop.",
    "",
  ].join("\n"));

  if (firstRun) {
    console.log("First run: initialising a fresh cluster...");
    await pg.initialise();
    console.log("Cluster initialised.");
  } else {
    console.log("Existing cluster found - starting it.");
  }

  await pg.start();
  console.log("PostgreSQL is up on port " + settings.port + ".");

  await ensureDatabases(pg);

  console.log("\nNext steps (new terminal windows):");
  console.log("  npm run db:apply            # apply migrations to the dev database");
  console.log("  npm run db:seed -- --yes    # optional demo data (explicit opt-in)");
  console.log("  npm run dev                 # run backend (4000) + frontend (5173)");
  console.log("  npm run test                # runs tests against the TEST database");
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received: stopping PostgreSQL...`);
  try {
    await pg.stop();
    console.log("Stopped cleanly.");
    process.exit(0);
  } catch (error) {
    console.error("Stop failed (server may already be dead):", error);
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGBREAK", () => void shutdown("SIGBREAK"));

main().catch(async (error) => {
  console.error("Local database failed to start:", error);
  console.error([
    "",
    "Troubleshooting:",
    `- If the port is busy (${settings.port}), nothing else may run PostgreSQL there (check docker backgrounds first).`,
    "- If the data dir is corrupt you may delete it and retry (LOCAL DEV DATA ONLY):",
    `      Remove-Item -Recurse -Force "${path.join(repoRoot, "storage", "local-postgres")}"`,
    "- backend/.env DATABASE_URL must point at localhost:" + settings.port + ` and user/password must match.`,
    "",
  ].join("\n"));
  try {
    await pg.stop();
  } catch {
    /* already down */
  }
  process.exit(1);
});
