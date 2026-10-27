/** Fixture builders + supertest helpers shared across tests. */
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { prisma } from "./db.js";
import { createApp } from "../../src/app.js";
import { addDays, businessToday, parseLocalDate } from "../../src/utils/dates.js";

export const DEMO_PASSWORD = "Strong#Pass99";

export type SupertestAgent = ReturnType<typeof request.agent>;

export interface InstitutionRowFixture {
  id: number;
  code: string;
  name: string;
}

export async function createInstitution(index: number): Promise<InstitutionRowFixture> {
  const row = await prisma.institution.create({
    data: { code: `TEST-INST-${index}`, name: `Test Institution ${index}`, isDemo: false },
  });
  return { id: row.id, code: row.code, name: row.name };
}

export async function createUser(args: {
  email: string;
  role: "COLLEGE_USER" | "REVIEW_OFFICER" | "APPROVING_AUTHORITY";
  institutionId?: number | null;
  fullName?: string;
  isActive?: boolean;
}): Promise<{ id: number; email: string }> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const row = await prisma.user.create({
    data: {
      email: args.email,
      passwordHash,
      fullName: args.fullName ?? "Test User",
      role: args.role,
      institutionId: args.institutionId ?? null,
      isActive: args.isActive ?? true,
    },
  });
  return { id: row.id, email: row.email };
}

export async function grantJurisdiction(officerId: number, institutionId: number): Promise<void> {
  await prisma.officerJurisdiction.create({ data: { officerId, institutionId } });
}

export function appInstance(): Express {
  return createApp();
}

export async function loginAgent(
  app: Express,
  email: string,
  context: "college" | "officer",
  password = DEMO_PASSWORD,
): Promise<SupertestAgent> {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password, context });
  if (response.status !== 200) {
    throw new Error(
      `loginAgent failed (${response.status}): ${JSON.stringify(response.body ?? {})}`,
    );
  }
  return agent;
}

/** A receipt-shaped FDR row builder for read-model tests. */
export async function createFdr(args: {
  institutionId: number;
  publicCode: string;
  status?: "draft" | "submitted" | "under_review" | "discrepancy" | "verified";
  maturityInDays: number;
  issueInDays?: number;
  bankName?: string;
  referenceNo?: string;
  amountMinor?: bigint;
  createdById?: number | null;
  previousFdrId?: number;
  supersededById?: number;
}) {
  // Dates are anchored on the BUSINESS-timezone calendar - exactly how the
  // services derive "today" - so tests are correct at all hours (a UTC-based
  // fixture runs one day behind business dates between 00:00 and 05:30 IST).
  const today = businessToday();
  const asDate = (offsetDays: number) => parseLocalDate(addDays(today, offsetDays));

  const row = await prisma.fdr.create({
    data: {
      institutionId: args.institutionId,
      publicCode: args.publicCode,
      bankName: args.bankName ?? "Test Bank",
      bankBranch: "Main branch",
      referenceNo: args.referenceNo ?? `REF-${args.publicCode}`,
      amountMinor: args.amountMinor ?? 100_000_00n,
      currency: "INR",
      issueDate: asDate(args.issueInDays ?? -30),
      maturityDate: asDate(args.maturityInDays),
      status: args.status ?? "verified",
      previousFdrId: args.previousFdrId ?? null,
      supersededByFdrId: args.supersededById ?? null,
      submittedAt: args.status == null || args.status !== "draft" ? new Date() : null,
      versions: {
        create: {
          versionNo: 1,
          bankName: args.bankName ?? "Test Bank",
          bankBranch: "Main branch",
          referenceNo: args.referenceNo ?? `REF-${args.publicCode}`,
          amountMinor: args.amountMinor ?? 100_000_00n,
          currency: "INR",
          issueDate: asDate(args.issueInDays ?? -30),
          maturityDate: asDate(args.maturityInDays),
        },
      },
    },
  });
  return row;
}

export async function createTask(args: {
  type: "VERIFICATION_REVIEW" | "DOCUMENT_CORRECTION" | "RENEWAL_AFTER_MATURITY";
  title: string;
  assigneeInstitutionId?: number;
  assigneeUserId?: number;
  dueInDays: number;
  fdrId?: number;
  status?: "OPEN" | "IN_PROGRESS";
  deduplicationKey?: string;
  createdByJob?: boolean;
}) {
  const due = parseLocalDate(addDays(businessToday(), args.dueInDays));
  return prisma.task.create({
    data: {
      fdrId: args.fdrId,
      type: args.type,
      title: args.title,
      status: args.status ?? "OPEN",
      assigneeInstitutionId: args.assigneeInstitutionId,
      assigneeUserId: args.assigneeUserId,
      dueDate: due,
      deduplicationKey: args.deduplicationKey,
      createdByJob: args.createdByJob ?? false,
    },
  });
}
