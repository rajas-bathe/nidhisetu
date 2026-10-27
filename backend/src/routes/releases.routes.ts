/**
 * Release lifecycle endpoints (SAMPLE policy: approval never completes by itself):
 * GET  /api/releases             - scoped list (fdrId/institutionId/stage + paging)
 * POST /api/releases             - college raises the request (reason + evidence category)
 * POST /api/releases/action      - officer recommend/reject, authority approve/reject
 * POST /api/releases/complete    - officer records external completion evidence
 */
import { Router } from "express";
import {
  ListReleasesQuerySchema,
  ReleaseActionRequestSchema,
  ReleaseCompleteRequestSchema,
  ReleaseCreateRequestSchema,
} from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import type { ReleaseEvidenceType } from "@sih26265/contracts";
import { z } from "zod";
import { actOnRelease, completeRelease, createReleaseRequest, listReleases } from "../services/release.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const releasesRouter = Router();

const QuerySchema = z.intersection(ListReleasesQuerySchema, PageQuerySchema);

releasesRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listReleases(user, { ...parsed.data });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

releasesRouter.post("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ReleaseCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await createReleaseRequest(user, {
      fdrId: parsed.data.fdrId,
      reason: parsed.data.reason,
      evidenceType: parsed.data.evidenceType,
      evidenceRef: parsed.data.evidenceRef,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

releasesRouter.post("/action", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ReleaseActionRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await actOnRelease(user, {
      releaseId: parsed.data.releaseId,
      action: parsed.data.action,
      note: parsed.data.note ?? "",
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

releasesRouter.post("/complete", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ReleaseCompleteRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await completeRelease(user, {
      releaseId: parsed.data.releaseId,
      evidenceType: parsed.data.evidenceType as ReleaseEvidenceType & string,
      evidenceRef: parsed.data.evidenceRef,
      evidenceDate: parsed.data.evidenceDate,
      completedAmountRupees: parsed.data.completedAmountRupees,
      note: parsed.data.note,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
