import { Router } from "express";
import { PageQuerySchema, ListFdrsQuerySchema, FdrDraftInputSchema, FdrDraftUpdateSchema, StartReviewRequestSchema } from "@sih26265/contracts";
import type { CheckRecordRequest } from "@sih26265/contracts";
import { CheckRecordRequestSchema, VerifyRequestSchema } from "@sih26265/contracts";
import { z } from "zod";
import { listFdrs } from "../services/fdr.service.js";
import {
  createDraft,
  submitDraft,
  updateDraft,
} from "../services/fdrWrite.service.js";
import { isCorrectableField } from "../rules/checkFields.js";
import { getCaseDetail } from "../services/caseDetail.service.js";
import { recordCheck, startReview, verifyCase } from "../services/review.service.js";
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
 * POST /api/fdrs - create a draft. `replacesFdrId` (query, optional) marks the
 * draft as the replacement of an instrument from the same institution; the
 * link is validated (own institution, no chains, no active successor) and the
 * replacement link is only established at submit time.
 */
fdrRouter.post("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const body = FdrDraftInputSchema.safeParse(req.body);
    if (!body.success) {
      throw fromZod(body.error);
    }
    const replaces =
      req.query.replacesFdrId == null ? undefined : z.coerce.number().int().positive().safeParse(req.query.replacesFdrId);
    if (replaces != null && !replaces.success) {
      throw validationError(
        { replacesFdrId: ["The instrument to replace must be referenced by its case id."] },
        "The request path needs attention.",
      );
    }
    const result = await createDraft(user, body.data, replaces?.data);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/fdrs/:fdrId - case workspace payload (same as GET /api/cases/:fdrId).
 */
fdrRouter.get("/:fdrId", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const result = await getCaseDetail(user, parsed.data.fdrId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/fdrs/:fdrId/draft - college edits the draft (optimistic concurrency via baseUpdatedAt).
 */
fdrRouter.patch("/:fdrId/draft", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const body = FdrDraftUpdateSchema.safeParse(req.body);
    if (!body.success) {
      throw fromZod(body.error);
    }
    const result = await updateDraft(user, parsed.data.fdrId, body.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/fdrs/:fdrId/submit - atomic submission: version snapshot, status
 * "submitted", review tasks and audit in one transaction.
 */
fdrRouter.post("/:fdrId/submit", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const result = await submitDraft(user, parsed.data.fdrId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/fdrs/:fdrId/review/start - reviewing officer claims the case for review.
 */
fdrRouter.post("/:fdrId/review/start", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const body = StartReviewRequestSchema.safeParse(req.body ?? {});
    if (body.success && body.data.fdrId !== parsed.data.fdrId) {
      throw validationError(
        { fdrId: ["The case id in the body must match the path."] },
        "The request needs attention.",
      );
    }
    const result = await startReview(user, parsed.data.fdrId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/fdrs/:fdrId/checks - record one evidence check for the current version.
 * SIMULATED bank checks derive their outcome server-side (deterministic; never random).
 */
fdrRouter.post("/:fdrId/checks", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const body = CheckRecordRequestSchema.safeParse({
      fdrId: parsed.data.fdrId,
      field: (req.body as CheckRecordRequest | undefined)?.field,
      source: (req.body as CheckRecordRequest | undefined)?.source,
      outcome: (req.body as CheckRecordRequest | undefined)?.outcome,
      observedValue: (req.body as CheckRecordRequest | undefined)?.observedValue,
      reason: (req.body as CheckRecordRequest | undefined)?.reason,
      evidenceRef: (req.body as CheckRecordRequest | undefined)?.evidenceRef,
    });
    if (!body.success) {
      throw fromZod(body.error);
    }
    if (!isCorrectableField(body.data.field)) {
      throw validationError({ field: ["This field cannot be checked."] }, "The check needs attention.");
    }
    const result = await recordCheck(user, body.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/fdrs/:fdrId/verify - verify when readiness blockers clear (409 lists them).
 */
fdrRouter.post("/:fdrId/verify", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const body = VerifyRequestSchema.safeParse({ fdrId: parsed.data.fdrId, note: req.body?.note ?? "" });
    if (!body.success) {
      throw fromZod(body.error);
    }
    const result = await verifyCase(user, parsed.data.fdrId, body.data.note);
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
