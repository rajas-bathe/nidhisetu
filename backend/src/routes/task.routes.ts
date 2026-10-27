import { Router } from "express";
import { z } from "zod";
import { PageQuerySchema, ListTasksQuerySchema } from "@sih26265/contracts";
import { listTasks } from "../services/task.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const taskRouter = Router();

const QuerySchema = z.intersection(ListTasksQuerySchema, PageQuerySchema);

/**
 * GET /api/tasks - the acting user's task inbox (college institution tasks or
 * the officer's personally assigned tasks).
 */
taskRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw fromZod(parsed.error);
    }
    const result = await listTasks(user, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      status: parsed.data.status,
      onlyOverdue: parsed.data.onlyOverdue,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
