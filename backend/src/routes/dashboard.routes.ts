import { Router } from "express";
import { buildDashboard } from "../services/dashboard.service.js";
import { requireAuth } from "../middleware/authenticate.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const payload = await buildDashboard(user);
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
});
