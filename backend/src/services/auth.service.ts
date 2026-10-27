import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { LoginContext, UserRole } from "@sih26265/contracts";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { generateSessionToken, hashSessionToken } from "../utils/crypto.js";
import { logger } from "../logger.js";
import { recordAudit } from "./audit.service";
import { serializeUser } from "../middleware/authenticate";
import { validationError } from "../errors.js";

const BCRYPT_ROUNDS = 12;

/** Hash used to equalise timing when the account does not exist. */
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-placeholder", BCRYPT_ROUNDS);

export const BCRYPT_SALT_ROUNDS = BCRYPT_ROUNDS;

const PASSWORD_SAMPLE_RULES = [
  { key: "length", test: (value: string) => value.length >= 12 },
  { key: "lower", test: (value: string) => /[a-z]/.test(value) },
  { key: "upper", test: (value: string) => /[A-Z]/.test(value) },
  { key: "digit", test: (value: string) => /\d/.test(value) },
  { key: "symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

/** SAMPLE password policy: 12+ chars with lower, upper, digit and symbol. */
export function validatePasswordStrength(value: string): void {
  const failed = PASSWORD_SAMPLE_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.key);
  if (failed.length > 0) {
    throw validationError(
      {
        newPassword: [
          `The new password must be at least 12 characters and include lower-case letters, upper-case letters, digits and symbols.`,
        ],
      },
      "The new password needs attention.",
    );
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Crypto-random temporary password used for provisioning/reset (sample format). */
export function generateTemporaryPassword(): string {
  const base = randomBytes(9).toString("base64url"); // ~12 chars, url-safe
  return `Ts${base}19#Ap`; // ensures the sample complexity rules are met deterministically
}

export interface AuthAttempt {
  email: string;
  password: string;
  context: LoginContext;
  requestIp?: string | null;
  userAgentHeader?: string | null;
  correlationId?: string | null;
}

export type LoginResult =
  | { kind: "ok"; token: string; expiresAt: Date; serialized: ReturnType<typeof serializeUser>; user: { id: number; role: UserRole; institutionId: number | null } }
  | { kind: "invalid_credentials" }
  | { kind: "inactive_account"; userId: number }
  | { kind: "wrong_portal"; userId: number; actualRole: UserRole };

/** True when the login context (portal) matches the account's business role. */
function portalMatchesRole(context: AuthAttempt["context"], role: UserRole): boolean {
  if (role === "COLLEGE_USER") {
    return context === "college";
  }
  if (role === "SYSTEM_ADMIN") {
    // The system-administration entry is dedicated, but admins may also use the
    // staff portal if they only need read coverage.
    return context === "admin" || context === "officer";
  }
  // Reviewing officers and approving authorities share the staff portal.
  return context === "officer";
}

/**
 * Credential verification with DB-backed session issuance.
 *
 * Notes:
 * - Missing accounts run a bcrypt compare against a dummy hash to keep timing flat.
 * - Failed logins are audited (no email content, no tokens).
 * - Sessions store the SHA-256 token hash only.
 */
export async function attemptLogin(attempt: AuthAttempt): Promise<LoginResult> {
  const email = attempt.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      passwordHash: true,
      institutionId: true,
      mustChangePassword: true,
      institution: { select: { id: true, code: true, name: true } },
    },
  });

  if (user == null) {
    await bcrypt.compare(attempt.password, DUMMY_HASH);
    return { kind: "invalid_credentials" };
  }

  const passwordOk = await bcrypt.compare(attempt.password, user.passwordHash);
  if (!passwordOk) {
    return { kind: "invalid_credentials" };
  }

  if (!user.isActive) {
    return { kind: "inactive_account", userId: user.id };
  }

  if (!portalMatchesRole(attempt.context, user.role)) {
    return { kind: "wrong_portal", userId: user.id, actualRole: user.role };
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60_000);

  await prisma.session.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt,
      createdIp: attempt.requestIp ?? undefined,
      userAgent: attempt.userAgentHeader ?? undefined,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "AUTH_LOGIN_SUCCESS",
    actorUserId: user.id,
    institutionId: user.institutionId,
    requestIp: attempt.requestIp ?? null,
    correlationId: attempt.correlationId ?? null,
    detail: { context: attempt.context, role: user.role },
  });

  return {
    kind: "ok",
    token,
    expiresAt,
    serialized: serializeUser(user),
    user: { id: user.id, role: user.role, institutionId: user.institutionId },
  };
}

/** Invalidates a session (idempotent) and audits the logout. */
export async function logoutSession(sessionId: number, userId: number): Promise<void> {
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { invalidatedAt: new Date() },
    });
  } catch (error) {
    logger.warn({ err: error, sessionId }, "logout_update_failed");
  }
  await recordAudit({ action: "AUTH_LOGOUT", actorUserId: userId });
}

/** Invalidates every live session of a user (used on deactivation, resets, pw change). */
export async function revokeAllSessions(userId: number, exceptSessionId?: number): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      invalidatedAt: null,
      ...(exceptSessionId != null ? { id: { not: exceptSessionId } } : {}),
    },
    data: { invalidatedAt: new Date() },
  });
  return result.count;
}

/**
 * Self-service password change. Validates the sample complexity rules, keeps
 * the current session alive, and revokes every other live session. Also
 * clears the forced-change flag for provisioned accounts.
 */
export async function changeOwnPassword(
  userId: number,
  sessionId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, isActive: true },
  });
  if (user == null || !user.isActive) {
    throw new Error("The account is not active.");
  }

  const passwordOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordOk) {
    throw validationError(
      { currentPassword: ["The current password is not correct."] },
      "The current password needs attention.",
    );
  }

  validatePasswordStrength(newPassword);

  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw validationError(
      { newPassword: ["The new password must be different from the current password."] },
      "The new password needs attention.",
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const forced = await wasForced(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
    select: { id: true },
  });

  await revokeAllSessions(userId, sessionId);
  await recordAudit({
    action: "AUTH_PASSWORD_CHANGED",
    actorUserId: userId,
    detail: {
      note: forced ? "temporary password replaced by the account owner" : "password updated by the account owner",
    },
  });
}

async function wasForced(userId: number): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { mustChangePassword: true } });
  return row?.mustChangePassword ?? false;
}
