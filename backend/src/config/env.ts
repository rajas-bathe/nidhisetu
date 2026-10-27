import "dotenv/config";
import path from "node:path";
import { z } from "zod";
/**
 * Environment configuration. Fails fast at boot with a clear message instead of
 * crashing later on a missing credential. Only development/test defaults are
 * baked in here; production fills everything explicitly.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (a PostgreSQL connection string)"),

  PORT: z.coerce.number().int().positive().default(4000),

  /** Browser origins allowed to issue mutating requests (CSRF/origin guard). */
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173"),

  COOKIE_SECURE: booleanish(false),
  SESSION_COOKIE_NAME: z.string().min(1).default("fdr_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),

  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),

  /** Business timezone used to derive "today" as a calendar date. */
  BUSINESS_TIMEZONE: z.string().default("Asia/Kolkata"),

  /** SAMPLE policy value (not an official regulation). */
  SAMPLE_APPROACHING_MATURITY_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /**
   * Document storage. "local" keeps files in a private, git-ignored directory
   * (development / stage deployments without bucket credentials). "s3" uses any
   * S3-compatible object store; requires the S3_* settings below.
   */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),

  /**
   * Directory for STORAGE_DRIVER=local. Empty => "<repo>/storage/local-dev".
   * Relative paths resolve against the repository root. The directory stays
   * outside the frontend bundle and is excluded from version control.
   */
  LOCAL_STORAGE_DIR: z.string().default(""),

  /** Upload size limit in megabytes. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(10),

  S3_REGION: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  /** Custom endpoint for S3-compatible providers (MinIO/R2/Wasabi...). */
  S3_ENDPOINT: z.string().default(""),
  /** Required for most non-AWS providers. */
  S3_FORCE_PATH_STYLE: booleanish(true),

  /**
   * SAMPLE reminder thresholds in days before maturity for which the worker
   * creates deduplicated tasks. Not derived from official AICTE rules.
   */
  SAMPLE_REMINDER_THRESHOLDS_DAYS: z
    .string()
    .default("30,14,7")
    .transform((value) => configAndValidateThresholds(value)),
  /** Worker cadence in minutes (watch mode) / recommended cron spacing. */
  JOB_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_PRETTY: booleanish(false),
});

/**
 * Boolean env parser that treats "false"/"0"/"no"/"off" as FALSE. (z.coerce
 * would turn the string "false" into true and silently break development
 * behaviour such as COOKIE_SECURE="false".)
 */
function booleanish(defaultValue: boolean) {
  return z.union([z.string(), z.boolean(), z.undefined()]).superRefine((value, ctx) => {
    if (typeof value === "boolean" || value == null) {
      return true;
    }
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "false", "0", "no", "off", ""].includes(lowered)) {
      return true;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected a boolean ("true"/"false"), got ${JSON.stringify(value)}`,
    });
    return z.NEVER;
  }).transform((value) => {
    if (value == null || (typeof value === "string" && value.trim().length === 0)) {
      return defaultValue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    const lowered = value.trim().toLowerCase();
    return ["true", "1", "yes", "on"].includes(lowered);
  });
}

function configAndValidateThresholds(value: string): number[] {
  const parsed = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365);
  if (parsed.length === 0) {
    throw new Error("SAMPLE_REMINDER_THRESHOLDS_DAYS must contain at least one day threshold (0-365).");
  }
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

/** Resolves the default local storage directory: "<repo root>/storage/local-dev". */
function defaultLocalStorageDir(): string {
  // src/config/env.ts (ts-run via tsx) and dist/config/env.js (build) both sit
  // exactly three levels below the repository root.
  return path.resolve(__dirname, "..", "..", "..", "storage", "local-dev");
}

// The seed script refuses to run in production (see prisma/seed.ts); no
// production-secret here - production configuration comes from the host.
const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration -> ${issues}`);
}

const raw = parsed.data;

const localStorageDir = raw.LOCAL_STORAGE_DIR
  ? path.resolve(raw.LOCAL_STORAGE_DIR)
  : defaultLocalStorageDir();

// Guarantee uploaded files can never ship through the frontend build.
const normalisedDir = path.normalize(localStorageDir).toLowerCase();
if (normalisedDir.includes(`${path.sep}frontend${path.sep}public`)) {
  throw new Error(
    `LOCAL_STORAGE_DIR must not live inside frontend/public (got ${localStorageDir}). Uploaded documents would become publicly downloadable through the dev server.`,
  );
}

const config = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === "production",
  isTest: raw.NODE_ENV === "test",
  databaseUrl: raw.DATABASE_URL,
  port: raw.PORT,
  allowedOrigins: raw.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  cookieSecure: raw.COOKIE_SECURE,
  sessionCookieName: raw.SESSION_COOKIE_NAME,
  sessionTtlDays: raw.SESSION_TTL_DAYS,
  loginRateLimit: {
    windowMs: raw.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    maxAttempts: raw.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  },
  businessTimezone: raw.BUSINESS_TIMEZONE,
  sampleApproachingMaturityDays: raw.SAMPLE_APPROACHING_MATURITY_DAYS,
  storage: {
    driver: raw.STORAGE_DRIVER,
    localStorageDir,
    maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
    maxUploadMb: raw.MAX_UPLOAD_MB,
    s3: {
      region: raw.S3_REGION,
      bucket: raw.S3_BUCKET,
      accessKeyId: raw.S3_ACCESS_KEY_ID,
      secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
      endpoint: raw.S3_ENDPOINT,
      forcePathStyle: raw.S3_FORCE_PATH_STYLE,
    },
  },
  /** SAMPLE thresholds - demo configuration, not official regulation. */
  sampleReminderThresholdsDays: raw.SAMPLE_REMINDER_THRESHOLDS_DAYS,
  jobIntervalMinutes: raw.JOB_INTERVAL_MINUTES,
  logLevel: raw.LOG_LEVEL,
  logPretty: raw.LOG_PRETTY,
} as const;

export type AppConfig = typeof config;

export { config };
