import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { config } from "../config/env.js";
import { toErrorBody, validationError } from "../errors.js";

/**
 * Multipart upload: files are buffered in memory only, so unvalidated bytes
 * never touch the disk; validation happens in the document service before the
 * storage adapter is called. One file per request under the "file" field.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxUploadBytes,
    files: 1,
    fields: 10,
  },
});

/** Translates multer/native errors into the shared ApiErrorBody shape. */
function translateUploadError(err: unknown, res: Response): void {
  const name = err != null && typeof err === "object" ? (err as { name?: string }).name : null;
  const code = err != null && typeof err === "object" ? (err as { code?: string }).code : null;

  if (name === "MulterError") {
    if (code === "LIMIT_FILE_SIZE") {
      const body = toErrorBody(
        validationError(
          { file: [`The file exceeds the maximum size of ${config.storage.maxUploadMb} MB.`] },
          "The file needs attention before upload.",
        ),
      );
      res.status(422).json(body);
      return;
    }
    const body = toErrorBody(
      validationError(
        { file: ["The upload was rejected. Send exactly one file under the form field 'file'."] },
        "The file needs attention before upload.",
      ),
    );
    res.status(422).json(body);
    return;
  }

  throw err;
}

/** Wraps multer.single so upload failures surface as structured 422s. */
export function uploadSingleFile(field = "file") {
  return (req: Request, res: Response, next: NextFunction): void => {
    upload.single(field)(req, res, (error) => {
      if (error != null) {
        try {
          translateUploadError(error, res);
          return;
        } catch (rethrow) {
          next(rethrow);
          return;
        }
      }
      next();
    });
  };
}

/** Reads the single uploaded file from the multer result (or null). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export function getUploadedFile(req: Request): UploadedFile | null {
  const file = (req as Request & { file?: UploadedFile }).file;
  return file ?? null;
}
