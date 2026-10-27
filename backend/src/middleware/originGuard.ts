import type { NextFunction, Request, Response } from "express";
import { config } from "../config/env.js";
import { forbidden } from "../errors.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF protection for cookie-authenticated APIs.
 *
 * Layer 1: the session cookie is SameSite=Lax, so cross-site POSTs do not carry it.
 * Layer 2 (this middleware): mutating requests that arrive WITH an Origin header
 * must come from an explicitly allow-listed origin. Browsers attach Origin to
 * same-origin POSTs; non-browser API clients (tests, server-to-server) omit it.
 * Layer 3: fetches from our frontend always send the custom header below, which
 * browsers refuse to attach cross-origin without a CORS preflight approval
 * (none is granted for foreign origins because no CORS headers are emitted).
 */
export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const requestedWith = req.headers["x-requested-with"];
  const customHeaderOk = requestedWith === "XMLHttpRequest";

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (typeof origin !== "string" || !config.allowedOrigins.includes(origin)) {
      throw forbidden("This origin is not allowed to call the API.");
    }
    // Browser request with an allow-listed origin still needs the custom header
    // so that a crafted form post from an allow-listed origin cannot ride the cookie.
    if (!customHeaderOk) {
      throw forbidden("Mutating requests must include the X-Requested-With header.");
    }
  }

  next();
}
