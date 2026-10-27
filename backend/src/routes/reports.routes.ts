/**
 * Report endpoints (SAMPLE-labelled, same serialization for view and export):
 * GET /api/reports/:kind            - JSON table payload
 * GET /api/reports/:kind/export     - text/csv download (formula-injection guarded)
 *
 * kind: register | upcoming_maturity | pending_corrections | replacement_obligations | release_status
 * Every report is produced by an authorized scope query; a viewer never
 * receives rows outside their role's scope.
 */
import { Router } from "express";
import { ReportKindSchema, ReportQuerySchema } from "@sih26265/contracts";
import { getReport, auditReportExport, renderReportCsv, reportCsvFilename } from "../services/report.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod, validationError } from "../errors.js";

export const reportsRouter = Router();

reportsRouter.get("/:kind/export", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const kind = ReportKindSchema.safeParse(req.params.kind);
    if (!kind.success) {
      throw validationError(
        { kind: ["Unknown report kind."] },
        "The report path needs attention.",
      );
    }
    const parsed = ReportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);

    const report = await getReport(user, kind.data, parsed.data);
    const csv = renderReportCsv(report);
    await auditReportExport(user, kind.data, parsed.data, report.count);

    res.status(200)
      .setHeader("content-type", "text/csv; charset=utf-8")
      .setHeader("cache-control", "no-store")
      .setHeader("x-content-type-options", "nosniff")
      .setHeader("content-disposition", `attachment; filename="${reportCsvFilename(kind.data, report.generatedAt)}"`)
      .send(csv);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/:kind", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const kind = ReportKindSchema.safeParse(req.params.kind);
    if (!kind.success) {
      throw validationError(
        { kind: ["Unknown report kind."] },
        "The report path needs attention.",
      );
    }
    const parsed = ReportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await getReport(user, kind.data, parsed.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});
