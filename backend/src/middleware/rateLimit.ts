import rateLimit from "express-rate-limit";
import { config } from "../config/env.js";

/**
 * Login rate limiting. Keyed by IP + submitted email so one mailbox cannot be
 * hammered, while shared NAT IPs are not globally locked out. This limiter is
 * per API instance (single-node deployments); a shared store would be needed
 * for horizontally scaled instances - see docs/deployment.md.
 */
export const loginRateLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  limit: config.loginRateLimit.maxAttempts,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const ip = req.ip ?? "unknown";
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    void res;
    return `${ip}|${email}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many sign-in attempts. Please wait and try again.",
      },
    });
  },
});
