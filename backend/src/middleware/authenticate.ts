import type { NextFunction, Request, Response } from "express";
import { InstitutionRefSchema, UserRole, type CurrentUser } from "@sih26265/contracts";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { unauthorized } from "../errors.js";
import { hashSessionToken } from "../utils/crypto.js";

export interface AuthenticatedUser {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  institutionId: number | null;
  institution: { id: number; code: string; name: string } | null;
  mustChangePassword: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: { user: AuthenticatedUser; sessionId: number };
  }
}

export function serializeUser(user: {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  institutionId: number | null;
  institution?: { id: number; code: string; name: string } | null;
  mustChangePassword?: boolean | null;
}): CurrentUser {
  const institution =
    user.institution != null
      ? InstitutionRefSchema.parse({
          id: user.institution.id,
          code: user.institution.code,
          name: user.institution.name,
        })
      : null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    institution,
    mustChangePassword: Boolean(user.mustChangePassword ?? false),
  };
}

/**
 * Session validation. The cookie carries an opaque token; only its SHA-256
 * hash is stored. Expired, invalidated or no-longer-active sessions are all
 * rejected with 401 so the UI can redirect to the login screen.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[config.sessionCookieName];
    if (typeof token !== "string" || token.length === 0) {
      throw unauthorized();
    }

    const record = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        user: { include: { institution: { select: { id: true, code: true, name: true } } } },
      },
    });

    const now = new Date();
    if (record == null || record.invalidatedAt != null || record.expiresAt.getTime() <= now.getTime()) {
      throw unauthorized("Your session has expired. Please sign in again.");
    }
    if (!record.user.isActive) {
      throw unauthorized("This account is inactive.");
    }

    // opportunistic last-seen refresh (at most once per request anyway, cheap)
    await prisma.session.update({
      where: { id: record.id },
      data: { lastSeenAt: now },
      select: { id: true },
    });

    req.auth = {
      sessionId: record.id,
      user: {
        id: record.user.id,
        email: record.user.email,
        fullName: record.user.fullName,
        role: record.user.role,
        institutionId: record.user.institutionId,
        institution: record.user.institution ?? null,
        mustChangePassword: record.user.mustChangePassword,
      },
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request): { user: AuthenticatedUser; sessionId: number } {
  if (req.auth == null) {
    throw unauthorized();
  }
  return req.auth;
}
