/**
 * Database reset guard. Refuses to operate against non-local databases unless
 * SEED_ALLOW_PRODUCTION=true is explicitly set (still discouraged; never runs
 * automatically on application start).
 */
import { spawnSync } from "node:child_process";
import { config as dotenv } from "dotenv";

dotenv.config();

const url = process.env.DATABASE_URL ?? "";
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.SEED_ALLOW_PRODUCTION === "true";

const isLocal = /@localhost[:/]|@127\.0\.0\.1[:/]|@host\.docker\.internal[:/]|\bfdr_portal:/.test(url);

if (isProduction && !isLocal && process.env.RESET_ALLOW_NON_LOCAL !== "true") {
  console.error(
    "REFUSED: db:reset targets a non-local database. Set RESET_ALLOW_NON_LOCAL=true if you really mean it.",
  );
  process.exit(1);
}

if (url === "") {
  console.error("DATABASE_URL missing.");
  process.exit(1);
}

const args = process.argv.slice(2).includes("--seed") ? ["migrate", "reset", "--force"] : ["migrate", "reset", "--force", "--skip-seed"];

const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 0);
