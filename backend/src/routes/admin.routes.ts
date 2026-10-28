/**
 * System-administration account endpoints (assertAdmin inside every call):
 * GET  /api/admin/users                      - directory (q/role/institutionId/status/sort)
 * POST /api/admin/users                      - provision a college account; response carries
 *                                              the one-time temporary password exactly once
 * POST /api/admin/users/:id/password-reset   - issue a new temporary password (revokes sessions)
 * POST /api/admin/users/:id/status           - activate/deactivate (reason note required off)
 * POST /api/admin/users/:id/revoke-sessions  - force-logout all sessions of the account
 */
import { Router } from "express";
import { z } from "zod";
import {
  ListUsersQuerySchema,
  ProvisionAccountRequestSchema,
} from "@sih26265/contracts";
import { PageQuerySchema } from "@sih26265/contracts";
import {
  listUsers,
  provisionAccount,
  resetPassword,
  revokeUserSessions,
  setAccountStatus,
} from "../services/userAdmin.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { fromZod, validationError } from "../errors.js";

export const adminRouter = Router();

const IdParamSchema = z.object({ userId: z.coerce.number().int().positive() });
const QuerySchema = z.intersection(ListUsersQuerySchema, PageQuerySchema);
const StatusBodySchema = z.object({
  isActive: z.boolean({ message: "isActive true/false is required" }),
  note: z.string().trim().max(400).optional().default(""),
});

function invalidUserParam(): never {
  throw validationError(
    { userId: ["The account reference is invalid."] },
    "The request path needs attention.",
  );
}

adminRouter.get("/users", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await listUsers(user, {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      q: parsed.data.q,
      role: parsed.data.role,
      institutionId: parsed.data.institutionId,
      status: parsed.data.status,
      sort: parsed.data.sort,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = ProvisionAccountRequestSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    const result = await provisionAccount(user, parsed.data);
    // Temporary password lives only in this response; never stored in plaintext.
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users/:userId/password-reset", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidUserParam();
    const result = await resetPassword(user, parsed.data.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users/:userId/status", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidUserParam();
    const body = StatusBodySchema.safeParse(req.body);
    if (!body.success) throw fromZod(body.error);
    const result = await setAccountStatus(user, parsed.data.userId, body.data.isActive, body.data.note);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users/:userId/revoke-sessions", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) invalidUserParam();
    const revoked = await revokeUserSessions(user, parsed.data.userId);
    res.status(200).json({ revoked });
  } catch (error) {
    next(error);
  }
});
