import { z } from "zod";
import type { ApiErrorCode } from "@sih26265/contracts";

/**
 * Operational error type. Route handlers throw these; the error middleware
 * serialises them into the shared ApiErrorBody shape from the contracts.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: ApiErrorCode, message: string, status: number, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function unauthorized(message = "Sign in to continue."): AppError {
  return new AppError("UNAUTHENTICATED", message, 401);
}

export function invalidCredentials(message = "Invalid email or password."): AppError {
  return new AppError("INVALID_CREDENTIALS", message, 401);
}

export function forbidden(message = "You do not have access to this resource."): AppError {
  return new AppError("FORBIDDEN", message, 403);
}

export function notFound(message = "The requested record does not exist."): AppError {
  return new AppError("NOT_FOUND", message, 404);
}

export function conflict(message: string): AppError {
  return new AppError("CONFLICT", message, 409);
}

export function validationError(
  fieldErrors: Record<string, string[]>,
  message = "Some fields need attention.",
): AppError {
  return new AppError("VALIDATION_ERROR", message, 422, fieldErrors);
}

/** Converts a zod error into the shared field-error map. */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (grouped[key] ??= []).push(issue.message);
  }
  return grouped;
}

export function fromZod(error: z.ZodError): AppError {
  return validationError(zodFieldErrors(error));
}

export function toErrorBody(err: AppError): {
  error: { code: ApiErrorCode; message: string; fieldErrors?: Record<string, string[]> };
} {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
    },
  };
}

import type { NextFunction, Request, Response } from "express";

/** Structured 404 for unmatched API paths. */
export function notFoundHandler(_req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "The requested endpoint does not exist." },
  } satisfies ReturnType<typeof toErrorBody>);
}
