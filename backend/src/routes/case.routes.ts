/**
 * Case workspace endpoints (all viewers; access is scoped server-side):
 * GET /api/cases/:fdrId            - full workspace payload
 * GET /api/cases/:fdrId/guidance   - deterministic "Explain this case" (labelled sample guidance)
 */
import { Router } from "express";
import { z } from "zod";
import { getCaseDetail, getCaseGuidance } from "../services/caseDetail.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod, validationError } from "../errors.js";

export const caseRouter = Router();

const FdrIdParamSchema = z.object({
  fdrId: z.coerce.number().int().positive(),
});

function invalidFdrIdParam(): never {
  throw validationError(
    { fdrId: ["The instrument reference is invalid."] },
    "The request path needs attention.",
  );
}

caseRouter.get("/:fdrId/guidance", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = FdrIdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidFdrIdParam();
    const result = await getCaseGuidance(user, parsed.data.fdrId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

caseRouter.get("/:fdrId", async (req, res, next) => {
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
