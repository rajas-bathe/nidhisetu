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

/**
 * A deposit amount the user typed in rupees (for example "500000" or "12345.50").
 * validated and converted to exact minor units on the server; no floating point
 * participates. May be an empty string only where the payload allows drafts.
 */
export const RupeeAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Enter the amount in rupees (for example 500000 or 500000.55)");

export type RupeeAmount = z.infer<typeof RupeeAmountSchema>;

/** Optional variant used for draft saves and completion amounts. */
export const RupeeAmountOptionalSchema = z
  .string()
  .regex(/^(?:[1-9]\d{0,11}|0)(?:\.\d{1,2})?$/, "Enter the amount in rupees (for example 500000 or 500000.55)")
  .or(z.literal(""));

export type RupeeAmountOptional = z.infer<typeof RupeeAmountOptionalSchema>;
