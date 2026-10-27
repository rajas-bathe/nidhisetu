import { z } from "zod";
import { TimestampSchema } from "./common.js";

/**
 * Metadata for an uploaded instrument document (scan / photo of the FDR).
 * The file body never leaves the storage adapter defined in the backend; this
 * is only the JSON description returned by list/upload routes.
 */
export const DocumentMetaSchema = z.object({
  id: z.number().int(),
  fdrId: z.number().int(),
  fdrPublicCode: z.string(),
  /** Original client-side file name, sanitized (no path parts). */
  fileName: z.string(),
  /** MIME type confirmed against magic bytes, not just the declared header. */
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  sizeBytes: z.number().int().nonnegative(),
  /** SHA-256 hex digest of the stored bytes. */
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 hex digest"),
  /** SAMPLE label: uploads made against seeded demo records are sample data. */
  uploadedAt: TimestampSchema,
  uploadedByName: z.string().nullable(),
});

export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;

export const DocumentListResponseSchema = z.object({
  items: z.array(DocumentMetaSchema),
  total: z.number().int(),
});

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

/** Error reasons surfaced for rejected uploads (mapped to field "file"). */
export const DocumentUploadErrorReasonSchema = z.enum([
  "TOO_LARGE",
  "NOT_ALLOWED_TYPE",
  "TYPE_MISMATCH",
  "DUPLICATE_CONTENT",
]);

export type DocumentUploadErrorReason = z.infer<typeof DocumentUploadErrorReasonSchema>;
