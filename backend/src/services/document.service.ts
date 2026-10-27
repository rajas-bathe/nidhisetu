import { createHash } from "node:crypto";
import path from "node:path";
import type { DocumentListResponse, DocumentMeta } from "@sih26265/contracts";
import { config } from "../config/env.js";
import { getStorageAdapter } from "../integrations/storage/index.js";
import { buildObjectKey } from "../integrations/storage/keys.js";
import { prisma } from "../db/client.js";
import { logger } from "../logger.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { recordAudit } from "./audit.service.js";
import { getAccessScope } from "./scope.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

/**
 * Uploaded instrument documents (scans/photos of the FDR receipt).
 *
 * Security model:
 * - File content checks: size limit, allow-listed MIME type, and magic-byte
 *   verification so a renamed executable never enters storage as "pdf".
 * - Metadata lives in PostgreSQL; bytes live in the configured storage adapter
 *   (local private directory in development, S3-compatible bucket in deploy).
 * - Reads: every lookup filters by the acting user's institution scope, so a
 *   foreign document id is indistinguishable from a nonexistent one.
 * - Writes: college accounts only, and only for their own institution.
 */
const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

const ALLOWED_MAGICS: Record<(typeof ALLOWED_MIME_TYPES)[number], readonly number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface UploadDocumentInput {
  /** Client-sent file name; only a sanitized extension survives into the key. */
  fileName: string;
  /** Declared MIME type; must agree with the magic bytes. */
  mimeType: string;
  content: Buffer;
}

export interface DocumentWithContent {
  meta: DocumentMeta;
  mimeType: AllowedMimeType;
  fileName: string;
  sizeBytes: number;
  content: Buffer;
}

/** Strips directories, control characters and overlong names from client input. */
export function sanitizeFileName(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, "/")).trim();
  // eslint-disable-next-line no-control-regex
  const withoutControls = base.replace(new RegExp("[" + "\\u0000-\\u001f\\u007f" + "]", "gu"), "");
  const collapsed = withoutControls.replace(/\s+/g, " ").slice(0, 200).trim();
  return collapsed.length > 0 ? collapsed : "document";
}

function detectContentMime(content: Buffer): AllowedMimeType | null {
  for (const [mime, magic] of Object.entries(ALLOWED_MAGICS) as [AllowedMimeType, readonly number[]][]) {
    if (content.length >= magic.length && magic.every((byte, index) => content[index] === byte)) {
      return mime;
    }
  }
  return null;
}

/** Uploads a document for an FDR the acting college user owns. */
export async function uploadDocument(
  user: AuthenticatedUser,
  fdrId: number,
  input: UploadDocumentInput,
): Promise<DocumentMeta> {
  if (user.role !== "COLLEGE_USER") {
    throw forbidden("Only college accounts can upload instrument documents.");
  }

  validateUploadOrThrow(input);
  const mimeType = input.mimeType as AllowedMimeType;
  const fileName = sanitizeFileName(input.fileName);
  const checksumSha256 = createHash("sha256").update(input.content).digest("hex");

  const scope = await getAccessScope(user);
  // Filter (never find-then-check): a foreign fdrId 404s without leaking.
  const fdr = await prisma.fdr.findFirst({
    where: { id: fdrId, institutionId: { in: scope.institutionIds } },
    select: { id: true, publicCode: true },
  });
  if (fdr == null) {
    throw notFound("The requested record does not exist.");
  }

  const duplicate = await prisma.document.findFirst({
    where: { fdrId: fdr.id, checksumSha256 },
    select: { id: true },
  });
  if (duplicate != null) {
    throw conflict("An identical file has already been uploaded for this instrument.");
  }

  const storage = getStorageAdapter();
  const key = buildObjectKey(fdr.id, fileName);

  let stored = false;
  try {
    await storage.put(input.content, key);
    stored = true;

    const row = await prisma.document.create({
      data: {
        fdrId: fdr.id,
        objectKey: key,
        fileName,
        mimeType,
        sizeBytes: input.content.length,
        checksumSha256,
        uploadedById: user.id,
      },
      include: { uploadedBy: { select: { fullName: true } } },
    });

    await recordAudit({
      action: "DOCUMENT_UPLOADED",
      actorUserId: user.id,
      institutionId: user.institutionId,
      fdrId: fdr.id,
      entityType: "Document",
      entityId: row.id,
      detail: { fileName, mimeType, sizeBytes: input.content.length, storageAdapter: storage.name },
    });

    return serializeDocumentMeta(row, fdr.publicCode);
  } catch (error) {
    // The database row is authoritative: never leave an orphaned object behind.
    if (stored) {
      await storage.delete(key).catch((storageError) => {
        logger.error({ err: storageError, key }, "orphan_storage_cleanup_failed");
      });
    }
    throw error;
  }
}

