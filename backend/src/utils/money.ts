/**
 * Exact money handling. Users type rupees; the portal stores integer minor
 * units (paise). No floating point participates anywhere near amounts.
 */

/** Rupee string ("12345" or "12345.50") -> minor units as BigInt, or null when invalid. */
export function rupeesToMinorUnits(value: string): bigint | null {
  const normalised = value.trim();
  if (normalised.length === 0) return null;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(normalised)) return null;
  const [whole, frac = ""] = normalised.split(".");
  const frac2 = (frac + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(frac2);
}

/** Minor units -> plain decimal rupee string (display: "500000.50"). */
export function minorUnitsToRupeeString(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const paise = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${paise}`;
}

/** Minor units -> human rupees text used in audit summaries ("Rs 5,00,000.50"). */
export function minorUnitsToRupeesLabel(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const paise = (abs % 100n).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{2})+(?!\d)(?=\d{3}))/g, ",");
  return `Rs ${negative ? "-" : ""}${grouped}.${paise}`;
}
