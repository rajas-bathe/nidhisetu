import { z } from "zod";

/**
 * Machine-readable error codes. Only add codes that are actually produced;
 * new codes are covered by expanding this enum.
 */
export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "INVALID_CREDENTIALS",
  "ACCOUNT_INACTIVE",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "WRONG_LOGIN_PORTAL",
  "RATE_LIMITED",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    /** Field errors keyed by request field name, where applicable. */
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/**
 * Client-facing typed error thrown by the API layer on the frontend.
 * Builds on the shared code registry so handling stays consistent.
 */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}
