import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";

/** Lightweight request logging with duration. Never logs bodies or headers. */
export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        requestId: res.locals.requestId as string | undefined,
      },
      "http_request",
    );
  });
  next();
}
