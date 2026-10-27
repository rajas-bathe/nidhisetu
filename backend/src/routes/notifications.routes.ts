/**
 * Notification endpoints (all viewers; recipients are user rows or their
 * institution): GET list, POST mark one read, POST mark all read.
 */
import { Router } from "express";
import { z } from "zod";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../services/notification.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod } from "../errors.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const result = await listNotifications({ id: user.id, institutionId: user.institutionId }, 60);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/read-all", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const result = await markAllNotificationsRead({ id: user.id, institutionId: user.institutionId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/:notificationId/read", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = z
      .object({ notificationId: z.coerce.number().int().positive() })
      .safeParse(req.params);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await markNotificationRead({ id: user.id, institutionId: user.institutionId }, parsed.data.notificationId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
