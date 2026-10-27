/**
 * Approving-authority queue:
 * GET /api/approvals - replacement acceptances + recommended releases awaiting a decision
 * (includeDecided=1 shows the history). System admins get read-only visibility.
 */
import { Router } from "express";
import { z } from "zod";
import { ListApprovalsQuerySchema } from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import { listApprovalQueue } from "../services/approval.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const approvalsRouter = Router();

const QuerySchema = z.intersection(ListApprovalsQuerySchema, PageQuerySchema);

approvalsRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listApprovalQueue(user, {
      kind: parsed.data.kind,
      includeDecided: parsed.data.includeDecided,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
