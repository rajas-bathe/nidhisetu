import { config } from "../config/env.js";

/**
 * Central "clock" helpers. Everything that compares calendar dates uses these
 * helpers so tests and the demo clock (a later stage) can stay consistent.
 */

/** Returns today's calendar date ("YYYY-MM-DD") in the given IANA timezone. */
export function todayInTz(timezone: string, reference: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

/** Today's date in the configured business timezone. */
export function businessToday(reference: Date = new Date()): string {
  return todayInTz(config.businessTimezone, reference);
}

/** Parses "YYYY-MM-DD" into a Date at UTC midnight (round-trips through {@db.Date} columns). */
export function parseLocalDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid local date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

/** Converts a UTC-midnight Date (as returned/read for {@db.Date} columns) to "YYYY-MM-DD". */
export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Adds whole calendar days to a local date. */
export function addDays(value: string, days: number): string {
  const base = parseLocalDate(value);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Difference in whole calendar days: `to - from` (negative when `to` is earlier). */
export function diffInDays(from: string, to: string): number {
  return Math.round(
    (parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000,
  );
}
