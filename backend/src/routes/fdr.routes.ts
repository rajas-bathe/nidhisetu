import { Router } from "express";
import { PageQuerySchema, ListFdrsQuerySchema } from "@sih26265/contracts";
import { z } from "zod";
import { listFdrs } from "../services/fdr.service.js";
import { listDocuments, uploadDocument } from "../services/document.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { getUploadedFile, uploadSingleFile } from "../middleware/upload.js";
import { fromZod, validationError } from "../errors.js";

export const fdrRouter = Router();

const QuerySchema = z.intersection(ListFdrsQuerySchema, PageQuerySchema);

const FdrIdParamSchema = z.object({
  fdrId: z.coerce.number().int().positive(),
});

function invalidFdrIdParam(): never {
  throw validationError(
    { fdrId: ["The instrument reference is invalid."] },
    "The request path needs attention.",
  );
}

/**
 * GET /api/fdrs - institution-scoped, filtered list.
 * Query: q, status, institutionId (officers only, must be in jurisdiction),
 * dateCondition, sort, page, pageSize.
 */
fdrRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw fromZod(parsed.error);
    }
    const result = await listFdrs(user, {
      ...parsed.data,
      institutionId: parsed.data.institutionId,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/fdrs/:fdrId/documents - college upload of the instrument scan.
 * The file is buffered in memory only, validated (size + declared type +
 * magic bytes) and stored under a generated key; metadata lands in
 * PostgreSQL and the object never becomes publicly servable.
 */
fdrRouter.post("/:fdrId/documents", uploadSingleFile("file"), async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      invalidFdrIdParam();
    }
    const file = getUploadedFile(req);
    if (file == null) {
      throw validationError(
        { file: ["Attach exactly one file under the form field 'file'."] },
        "The file needs attention before upload.",
      );
    }

    const meta = await uploadDocument(user, parsed.data.fdrId, {
      fileName: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
    });
    res.status(201).json({ document: meta });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/fdrs/:fdrId/documents - list of the instrument's uploaded documents.
 */
fdrRouter.get("/:fdrId/documents", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      invalidFdrIdParam();
    }
    const result = await listDocuments(user, parsed.data.fdrId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
