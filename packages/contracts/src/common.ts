import { z } from "zod";

/**
 * A calendar date (no time component). Serialized as "YYYY-MM-DD".
 * Event timestamps are separate (ISO 8601 datetime strings).
 */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date formatted as YYYY-MM-DD");

export type LocalDate = z.infer<typeof LocalDateSchema>;

/** An event timestamp serialized as an ISO 8601 string. */
export const TimestampSchema = z.string().datetime();

export type Timestamp = z.infer<typeof TimestampSchema>;

/**
 * Money serialized safely for JSON: ISO-4217 currency code and the exact
 * integer minor-unit amount as a string (never floating point).
 */
export const MoneySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, "Expected an ISO-4217 currency code"),
  amountMinor: z.string().regex(/^-?\d+$/, "Expected an integer amount in minor units"),
});

export type Money = z.infer<typeof MoneySchema>;

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

/** Standard paginated collection shape used by list endpoints. */
export interface Paginated<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Referral to an institution. Safe to embed in every role's payloads;
 * college users always receive only their own institution.
 */
export const InstitutionRefSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
});

export type InstitutionRef = z.infer<typeof InstitutionRefSchema>;
