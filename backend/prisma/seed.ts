/**
 * Synthetic demonstration dataset for SIH26265 Stage 1.
 *
 * SAFETY MODEL (reworked)
 * - OPT-IN ONLY: refuses to run without `--yes` (or SEED_ALLOW_DEMO=true).
 * - NON-DESTRUCTIVE: never wipes; every write is an upsert re-asserting the
 *   demo state keyed by stable codes/emails. Existing rows outside the demo
 *   keys are untouched; nothing is deleted (including sessions/notifications).
 * - REMOTE GUARD: refuses to seed a database on a non-localhost host unless
 *   SEED_ALLOW_REMOTE=true (protects shared Railway development databases).
 * - PRODUCTION GUARD: refuses when NODE_ENV=production unless
 *   SEED_ALLOW_PRODUCTION=true (still strongly discouraged).
 * - Never runs automatically on application start.
 *
 * All dates are relative to the seed run's business date so "approaching
 * maturity" and "overdue" cases stay consistent whenever the demo is seeded.
 * Sample data everywhere is labelled SAMPLE and does not represent real
 * instruments or real regulations.
 */
import { config as loadEnv } from "dotenv";
loadEnv();

import { PrismaClient, type PrismaClient as PrismaClientType } from "@prisma/client";
import bcrypt from "bcryptjs";

// The seed deliberately does NOT import config/env.ts: it may run against
// TEST_DATABASE_URL and keeps its own light env handling.
import { businessToday, addDays, parseLocalDate } from "../src/utils/dates.js";

type Db = PrismaClientType | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const prisma = new PrismaClient();

/** rupees -> integer minor units (paise for INR) */
const paise = (rupees: number): bigint => BigInt(Math.round(rupees * 100));

function demoEmails() {
  return {
    collegeLotus: (process.env.DEMO_COLLEGE_A_EMAIL ?? "college.lotus@demo.fdrportal.local").toLowerCase(),
    collegeShivalik: (process.env.DEMO_COLLEGE_B_EMAIL ?? "college.shivalik@demo.fdrportal.local").toLowerCase(),
    reviewOfficer: (process.env.DEMO_REVIEW_OFFICER_EMAIL ?? "officer.review@demo.fdrportal.local").toLowerCase(),
    approvingAuthority: (process.env.DEMO_APPROVER_EMAIL ?? "authority.approve@demo.fdrportal.local").toLowerCase(),
  };
}

function demoPasswords() {
  return {
    collegeLotus: process.env.DEMO_COLLEGE_A_PASSWORD ?? "Demo#College1",
    collegeShivalik: process.env.DEMO_COLLEGE_B_PASSWORD ?? "Demo#College2",
    reviewOfficer: process.env.DEMO_REVIEW_OFFICER_PASSWORD ?? "Demo#Officer",
    approvingAuthority: process.env.DEMO_APPROVER_PASSWORD ?? "Demo#Authority",
  };
}

