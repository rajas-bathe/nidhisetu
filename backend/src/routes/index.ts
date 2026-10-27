import { Router } from "express";
import { requestIdMiddleware } from "../middleware/requestId.js";
import { httpLogger } from "../middleware/httpLogger.js";
import { originGuard } from "../middleware/originGuard.js";
import { authenticate } from "../middleware/authenticate.js";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.routes.js";
import { dashboardRouter } from "./dashboard.routes.js";
import { fdrRouter } from "./fdr.routes.js";
import { documentRouter } from "./document.routes.js";
import { taskRouter } from "./task.routes.js";
import { notFoundHandler } from "../errors.js";

export const apiRouter = Router();

apiRouter.use(requestIdMiddleware);
apiRouter.use(httpLogger);
apiRouter.use(originGuard);

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);

// Everything below requires a valid session.
apiRouter.use(authenticate);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/fdrs", fdrRouter);
apiRouter.use("/documents", documentRouter);
apiRouter.use("/tasks", taskRouter);

// Unmatched API paths get a structured 404 (frontend contract).
apiRouter.use(notFoundHandler);
