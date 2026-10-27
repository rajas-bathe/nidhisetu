/**
 * System-administration college module endpoints (assertAdmin inside every service call):
 * GET    /api/instruments...no— /api/institutions                       - filtered/paged directory
 * GET    /api/institutions/officers?role=...                            - eligible officer directory for selects
 * POST   /api/institutions                                              - create a college record
 * GET    /api/institutions/:institutionId                               - admin workspace detail for one college
 * PATCH  /api/institutions/:institutionId                               - edit college/contact fields
 * POST   /api/institutions/:institutionId/status                        - activate/deactivate (reason note; revokes sessions)
 * POST   /api/institutions/:institutionId/assignments                   - assign/unassign officers by role
 */
import { Router } from "express";
import { z } from "zod";
import {
  AssignmentUpdateRequestSchema,
  InstitutionInputSchema,
  InstitutionStatusActionSchema,
  JurisdictionRoleSchema,
  ListInstitutionsQuerySchema,
} from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import {
  assignOfficer,
  createInstitution,
  getInstitutionDetail,
  listEligibleOfficers,
  listInstitutions,
  setInstitutionStatus,
  updateInstitution,
} from "../services/institution.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod, validationError } from "../errors.js";

export const institutionsRouter = Router();

const IdParamSchema = z.object({ institutionId: z.coerce.number().int().positive() });
const QuerySchema = z.intersection(ListInstitutionsQuerySchema, PageQuerySchema);

function invalidInstitutionParam(): never {
  throw validationError(
    { institutionId: ["The institution reference is invalid."] },
    "The request path needs attention.",
  );
}

// Officer directory must be registered before /:institutionId.
institutionsRouter.get("/officers", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = z.object({ role: JurisdictionRoleSchema }).safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const officers = await listEligibleOfficers(user, parsed.data.role);
    res.status(200).json({ officers });
  } catch (error) {
    next(error);
  }
});

institutionsRouter.get("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listInstitutions(user, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      q: parsed.data.q,
      status: parsed.data.status,
      assignment: parsed.data.assignment,
      role: parsed.data.role,
      officerId: parsed.data.officerId,
      sort: parsed.data.sort,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

institutionsRouter.post("/", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = InstitutionInputSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await createInstitution(user, parsed.data);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

institutionsRouter.get("/:institutionId", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidInstitutionParam();
    const result = await getInstitutionDetail(user, parsed.data.institutionId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

institutionsRouter.patch("/:institutionId", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidInstitutionParam();
    const body = InstitutionInputSchema.safeParse(req.body);
    if (!body.success) throw fromZod(body.error);
    const result = await updateInstitution(user, parsed.data.institutionId, body.data);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

institutionsRouter.post("/:institutionId/status", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidInstitutionParam();
    const body = InstitutionStatusActionSchema.safeParse(req.body);
    if (!body.success) throw fromZod(body.error);
    const result = await setInstitutionStatus(user, parsed.data.institutionId, body.data.status, body.data.note);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

institutionsRouter.post("/:institutionId/assignments", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidInstitutionParam();
    const body = AssignmentUpdateRequestSchema.safeParse(req.body);
    if (!body.success) throw fromZod(body.error);
    await assignOfficer(user, {
      institutionId: parsed.data.institutionId,
      officerId: body.data.officerId,
      role: body.data.role,
      action: body.data.action,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});
