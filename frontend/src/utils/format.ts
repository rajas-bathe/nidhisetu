import type { Money } from "@sih26265/contracts";

/** Formats integer minor units as an Indian-locale currency string. */
export function formatMoney(money: Money): string {
  const amount = Number(money.amountMinor);
  const major = amount / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: 2,
  }).format(major);
}

/** "2026-04-21" -> "21 Apr 2026" (dates only; never shifts a calendar day). */
export function formatLocalDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    month - 1
  ]  ?? "?";
  return `${day} ${monthName} ${year}`;
}

export function formatRelativeDays(days: number): string {
  if (days === 0) return "matures today";
  if (days < 0) return `matured ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}
