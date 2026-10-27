import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@sih26265/contracts";
import { forbidden } from "../errors.js";
import { requireAuth } from "./authenticate";

/** Server-enforced role check for route guards. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const { user } = requireAuth(req);
      if (!roles.includes(user.role)) {
        throw forbidden("Your role does not have access to this operation.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
