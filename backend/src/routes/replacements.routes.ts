/**
 * Replacement (renewal) endpoints:
 * GET  /api/replacements           - pending replacement obligations in the officer's jurisdiction
 * POST /api/replacements/recommend - reviewing officer recommends for acceptance
 * POST /api/replacements/accept    - approving authority accepts -> supersedes the earlier instrument
 * POST /api/replacements/reject    - approving authority rejects (reason required)
 */
import { Router } from "express";
import { z } from "zod";
import {
  ReplacementDecisionRequestSchema,
  ReplacementRecommendRequestSchema,
} from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import {
  acceptReplacement,
  listReplacements,
  recommendReplacement,
  rejectReplacement,
} from "../services/replacement.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const replacementsRouter = Router();

replacementsRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = z.intersection(z.object({}), PageQuerySchema).safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listReplacements(user, { page: parsed.data.page, pageSize: parsed.data.pageSize });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

replacementsRouter.post("/recommend", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ReplacementRecommendRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await recommendReplacement(user, parsed.data.fdrId, parsed.data.note ?? "");
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

replacementsRouter.post("/accept", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ReplacementDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await acceptReplacement(user, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

replacementsRouter.post("/reject", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ReplacementDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await rejectReplacement(user, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
