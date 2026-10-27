import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Assigns a correlation id to every API request, echoes it back as a response
 * header and makes it available for logs and audit records.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers["x-request-id"];
  const id =
    typeof provided === "string" && provided.length >= 8 && provided.length <= 64
      ? provided
      : randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
