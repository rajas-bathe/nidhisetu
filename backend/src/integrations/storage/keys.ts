import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Storage keys are generated server-side. A client-provided file name only
 * contributes a sanitized extension, so no request can influence the directory
 * the adapter writes into (path traversal is structurally impossible).
 */
export function extensionFromFileName(fileName: string): string {
  const base = path.posix.basename(fileName.replace(/\\/g, "/")).trim();
  const ext = path.posix.extname(base).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) {
    return "";
  }
  return ext;
}

/** Builds a key like `fdr/<fdrId>/<uuid><ext>` with an optional date shard. */
export function buildObjectKey(fdrId: number, fileName: string, now: Date = new Date()): string {
  const shard = now.toISOString().slice(0, 7); // YYYY-MM; hum-debuggable, still unguessable per object
  const uuid = randomUUID();
  const ext = extensionFromFileName(fileName);
  return `fdr/${fdrId}/${shard}/${uuid}${ext}`;
}

/**
 * Validates a key before any adapter touches the filesystem or network:
 * - no empty or absolute forms,
 * - no traversal segments,
 * - always contained beneath `fdr/`.
 */
export function assertValidObjectKey(key: string): void {
  if (key.length === 0 || key.length > 512) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key.slice(0, 16))}`);
  }
  const normalised = key.replace(/\\/g, "/");
  if (normalised.startsWith("/") || path.posix.isAbsolute(normalised)) {
    throw new Error("Invalid storage key: must not be absolute.");
  }
  const segments = normalised.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Invalid storage key: must not contain traversal or empty segments.");
  }
  // Only keys this system generates are legitimate (uuids under fdr/<id>/<shard>).
  // A strict charset whitelist also rejects disguised traversal forms such as
  // "..%2f", "....//", NFC-encoded dots or control characters.
  if (segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error("Invalid storage key: segment contains disallowed characters.");
  }
  if (segments[0] !== "fdr") {
    throw new Error("Invalid storage key: unexpected prefix.");
  }
}
