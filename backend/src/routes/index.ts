import { Router } from "express";
import { requestIdMiddleware } from "../middleware/requestId.js";
import { httpLogger } from "../middleware/httpLogger.js";
import { originGuard } from "../middleware/originGuard.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePasswordNotPending } from "../middleware/requirePasswordChange.js";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.routes.js";
import { dashboardRouter } from "./dashboard.routes.js";
import { fdrRouter } from "./fdr.routes.js";
import { documentRouter } from "./document.routes.js";
import { taskRouter } from "./task.routes.js";
import { caseRouter } from "./case.routes.js";
import { correctionsRouter } from "./corrections.routes.js";
import { replacementsRouter } from "./replacements.routes.js";
import { releasesRouter } from "./releases.routes.js";
import { approvalsRouter } from "./approvals.routes.js";
import { notificationsRouter } from "./notifications.routes.js";
import { reportsRouter } from "./reports.routes.js";
import { auditRouter } from "./audit.routes.js";
import { institutionsRouter } from "./institutions.routes.js";
import { adminRouter } from "./admin.routes.js";
import { notFoundHandler } from "../errors.js";

export const apiRouter = Router();

apiRouter.use(requestIdMiddleware);
apiRouter.use(httpLogger);
apiRouter.use(originGuard);

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);

// Everything below requires a valid session.
apiRouter.use(authenticate);
// Accounts still carrying a temporary password can only reach the auth
// endpoints above (change-password included) until they set their own.
apiRouter.use(requirePasswordNotPending);

apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/fdrs", fdrRouter);
apiRouter.use("/documents", documentRouter);
apiRouter.use("/tasks", taskRouter);
apiRouter.use("/cases", caseRouter);
apiRouter.use("/corrections", correctionsRouter);
apiRouter.use("/replacements", replacementsRouter);
apiRouter.use("/releases", releasesRouter);
apiRouter.use("/approvals", approvalsRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/audit", auditRouter);
apiRouter.use("/institutions", institutionsRouter);
apiRouter.use("/admin", adminRouter);

// Unmatched API paths get a structured 404 (frontend contract).
apiRouter.use(notFoundHandler);
