import { randomBytes, createHash } from "node:crypto";

/** Generates an opaque URL-safe session token (the raw value goes into the cookie). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Session tokens are stored only as SHA-256 hashes; the DB never holds the raw cookie value. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Normalises receipt-style identifiers: trim + collapse inner whitespace + uppercase. */
export function normaliseIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
