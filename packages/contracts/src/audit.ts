import { z } from "zod";
import { TimestampSchema } from "./common.js";

/**
 * Audit view rows. Only safe summaries are exposed: password hashes, session
 * tokens and raw request payloads never reach audit records.
 */
export const AuditItemSchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string().nullable(),
  institutionName: z.string().nullable(),
  fdrPublicCode: z.string().nullable(),
  /** One-line human summary of the change (rendered from safe detail fields). */
  summary: z.string(),
  createdAt: TimestampSchema,
});

export type AuditItem = z.infer<typeof AuditItemSchema>;

export const AuditListResponseSchema = z.object({
  items: z.array(AuditItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

export const ListAuditQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorId: z.coerce.number().int().positive().optional(),
  fdrId: z.coerce.number().int().positive().optional(),
  institutionId: z.coerce.number().int().positive().optional(),
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
});

export type ListAuditQuery = z.infer<typeof ListAuditQuerySchema>;
