import express from "express";
import cookieParser from "cookie-parser";
import { apiRouter } from "./routes/index.js";
import { AppError, notFoundHandler, toErrorBody } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Express application factory. Only HTTP plumbing lives here: body parsing,
 * cookies, API routing and the shared error translation. Business rules live
 * in services and rules modules.
 */
export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  // Behind Vercel rewrites / Railway load balancers
  app.set("trust proxy", 1);
  // BigInt-safe JSON (defence in depth; services already map amounts to strings)
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api", apiRouter);

  // Non-API paths are not served by this app (the SPA lives on Vercel/Vite).
  app.use(notFoundHandler);

  app.use(errorMiddleware);

  return app;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
function errorMiddleware(err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json(toErrorBody(err));
    return;
  }

  // Body parser errors (malformed JSON, oversized payloads)
  const type = (err as { type?: string } | null)?.type;
  if (type === "entity.parse.failed" || type === "entity.too.large") {
    res.status(422).json(
      toErrorBody(new AppError("VALIDATION_ERROR", "The request body is malformed.", 422)),
    );
    return;
  }

  logger.error(
    { err, requestId: res.locals?.requestId },
    "unhandled_error",
  );
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  });
}
