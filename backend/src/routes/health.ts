import { Router } from "express";
import { prisma } from "../db/client.js";

/**
 * Health endpoint. Reveals no secrets: only liveness, database reachability,
 * node version and server time.
 */
export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let database: "ok" | "degraded" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "degraded";
  }

  const healthy = database === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks: { database },
    version: "stage-1",
    time: new Date().toISOString(),
  });
});
