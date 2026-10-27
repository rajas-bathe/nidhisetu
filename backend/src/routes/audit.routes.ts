/**
 * Audit trail endpoint (safe summaries only): GET /api/audit with filters
 * q/action/entityType/actorId/fdrId/institutionId/from/to + paging.
 * Non-admins only ever see rows for their own scope (server-enforced).
 */
import { Router } from "express";
import { z } from "zod";
import { ListAuditQuerySchema } from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import { listAuditEvents } from "../services/audit.service.js";
import { getAccessScope } from "../services/scope.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const auditRouter = Router();

const QuerySchema = z.intersection(ListAuditQuerySchema, PageQuerySchema);

auditRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const scope = await getAccessScope(user);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listAuditEvents(
      { role: user.role, institutionIds: scope.institutionIds, isGlobal: scope.isGlobal },
      { ...parsed.data },
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
