import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "./authenticate.js";
import { AppError } from "../errors.js";

/**
 * Blocks every business endpoint while an account still carries the temporary
 * password. Password-muth flows (change password in the auth router) sit ahead
 * of this middleware, so the forced change is always reachable.
 */
export function requirePasswordNotPending(req: Request, _res: Response, next: NextFunction): void {
  try {
    const { user } = requireAuth(req);
    if (user.mustChangePassword) {
      throw new AppError(
        "PASSWORD_CHANGE_REQUIRED",
        "Replace the temporary password before continuing.",
        403,
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}
