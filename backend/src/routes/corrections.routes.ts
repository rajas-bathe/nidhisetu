/**
 * Correction workflow endpoints:
 * GET  /api/corrections            - scoped list (page/pageSize/status/fdrId/institutionId)
 * POST /api/corrections            - reviewing officer raises a correction request
 * POST /api/corrections/respond    - college responds (new immutable version + check invalidation)
 * POST /api/corrections/:id/cancel - reviewing officer cancels an open request
 */
import { Router } from "express";
import { z } from "zod";
import {
  CorrectionCreateRequestSchema,
  CorrectionRespondRequestSchema,
  ListCorrectionsQuerySchema,
} from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import {
  cancelCorrection,
  createCorrection,
  listCorrections,
  respondCorrection,
} from "../services/correction.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const correctionsRouter = Router();

const QuerySchema = z.intersection(ListCorrectionsQuerySchema, PageQuerySchema);

correctionsRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listCorrections(user, { ...parsed.data });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

correctionsRouter.post("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = CorrectionCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await createCorrection(user, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

correctionsRouter.post("/respond", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = CorrectionRespondRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await respondCorrection(user, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

correctionsRouter.post("/:correctionId/cancel", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = z
      .object({ correctionId: z.coerce.number().int().positive() })
      .safeParse(req.params);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await cancelCorrection(user, parsed.data.correctionId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