function validateUploadOrThrow(input: UploadDocumentInput): void {
  if (input.content.length === 0) {
    throw validationError(
      { file: ["The file is empty. Attach the scan or photo of the instrument."] },
      "The file needs attention before upload.",
    );
  }
  if (input.content.length > config.storage.maxUploadBytes) {
    throw validationError(
      { file: [`The file exceeds the maximum size of ${config.storage.maxUploadMb} MB.`] },
      "The file needs attention before upload.",
    );
  }
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType as AllowedMimeType)) {
    throw validationError(
      { file: ["The file type is not supported. Upload a PDF, PNG or JPEG file."] },
      "The file needs attention before upload.",
    );
  }
  const contentMime = detectContentMime(input.content);
  if (contentMime !== input.mimeType) {
    throw validationError(
      { file: ["The file content does not match its declared type."] },
      "The file needs attention before upload.",
    );
  }
}

/** Lists documents of an instrument the acting user can access. */
export async function listDocuments(
  user: AuthenticatedUser,
  fdrId: number,
): Promise<DocumentListResponse> {
  const scope = await getAccessScope(user);
  const fdr = await prisma.fdr.findFirst({
    where: { id: fdrId, institutionId: { in: scope.institutionIds } },
    select: { id: true, publicCode: true },
  });
  if (fdr == null) {
    throw notFound("The requested record does not exist.");
  }

  const rows = await prisma.document.findMany({
    where: { fdrId: fdr.id },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    include: { uploadedBy: { select: { fullName: true } } },
  });

  return { items: rows.map((row) => serializeDocumentMeta(row, fdr.publicCode)), total: rows.length };
}

/**
 * Loads a document plus its bytes for the authorized download route. The
 * query joins the owner institution; documents outside the acting user's
 * scope behave exactly like nonexistent documents.
 */
export async function getDocumentForRead(
  user: AuthenticatedUser,
  documentId: number,
): Promise<DocumentWithContent> {
  const scope = await getAccessScope(user);

  const scopeCondition =
    scope.institutionIds.length > 0
      ? { institutionId: { in: scope.institutionIds } }
      : { id: -1 };

  const document = await prisma.document.findFirst({
    where: { id: documentId, fdr: scopeCondition },
    include: {
      uploadedBy: { select: { fullName: true } },
      fdr: { select: { publicCode: true } },
    },
  });
  if (document == null) {
    throw notFound("The requested document does not exist.");
  }

  const content = await getStorageAdapter().get(document.objectKey);

  await recordAudit({
    action: "DOCUMENT_DOWNLOADED",
    actorUserId: user.id,
    institutionId: user.institutionId,
    fdrId: document.fdrId,
    entityType: "Document",
    entityId: document.id,
  });

  return {
    meta: serializeDocumentMeta(document, document.fdr.publicCode),
    mimeType: document.mimeType as AllowedMimeType,
    fileName: document.fileName,
    sizeBytes: document.sizeBytes,
    content,
  };
}

/* Serializes a document row (with its uploader name) for API payloads. */
export function serializeDocumentMeta(
  row: {
    id: number;
    fdrId: number;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    uploadedAt: Date;
    uploadedBy?: { fullName: string } | null;
  },
  fdrPublicCode: string,
): DocumentMeta {
  return {
    id: row.id,
    fdrId: row.fdrId,
    fdrPublicCode,
    fileName: row.fileName,
    mimeType: row.mimeType as DocumentMeta["mimeType"],
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    uploadedAt: row.uploadedAt.toISOString(),
    uploadedByName: row.uploadedBy?.fullName ?? null,
  };
}