function isLocalHost(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

interface FdrSeedDef {
  code: string;
  institution: "lotus" | "shivalik";
  bankName: string;
  bankBranch: string;
  referenceNo: string;
  amountMinor: bigint;
  issueDate: string;
  maturityDate: string;
  remarks?: string;
  status: "verified" | "submitted" | "under_review" | "discrepancy";
  submittedBy: "collegeLotus" | "collegeShivalik";
  submittedDaysAgo?: number;
  verified?: boolean;
}

interface TaskSeedDef {
  key: string;
  type: "VERIFICATION_REVIEW" | "DOCUMENT_CORRECTION" | "RENEWAL_AFTER_MATURITY";
  title: string;
  detail: string;
  status: "OPEN" | "IN_PROGRESS";
  fdrCode: string;
  assignee?: "reviewOfficer";
  assigneeInstitution?: "lotus" | "shivalik";
  dueOffsetDays: number;
}

interface VerificationCheckSeedDef {
  fdrCode: string;
  field: string;
  submittedValue: string;
  observedValue: string;
  source: "SIMULATED_BANK_CHECK" | "MANUAL_OFFICER_REVIEW" | "DOCUMENT_FINGERPRINT";
  outcome: "MATCH" | "MISMATCH" | "SOURCE_UNAVAILABLE" | "MANUAL_REQUIRED" | "NOT_YET_CHECKED";
  reason: string;
  checkedBy?: "reviewOfficer";
}

async function ensureInstitution(db: Db, args: { code: string; name: string; city: string; state: string }) {
  return db.institution.upsert({
    where: { code: args.code },
    update: { name: args.name, city: args.city, state: args.state, isDemo: true, status: "ACTIVE" },
    create: { code: args.code, name: args.name, city: args.city, state: args.state, isDemo: true },
  });
}

async function ensureUser(
  db: Db,
  args: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: "COLLEGE_USER" | "REVIEW_OFFICER" | "APPROVING_AUTHORITY";
    institutionId: number | null;
  },
) {
  return db.user.upsert({
    where: { email: args.email },
    update: {
      passwordHash: args.passwordHash,
      fullName: args.fullName,
      role: args.role,
      institutionId: args.institutionId,
      isActive: true,
    },
    create: {
      email: args.email,
      passwordHash: args.passwordHash,
      fullName: args.fullName,
      role: args.role,
      institutionId: args.institutionId,
    },
  });
}

async function ensureJurisdiction(db: Db, officerId: number, institutionId: number) {
  return db.officerJurisdiction.upsert({
    where: { officerId_institutionId: { officerId, institutionId } },
    update: {},
    create: { officerId, institutionId },
  });
}

