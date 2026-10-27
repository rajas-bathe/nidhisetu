import bcrypt from "bcryptjs";
import type { UserRole } from "@sih26265/contracts";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { generateSessionToken, hashSessionToken } from "../utils/crypto.js";
import { logger } from "../logger.js";
import { recordAudit } from "./audit.service";
import { serializeUser } from "../middleware/authenticate";

const BCRYPT_ROUNDS = 12;

/** Hash used to equalise timing when the account does not exist. */
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-placeholder", BCRYPT_ROUNDS);

export const BCRYPT_SALT_ROUNDS = BCRYPT_ROUNDS;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export interface AuthAttempt {
  email: string;
  password: string;
  context: "college" | "officer";
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
  const roleClass = role === "COLLEGE_USER" ? "college" : "officer";
  return roleClass === context;
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
