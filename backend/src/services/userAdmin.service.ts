/**
 * System-administration account module: user directory, provisioning with a
 * one-time temporary password, forced first-login change, password reset and
 * deactivation. The temporary password is returned ONCE in the HTTP response
 * and never stored in plaintext again.
 */
import type {
  AccountSummary,
  ProvisionAccountRequest,
  ResetPasswordResponse,
  ProvisionAccountResponse,
  UserListResponse,
  ListUsersQuery,
} from "@sih26265/contracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { revokeAllSessions } from "./auth.service.js";
import { generateTemporaryPassword, hashPassword } from "./auth.service.js";
import { createNotification } from "./notification.service.js";
import { assertAdmin } from "./institution.service.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  designation: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  institutionId: true,
} as const;

type UserRow = {
  id: number;
  email: string;
  fullName: string;
  role: "COLLEGE_USER" | "REVIEW_OFFICER" | "APPROVING_AUTHORITY" | "SYSTEM_ADMIN";
  designation: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  institutionId: number | null;
};

function summarize(row: UserRow): AccountSummary {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    designation: row.designation,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt.toISOString(),
    institutionId: row.institutionId,
  };
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

export interface ListUsersOptions extends ListUsersQuery {
  page: number;
  pageSize: number;
}

export async function listUsers(user: AuthenticatedUser, opts: ListUsersOptions): Promise<UserListResponse> {
  assertAdmin(user);

  const where: Prisma.UserWhereInput = {};
  if (opts.q != null && opts.q.length > 0) {
    where.OR = ["fullName", "email"].map((field) => ({
      [field]: { contains: opts.q, mode: "insensitive" as Prisma.QueryMode },
    }));
  }
  if (opts.role != null) where.role = opts.role;
  if (opts.institutionId != null) where.institutionId = opts.institutionId;
  if (opts.status != null) where.isActive = opts.status === "active";

  const orderBy: Prisma.UserOrderByWithRelationInput =
    opts.sort === "created_asc"
      ? { createdAt: "asc" }
      : opts.sort === "name_asc"
        ? { fullName: "asc" }
        : opts.sort === "name_desc"
          ? { fullName: "desc" }
          : { createdAt: "desc" };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: Math.min(opts.pageSize, 50),
      select: USER_SELECT,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: rows.map(summarize),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Provisioning (college accounts)
// ---------------------------------------------------------------------------

const ACCOUNT_PROVISION_NOTE =
  "Share the one-time temporary password through a verified channel. The account must replace it at first sign-in.";

export async function provisionAccount(
  actor: AuthenticatedUser,
  input: ProvisionAccountRequest,
): Promise<ProvisionAccountResponse> {
  assertAdmin(actor);
  const fieldErrors: Record<string, string[]> = {};

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
    fieldErrors.email = ["Enter a valid email address."];
  }
  if (input.phone != null && !/^[+0-9 ()-]{3,20}$/.test(input.phone)) {
    fieldErrors.phone = ["Enter a valid phone number or leave it empty."];
  }

  const institution = await prisma.institution.findUnique({
    where: { id: input.institutionId },
    select: { id: true, name: true, status: true },
  });
  if (institution == null) {
    fieldErrors.institutionId = ["Select an existing institution."];
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors, "The account needs attention.");
  }

  const duplicate = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (duplicate != null) {
    throw conflict("An account with this email already exists.");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const mustChange = true;

  const provisioned = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        role: "COLLEGE_USER",
        institutionId: input.institutionId,
        designation: input.designation && input.designation.length > 0 ? input.designation : null,
        phone: input.phone && input.phone.length > 0 ? input.phone : null,
        isActive: true,
        mustChangePassword: mustChange,
      },
      select: USER_SELECT,
    });

    await tx.auditEvent.create({
      data: {
        action: "ADMIN_ACCOUNT_PROVISIONED",
        actorUserId: actor.id,
        institutionId: input.institutionId,
        entityType: "user",
        entityId: String(user.id),
        detail: { role: "COLLEGE_USER", note: "Account provisioned with a one-time temporary password" },
      },
    });

    return user;
  });

  await createNotification({
    userId: provisioned.id,
    institutionId: input.institutionId,
    title: "Account created",
    body: "Sign in with the temporary password you received and set your own password.",
    linkPath: null,
  });

  return {
    account: summarize(provisioned),
    temporaryPassword,
    note: ACCOUNT_PROVISION_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Password reset / activation
// ---------------------------------------------------------------------------

export async function resetPassword(actor: AuthenticatedUser, userId: number): Promise<ResetPasswordResponse> {
  assertAdmin(actor);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (target == null) throw notFound("The account does not exist.");
  if (target.role === "SYSTEM_ADMIN") {
    throw forbidden("Administering other administrator accounts is not possible in this sample scope.");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
      select: { id: true },
    });
    await tx.session.updateMany({
      where: { userId, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        action: "ADMIN_PASSWORD_RESET",
        actorUserId: actor.id,
        institutionId: target.institutionId,
        entityType: "user",
        entityId: String(userId),
        detail: { role: target.role, note: "New one-time temporary password issued; all sessions revoked" },
      },
    });
  });

  await createNotification({
    userId,
    institutionId: target.institutionId,
    title: "Password reset",
    body: "Sign in with the new temporary password and set your own password.",
    linkPath: null,
  });

  return {
    account: summarize(target),
    temporaryPassword,
    note: ACCOUNT_PROVISION_NOTE,
  };
}

export async function setAccountStatus(
  actor: AuthenticatedUser,
  userId: number,
  isActive: boolean,
  note: string,
): Promise<AccountSummary> {
  assertAdmin(actor);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (target == null) throw notFound("The account does not exist.");
  if (target.role === "SYSTEM_ADMIN") {
    throw forbidden("Administering other administrator accounts is not possible in this sample scope.");
  }
  if (target.isActive === isActive) {
    throw conflict(`The account is already ${isActive ? "active" : "deactivated"}.`);
  }
  if (!isActive && note.trim().length < 5) {
    throw validationError(
      { note: ["A short reason is required (recorded in the audit trail)."] },
      "The deactivation needs attention.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true },
    });
    if (!isActive) {
      await tx.session.updateMany({
        where: { userId, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      });
    }
    await tx.auditEvent.create({
      data: {
        action: "ADMIN_ACCOUNT_STATUS_CHANGED",
        actorUserId: actor.id,
        institutionId: target.institutionId,
        entityType: "user",
        entityId: String(userId),
        detail: { role: target.role, status: isActive ? "ACTIVE" : "INACTIVE", note: note.trim() },
      },
    });
  });

  if (isActive) {
    await createNotification({
      userId,
      institutionId: target.institutionId,
      title: "Account activated",
      body: "Your account was activated; you can sign in again.",
      linkPath: null,
    });
  }

  const updated = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (updated == null) throw notFound("The account disappeared during the update.");
  return summarize(updated);
}

/** Force-logout helper kept explicit for the admin endpoints (session revocation). */
export async function revokeUserSessions(actor: AuthenticatedUser, userId: number): Promise<number> {
  assertAdmin(actor);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (target == null) throw notFound("The account does not exist.");
  return revokeAllSessions(userId);
}
