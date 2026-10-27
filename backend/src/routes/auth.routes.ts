import { Router } from "express";
import { z } from "zod";
import type { LoginRequest } from "@sih26265/contracts";
import { config } from "../config/env.js";
import { attemptLogin, logoutSession } from "../services/auth.service.js";
import { authenticate, serializeUser } from "../middleware/authenticate.js";
import { loginRateLimiter } from "../middleware/rateLimit.js";
import { recordAudit } from "../services/audit.service.js";
import { fromZod, invalidCredentials } from "../errors.js";

const LoginBodySchema = z.object({
  email: z
    .string({ message: "Email is required" })
    .trim()
    .min(1, "Email is required")
    .max(320, "Email is too long")
    .email("Enter a valid email address"),
  password: z
    .string({ message: "Password is required" })
    .min(1, "Password is required")
    .max(200, "Password is too long"),
  context: z.enum(["college", "officer"]),
});

function clientIp(req: { ip?: string; socket?: { remoteAddress?: string | null } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = LoginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw fromZod(parsed.error);
    }
    const body = parsed.data satisfies LoginRequest;

    const result = await attemptLogin({
      email: body.email,
      password: body.password,
      context: body.context,
      requestIp: clientIp(req as { ip?: string; socket: { remoteAddress?: string | null } }),
      userAgentHeader: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
      correlationId: typeof res.locals.requestId === "string" ? res.locals.requestId : null,
    });

    if (result.kind !== "ok") {
      if (result.kind === "wrong_portal") {
        await recordAudit({
          action: "AUTH_LOGIN_PORTAL_REJECTED",
          actorUserId: result.userId,
          detail: { attemptedContext: body.context, actualRole: result.actualRole },
          correlationId: typeof res.locals.requestId === "string" ? res.locals.requestId : null,
        });
        res.status(403).json({
          error: {
            code: "WRONG_LOGIN_PORTAL",
            message:
              body.context === "officer"
                ? "This account is a college account. Use the college login."
                : "This account is an AICTE account. Use the officer login.",
          },
        });
        return;
      }
      if (result.kind === "inactive_account") {
        await recordAudit({
          action: "AUTH_LOGIN_FAILED",
          actorUserId: result.userId,
          detail: { reason: "INACTIVE" },
          correlationId: typeof res.locals.requestId === "string" ? res.locals.requestId : null,
        });
        res.status(403).json({
          error: { code: "ACCOUNT_INACTIVE", message: "This account has been deactivated." },
        });
        return;
      }
      await recordAudit({
        action: "AUTH_LOGIN_FAILED",
        detail: { context: body.context },
        requestIp: clientIp(req as { ip?: string; socket: { remoteAddress?: string | null } }),
        correlationId: typeof res.locals.requestId === "string" ? res.locals.requestId : null,
      });
      throw invalidCredentials();
    }

    res.cookie(config.sessionCookieName, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      expires: result.expiresAt,
    });
    // custom header marker for the CSRF guard
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ user: result.serialized });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", authenticate, async (req, res, next) => {
  try {
    const auth = req.auth!;
    await logoutSession(auth.sessionId, auth.user.id);
    res.clearCookie(config.sessionCookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", authenticate, (req, res) => {
  res.status(200).json({ user: serializeUser(req.auth!.user) });
});