async function ensurePolicyRow(db: Db, today: string, approachingWindowDays: number, businessTimezone: string) {
  return db.policyVersion.upsert({
    where: { key_versionLabel: { key: "deadline-monitoring", versionLabel: "sample-v0.1" } },
    update: { effectiveFrom: parseLocalDate(today) },
    create: {
      key: "deadline-monitoring",
      versionLabel: "sample-v0.1",
      effectiveFrom: parseLocalDate(today),
      config: {
        approachingWindowDays,
        reminderThresholdsDays: [30, 14, 7],
        escalationStages: ["reviewing_officer", "approving_authority"],
        businessTimezone,
      },
      notes:
        "SAMPLE DEMONSTRATION POLICY. Thresholds are illustrative placeholders, not official AICTE regulations. Confirmed rules, when available, enter as a new version.",
      isSample: true,
    },
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const isProduction = (process.env.NODE_ENV ?? "development") === "production";

  // --- opt-in + guards -------------------------------------------------------
  const accepted = process.argv.includes("--yes") || process.env.SEED_ALLOW_DEMO === "true";
  if (!accepted) {
    console.error([
      "REFUSED: demo seeding must be explicitly requested.",
      "Run: npm run db:seed -- --yes (or set SEED_ALLOW_DEMO=true).",
      "The seed only upserts demo rows (nothing is deleted), but never run it unattended on a shared database.",
    ].join("\n"));
    process.exit(1);
  }
  if (!isLocalHost(databaseUrl) && process.env.SEED_ALLOW_REMOTE !== "true") {
    const host = (() => {
      try {
        return new URL(databaseUrl).hostname;
      } catch {
        return "(unparseable)";
      }
    })();
    console.error(
      `REFUSED: DATABASE_URL points at the non-local host "${host}".\n` +
        "Re-run with SEED_ALLOW_REMOTE=true only if you really want demo rows there (do not use the shared production database).",
    );
    process.exit(1);
  }
  if (isProduction && process.env.SEED_ALLOW_PRODUCTION !== "true") {
    console.error(
      "REFUSED: seeding in production requires SEED_ALLOW_PRODUCTION=true. Synthetic demo accounts must not enter a production environment.",
    );
    process.exit(1);
  }

  const today = businessToday();
  const businessTimezone = process.env.BUSINESS_TIMEZONE ?? "Asia/Kolkata";

  console.log(`Seeding demo data (upsert-only, no deletes) into ${isLocalHost(databaseUrl) ? "local database" : "REMOTE DATABASE (SEED_ALLOW_REMOTE=true)"}...`);

  // --- Institutions ----------------------------------------------------------
  const lotus = await ensureInstitution(prisma, {
    code: "DEMO-LOTUS-IT",
    name: "Lotus Institute of Technology",
    city: "Pune",
    state: "Maharashtra",
  });
  const shivalik = await ensureInstitution(prisma, {
    code: "DEMO-SHIV-ENGG",
    name: "Shivalik Engineering College",
    city: "Ropar",
    state: "Punjab",
  });

  // --- Users -----------------------------------------------------------------
  const emails = demoEmails();
  const passwords = demoPasswords();
  const hashList = await Promise.all(Object.values(passwords).map((value) => bcrypt.hash(value, 12)));
  const [hashA, hashB, hashO, hashP] = hashList;

  const collegeLotus = await ensureUser(prisma, {
    email: emails.collegeLotus,
    passwordHash: hashA,
    fullName: "Dr. Meera Joshi (Registrar, Lotus)",
    role: "COLLEGE_USER",
    institutionId: lotus.id,
  });
  const collegeShivalik = await ensureUser(prisma, {
    email: emails.collegeShivalik,
    passwordHash: hashB,
    fullName: "Prof. Anil Thakur (Registrar, Shivalik)",
    role: "COLLEGE_USER",
    institutionId: shivalik.id,
  });
  const reviewOfficer = await ensureUser(prisma, {
    email: emails.reviewOfficer,
    passwordHash: hashO,
    fullName: "Officer R. Deshpande",
    role: "REVIEW_OFFICER",
    institutionId: null,
  });
  const approvingAuthority = await ensureUser(prisma, {
    email: emails.approvingAuthority,
    passwordHash: hashP,
    fullName: "Authority S. Iyer",
    role: "APPROVING_AUTHORITY",
    institutionId: null,
  });

  for (const officer of [reviewOfficer, approvingAuthority]) {
    for (const institution of [lotus, shivalik]) {
      await ensureJurisdiction(prisma, officer.id, institution.id);
    }
  }

  // --- Sample policy row (explicitly labelled sample configuration) ----------
  await ensurePolicyRow(prisma, today, 30, businessTimezone);

  // --- FDR instruments -------------------------------------------------------
  interface MakeFdrArgs extends Omit<FdrSeedDef, "institution" | "submittedBy"> {
    institutionId: number;
    submittedById: number;
    previousFdrId?: number;
  }
  const makeFdr = async (args: MakeFdrArgs) =>
    prisma.fdr.upsert({
      where: { publicCode: args.code },
      update: {
        bankName: args.bankName,
        bankBranch: args.bankBranch,
        referenceNo: args.referenceNo,
        amountMinor: args.amountMinor,
        currency: "INR",
        issueDate: parseLocalDate(args.issueDate),
        maturityDate: parseLocalDate(args.maturityDate),
        remarks: args.remarks ?? null,
        status: args.status,
      },
      create: {
        publicCode: args.code,
        institutionId: args.institutionId,
        bankName: args.bankName,
        bankBranch: args.bankBranch,
        referenceNo: args.referenceNo,
        amountMinor: args.amountMinor,
        currency: "INR",
        issueDate: parseLocalDate(args.issueDate),
        maturityDate: parseLocalDate(args.maturityDate),
        remarks: args.remarks ?? null,
        status: args.status,
        previousFdrId: args.previousFdrId ?? null,
        submittedAt: new Date(Date.now() - (args.submittedDaysAgo ?? 14) * 86_400_000),
        verifiedAt: args.status === "verified" ? new Date(Date.now() - 10 * 86_400_000) : null,
        versions: {
          create: {
            versionNo: 1,
            bankName: args.bankName,
            bankBranch: args.bankBranch,
            referenceNo: args.referenceNo,
            amountMinor: args.amountMinor,
            currency: "INR",
            issueDate: parseLocalDate(args.issueDate),
            maturityDate: parseLocalDate(args.maturityDate),
            remarks: args.remarks ?? null,
            submittedById: args.submittedById,
          },
        },
      },
    });

  const fdr0001 = await makeFdr({
    code: "FDR-2026-0001",
    institutionId: lotus.id,
    bankName: "State Bank of India",
    bankBranch: "Model Colony, Pune",
    referenceNo: "SBIN/2026/000831",
    amountMinor: paise(5_000_000), // 50,00,000 rupees
    issueDate: addDays(today, -420),
    maturityDate: addDays(today, 400),
    remarks: "Security deposit for approval cycle 2026-27.",
    status: "verified",
    submittedById: collegeLotus.id,
  });

  const fdr0002 = await makeFdr({
    code: "FDR-2026-0002",
    institutionId: lotus.id,
    bankName: "Bank of Baroda",
    bankBranch: "Karve Road, Pune",
    referenceNo: "BOB/2026/110244",
    amountMinor: paise(1_000_00), // 1,00,000 rupees
    issueDate: addDays(today, -150),
    maturityDate: addDays(today, 215),
    status: "submitted",
    submittedById: collegeLotus.id,
    submittedDaysAgo: 2,
  });

  const fdr0003 = await makeFdr({
    code: "FDR-2026-0003",
    institutionId: lotus.id,
    bankName: "Punjab National Bank",
    bankBranch: "Shivajinagar, Pune",
    referenceNo: "PNB/2026/771003",
    amountMinor: paise(7_50_00), // 7,50,000 rupees
    issueDate: addDays(today, -90),
    maturityDate: addDays(today, 275),
    status: "under_review",
    submittedById: collegeLotus.id,
    submittedDaysAgo: 5,
  });

  const fdr0004 = await makeFdr({
    code: "FDR-2026-0004",
    institutionId: lotus.id,
    bankName: "Canara Bank",
    bankBranch: "Aundh, Pune",
    referenceNo: "CNRB/2026/409477",
    amountMinor: paise(4_00_00), // 4,00,000 rupees
    issueDate: addDays(today, -180),
    maturityDate: addDays(today, 185),
    remarks:
      "SAMPLE DATA: college submittedRs 4,00,000; simulated source observedRs 2,00,000. Correction requested; verification reopens after the correction.",
    status: "discrepancy",
    submittedById: collegeLotus.id,
    submittedDaysAgo: 9,
  });

  const fdr0005 = await makeFdr({
    code: "FDR-2026-0005",
    institutionId: lotus.id,
    bankName: "HDFC Bank",
    bankBranch: "FC Road, Pune",
    referenceNo: "HDFC/2026/33812",
    amountMinor: paise(3_00_00),
    issueDate: addDays(today, -353),
    maturityDate: addDays(today, 12), // approaching maturity inside the sample window
    status: "verified",
    submittedById: collegeLotus.id,
  });

  const fdr0006 = await makeFdr({
    code: "FDR-2026-0006",
    institutionId: lotus.id,
    bankName: "Union Bank of India",
    bankBranch: "Kothrud, Pune",
    referenceNo: "UBIN/2025/660221",
    amountMinor: paise(4_00_00),
    issueDate: addDays(today, -720),
    maturityDate: addDays(today, -20), // matured
    status: "verified",
    submittedById: collegeLotus.id,
  });

  const fdr0007 = await makeFdr({
    code: "FDR-2026-0007",
    institutionId: lotus.id,
    bankName: "Union Bank of India",
    bankBranch: "Kothrud, Pune",
    referenceNo: "UBIN/2026/771450",
    amountMinor: paise(4_00_00),
    issueDate: addDays(today, -2),
    maturityDate: addDays(today, 363),
    remarks:
      "Replacement for matured UBIN/2025/660221. SAMPLE: pending verification - the upload alone does NOT complete the renewal.",
    status: "submitted",
    submittedById: collegeLotus.id,
    submittedDaysAgo: 1,
    previousFdrId: fdr0006.id,
  });

  const fdr0008 = await makeFdr({
    code: "FDR-2026-0008",
    institutionId: shivalik.id,
    bankName: "State Bank of India",
    bankBranch: "Ropar Main Branch",
    referenceNo: "SBIN/PB/2026/2044",
    amountMinor: paise(12_50_00),
    issueDate: addDays(today, -500),
    maturityDate: addDays(today, 230),
    status: "verified",
    submittedById: collegeShivalik.id,
  });

  const fdr0009 = await makeFdr({
    code: "FDR-2026-0009",
    institutionId: shivalik.id,
    bankName: "Axis Bank",
    bankBranch: "Ropar Market Branch",
    referenceNo: "AXIS/2026/88127",
    amountMinor: paise(6_00_00),
    issueDate: addDays(today, -40),
    maturityDate: addDays(today, 325),
    status: "submitted",
    submittedById: collegeShivalik.id,
    submittedDaysAgo: 3,
  });

  void fdr0001;
  void fdr0008;

  // --- Verification evidence (only seeded when absent - checks are append-only)
  const checkDefs: (VerificationCheckSeedDef & { fdrId: number; checkedById?: number })[] = [
    {
      fdrCode: "FDR-2026-0004",
      fdrId: fdr0004.id,
      field: "amount",
      submittedValue: "INR 400000",
      observedValue: "INR 200000",
      source: "SIMULATED_BANK_CHECK",
      outcome: "MISMATCH",
      reason: "Simulated bank check reports a different deposit amount. (SAMPLE / SIMULATED LABEL REQUIRED IN UI)",
      checkedById: reviewOfficer.id,
    },
  ];

  for (const def of checkDefs) {
    const existing = await prisma.verificationCheck.findFirst({
      where: { fdrId: def.fdrId, fdrVersionNo: 1, field: def.field, source: def.source },
      select: { id: true },
    });
    if (existing == null) {
      await prisma.verificationCheck.create({
        data: {
          fdrId: def.fdrId,
          fdrVersionNo: 1,
          field: def.field,
          submittedValue: def.submittedValue,
          observedValue: def.observedValue,
          source: def.source,
          outcome: def.outcome,
          reason: def.reason,
          checkedById: def.checkedById ?? null,
        },
      });
    }
  }

  // --- Open work (deduplicated by stable keys so re-seeding cannot duplicate) -
  const taskDefs: (TaskSeedDef & { fdrId: number; assigneeUserId?: number; assigneeInstitutionId?: number })[] = [
    {
      key: "SEED:REVIEW:2026-0002",
      type: "VERIFICATION_REVIEW",
      title: "Review submission FDR-2026-0002",
      detail: "Verify bank details and run the (simulated) source check.",
      status: "OPEN",
      fdrCode: "FDR-2026-0002",
      fdrId: fdr0002.id,
      assigneeUserId: reviewOfficer.id,
      dueOffsetDays: 5,
    },
    {
      key: "SEED:REVIEW:2026-0003",
      type: "VERIFICATION_REVIEW",
      title: "Continue review FDR-2026-0003",
      detail: "One manual check outstanding; complete recording of evidence.",
      status: "IN_PROGRESS",
      fdrCode: "FDR-2026-0003",
      fdrId: fdr0003.id,
      assigneeUserId: reviewOfficer.id,
      dueOffsetDays: 2,
    },
    {
      key: "SEED:CORRECTION:2026-0004",
      type: "DOCUMENT_CORRECTION",
      title: "Correct deposited amount on FDR-2026-0004",
      detail:
        "Simulated source observedRs 2,00,000 vs submittedRs 4,00,000 (SAMPLE DATA). Provide a corrected document; this creates a new version and re-opens verification.",
      status: "OPEN",
      fdrCode: "FDR-2026-0004",
      fdrId: fdr0004.id,
      assigneeInstitutionId: lotus.id,
      dueOffsetDays: 7,
    },
    {
      key: "SEED:RENEWAL:2026-0006",
      type: "RENEWAL_AFTER_MATURITY",
      title: "Renew matured receipt FDR-2026-0006",
      detail:
        "Maturity date passed. Submit a replacement or bank renewal evidence. A replacement upload alone does not close this task - authorised acceptance does.",
      status: "OPEN",
      fdrCode: "FDR-2026-0006",
      fdrId: fdr0006.id,
      assigneeInstitutionId: lotus.id,
      dueOffsetDays: -5, // overdue on purpose
    },
    {
      key: "SEED:RENEWAL:2026-0005",
      type: "RENEWAL_AFTER_MATURITY",
      title: "Prepare renewal for FDR-2026-0005",
      detail: "Maturity approaching; arrange a fresh FDR before the maturity date.",
      status: "OPEN",
      fdrCode: "FDR-2026-0005",
      fdrId: fdr0005.id,
      assigneeInstitutionId: lotus.id,
      dueOffsetDays: 10,
    },
    {
      key: "SEED:REVIEW:2026-0007-REPLACEMENT",
      type: "VERIFICATION_REVIEW",
      title: "Review replacement FDR-2026-0007",
      detail:
        "Replacement for matured FDR-2026-0006. Verify, then the approving authority must accept the replacement; only that closes the renewal obligation.",
      status: "OPEN",
      fdrCode: "FDR-2026-0007",
      fdrId: fdr0007.id,
      assigneeUserId: reviewOfficer.id,
      dueOffsetDays: 14,
    },
    {
      key: "SEED:REVIEW:2026-0009",
      type: "VERIFICATION_REVIEW",
      title: "Review submission FDR-2026-0009",
      detail: "Verify Shivalik Engineering College submission.",
      status: "OPEN",
      fdrCode: "FDR-2026-0009",
      fdrId: fdr0009.id,
      assigneeUserId: reviewOfficer.id,
      dueOffsetDays: 6,
    },
  ];

  for (const def of taskDefs) {
    await prisma.task.upsert({
      where: { deduplicationKey: def.key },
      update: {
        title: def.title,
        detail: def.detail,
        status: def.status,
        dueDate: parseLocalDate(addDays(today, def.dueOffsetDays)),
        assigneeUserId: def.assigneeUserId ?? null,
        assigneeInstitutionId: def.assigneeInstitutionId ?? null,
      },
      create: {
        fdrId: def.fdrId,
        type: def.type,
        title: def.title,
        detail: def.detail,
        status: def.status,
        assigneeUserId: def.assigneeUserId ?? null,
        assigneeInstitutionId: def.assigneeInstitutionId ?? null,
        dueDate: parseLocalDate(addDays(today, def.dueOffsetDays)),
        deduplicationKey: def.key,
        createdByJob: false,
        policyVersion: "sample-v0.1",
      },
    });
  }

  await prisma.auditEvent.create({
    data: {
      action: "SEED_DEMO_DATA",
      detail: {
        note: "Synthetic demonstration dataset re-asserted (upsert-only; no rows deleted).",
        institutions: [lotus.code, shivalik.code],
      },
      institutionId: lotus.id,
    },
  });

  void approvingAuthority;

  console.log("Seed complete (demo data upserted; no rows deleted).");
  console.log("Demo credentials live in backend/.env under the DEMO_* keys.");
  console.log("Institutions:", lotus.code, shivalik.code);
  console.log("REMINDER: all demo rows are SAMPLE data - not real instruments and not official AICTE rules.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
