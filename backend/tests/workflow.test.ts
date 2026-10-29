/**
 * Stage-2 acceptance scenarios, end to end against fdr_portal_test
 * (never the development database; guards re-checked in helpers/db.ts):
 *
 * 1. Submission -> review -> simulated evidence checks -> verify
 * 2. Correction -> new immutable version + invalidation of affected checks
 * 3. Replacement lifecycle: recommend -> accept establishes the supersession
 * 4. Release lifecycle: request -> recommend -> approve -> completion evidence
 * 5. Admin provisioning: one-time temporary password -> forced change
 * 6. Isolation and role negatives (compact)
 *
 * SAMPLE policies are labelled in payloads; the assertions check the server's
 * deterministic, recorded facts only (no random behaviour anywhere).
 */
import { beforeEach, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { dbDescribe, DB_TESTS_ENABLED } from "./helpers/guards.js";
import { resetDatabase, prisma } from "./helpers/db.js";
import {
  appInstance,
  createFdr,
  createInstitution,
  createUser,
  grantJurisdiction,
  loginAgent,
  type SupertestAgent,
} from "./helpers/scenario.js";

const app: Express = appInstance();

const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(512, 0x41)]);

interface Fixture {
  instA: { id: number };
  instB: { id: number };
  collegeA: { id: number; email: string };
  collegeB: { id: number; email: string };
  officer: { id: number; email: string };
  approver: { id: number; email: string };
  admin: { id: number; email: string };
}

let fx: Fixture;
let seq = 0;

beforeEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  seq = 0;
  await resetDatabase();
  const instA = await createInstitution(1001);
  const instB = await createInstitution(1002);
  const collegeA = await createUser({ email: `wa-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: instA.id });
  const collegeB = await createUser({ email: `wb-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: instB.id });
  const officer = await createUser({ email: `wo-${Date.now()}@example.test`, role: "REVIEW_OFFICER" });
  const approver = await createUser({ email: `wp-${Date.now()}@example.test`, role: "APPROVING_AUTHORITY" });
  const admin = await createUser({ email: `wd-${Date.now()}@example.test`, role: "SYSTEM_ADMIN" });
  await grantJurisdiction(officer.id, instA.id);
  await grantJurisdiction(approver.id, instA.id, "APPROVING_AUTHORITY");
  fx = { instA, instB, collegeA, collegeB, officer, approver, admin };
});

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function draftPayload(): Record<string, unknown> {
  seq += 1;
  const year = 2026;
  return {
    instrumentType: "SECURITY_DEPOSIT",
    bankName: `Acceptance Bank ${seq}`,
    bankBranch: "M G Road Branch",
    referenceNo: `FDR-ACC-${seq}-${Date.now()}`,
    amountRupees: "100000.55",
    issueDate: `${year - 1}-11-01`,
    maturityDate: `${year}-11-01`,
    ifsc: "SBIN0001234",
    beneficiaryName: "Institution Fixed Deposit Account",
    remarks: "Acceptance scenario instrument.",
  };
}

async function createSubmittedCase(agent: SupertestAgent, replacesFdrId?: number): Promise<number> {
  const query = replacesFdrId == null ? "" : `?replacesFdrId=${replacesFdrId}`;
  const created = await agent.post(`/api/fdrs${query}`).send(draftPayload());
  expect(created.status, `draft create failed: ${JSON.stringify(created.body)}`).toBe(201);
  const fdrId = created.body.fdrId as number;
  expect(fdrId).toBeGreaterThan(0);

  const upload = await agent
    .post(`/api/fdrs/${fdrId}/documents`)
    .attach("file", PDF_BYTES, { filename: "receipt scan.pdf", contentType: "application/pdf" });
  expect(upload.status, `upload failed: ${JSON.stringify(upload.body)}`).toBe(201);

  const submitted = await agent.post(`/api/fdrs/${fdrId}/submit`);
  expect(submitted.status, `submit failed: ${JSON.stringify(submitted.body)}`).toBe(200);
  expect(submitted.body.versionNo).toBe(1);
  return fdrId;
}

/** Officer records the three required checks; amount via the simulated bank. */
async function recordRequiredChecks(agent: SupertestAgent, fdrId: number, amountDisplay = "100000.55"): Promise<void> {
  const simulated = await agent.post(`/api/fdrs/${fdrId}/checks`).send({
    field: "amount",
    source: "SIMULATED_BANK_CHECK",
    observedValue: amountDisplay,
  });
  expect(simulated.status, `amount check failed: ${JSON.stringify(simulated.body)}`).toBe(200);

  for (const field of ["reference_no", "bank_name"]) {
    const manual = await agent.post(`/api/fdrs/${fdrId}/checks`).send({
      field,
      source: "MANUAL_OFFICER_REVIEW",
      outcome: "MATCH",
    });
    expect(manual.status, `${field} check failed: ${JSON.stringify(manual.body)}`).toBe(200);
  }

  // The simulated bank check derives its outcome server-side (deterministic,
  // never random): the current version now has a MATCH amount check.
  const detail = await agent.get(`/api/cases/${fdrId}`);
  const amountCheck = detail.body.checks.find(
    (c: { field: string; invalidatedAt: string | null }) => c.field === "amount" && c.invalidatedAt == null,
  );
  expect(amountCheck).toBeDefined();
  expect(amountCheck.outcome).toBe("MATCH");
}

/** Full officer pass over a submitted case: start review, check, verify. */
async function reviewToVerified(agent: SupertestAgent, fdrId: number, amountDisplay = "100000.55"): Promise<void> {
  const started = await agent.post(`/api/fdrs/${fdrId}/review/start`).send({ fdrId });
  expect(started.status).toBe(200);
  await recordRequiredChecks(agent, fdrId, amountDisplay);
  const verified = await agent.post(`/api/fdrs/${fdrId}/verify`).send({ note: "Acceptance pass." });
  expect(verified.status).toBe(200);
  const detail = await agent.get(`/api/cases/${fdrId}`);
  expect(detail.body.status).toBe("verified");
}

// ---------------------------------------------------------------------------
// 1. Submission -> review -> checks -> verify
// ---------------------------------------------------------------------------

dbDescribe("acceptance: submission and verification", () => {
  it("college submits, officer verifies through the recorded checks", async () => {
    if (!DB_TESTS_ENABLED) return;
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const fdrId = await createSubmittedCase(college);

    const detail = await college.get(`/api/cases/${fdrId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe("submitted");
    expect(detail.body.currentVersionNo).toBe(1);
    expect(detail.body.currentVersion.amount).toEqual({ currency: "INR", amountMinor: "10000055" });

    const officer = await loginAgent(app, fx.officer.email, "officer");
    const started = await officer.post(`/api/fdrs/${fdrId}/review/start`).send({ fdrId });
    expect(started.status).toBe(200);

    // Verification is refused with the remaining blockers while checks are missing.
    const earlyVerify = await officer.post(`/api/fdrs/${fdrId}/verify`).send({ note: "" });
    expect(earlyVerify.status).toBe(409);
    expect(JSON.stringify(earlyVerify.body)).toContain("blocker");

    await recordRequiredChecks(officer, fdrId);
    const verified = await officer.post(`/api/fdrs/${fdrId}/verify`).send({ note: "Checks all matched." });
    expect(verified.status).toBe(200);

    const after = await officer.get(`/api/cases/${fdrId}`);
    expect(after.body.status).toBe("verified");
    expect(after.body.verifiedAt).not.toBeNull();

    // The simulated bank check derived its outcome server-side (deterministic).
    const amountCheck = after.body.checks.find((c: { field: string }) => c.field === "amount");
    expect(amountCheck.outcome).toBe("MATCH");
    expect(amountCheck.submittedValue).toBe("100000.55");
    expect(amountCheck.observedValue).toBe("100000.55");

    // A mismatching simulated check is also derived, never random.
    await officer.post(`/api/fdrs/${fdrId}/checks`).send({
      field: "bank_name",
      source: "SIMULATED_BANK_CHECK",
      observedValue: "Some Other Bank",
    });
    const afterMismatch = await officer.get(`/api/cases/${fdrId}`);
    const latestBankCheck = afterMismatch.body.checks
      .filter((c: { field: string; source: string }) => c.field === "bank_name" && c.source === "SIMULATED_BANK_CHECK")
      .at(-1);
    expect(latestBankCheck.outcome).toBe("MISMATCH");
  });

  it("submission requires a supporting document (SAMPLE rule)", async () => {
    if (!DB_TESTS_ENABLED) return;
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const created = await college.post("/api/fdrs").send(draftPayload());
    expect(created.status).toBe(201);
    const refused = await college.post(`/api/fdrs/${created.body.fdrId}/submit`);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(/document/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Corrections create a new version and invalidate affected checks
// ---------------------------------------------------------------------------

dbDescribe("acceptance: corrections and versions", () => {
  it("officer-requested correction response becomes version 2 and invalidates the amount check", async () => {
    if (!DB_TESTS_ENABLED) return;
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const fdrId = await createSubmittedCase(college);

    const officer = await loginAgent(app, fx.officer.email, "officer");
    await officer.post(`/api/fdrs/${fdrId}/review/start`).send({ fdrId });
    await recordRequiredChecks(officer, fdrId);

    // Officer asks the college to correct the amount (reason per field).
    const requested = await officer.post("/api/corrections").send({
      fdrId,
      fields: [{ field: "amount", reason: "Amount differs from the simulated bank advice." }],
      note: "Please re-check the amount against the bank advice.",
    });
    expect(requested.status).toBe(200);
    const listed = await officer.get(`/api/corrections`).query({ fdrId, status: "OPEN" });
    const correctionId = listed.body.items[0]?.id as number | undefined;
    expect(correctionId).toBeGreaterThan(0);

    // College answers; the response is one transaction creating version 2.
    const responded = await college.post("/api/corrections/respond").send({
      correctionId,
      values: [{ field: "amount", value: "250000.00" }],
      note: "Corrected to the bank-advised amount.",
    });
    expect(responded.status).toBe(200);

    const detail = await officer.get(`/api/cases/${fdrId}`);
    expect(detail.body.currentVersionNo).toBe(2);
    expect(detail.body.currentVersion.amount).toEqual({ currency: "INR", amountMinor: "25000000" });
    expect(detail.body.versions).toHaveLength(2);
    // The version-1 snapshot stays immutable.
    expect(detail.body.versions.find((v: { versionNo: number }) => v.versionNo === 1).amount.amountMinor).toBe("10000055");

    // The pre-correction amount check is invalidated, not deleted.
    const amountChecks = detail.body.checks.filter((c: { field: string }) => c.field === "amount");
    const invalidated = amountChecks.filter((c: { invalidatedAt: string | null }) => c.invalidatedAt != null);
    expect(invalidated.length).toBeGreaterThanOrEqual(1);
    // The other checks on unchanged fields survive.
    const surviving = detail.body.checks.find(
      (c: { field: string; invalidatedAt: string | null }) => c.field === "reference_no" && c.invalidatedAt == null,
    );
    expect(surviving).toBeDefined();

    // After a fresh amount check the case verifies again.
    await recordRequiredChecks(officer, fdrId, "250000.00");
    const verified = await officer.post(`/api/fdrs/${fdrId}/verify`).send({ note: "Re-verified after correction." });
    expect(verified.status).toBe(200);
    const final = await officer.get(`/api/cases/${fdrId}`);
    expect(final.body.status).toBe("verified");
  });

  it("only the reviewing officer can raise and cancel; the college cannot", async () => {
    if (!DB_TESTS_ENABLED) return;
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const fdrId = await createSubmittedCase(college);
    const officer = await loginAgent(app, fx.officer.email, "officer");
    await officer.post(`/api/fdrs/${fdrId}/review/start`).send({ fdrId });

    const forbidden = await college.post("/api/corrections").send({
      fdrId,
      fields: [{ field: "bank_name", reason: "College cannot self-request." }],
    });
    expect(forbidden.status).toBe(403);

    const requested = await officer.post("/api/corrections").send({
      fdrId,
      fields: [{ field: "bank_name", reason: "Bank name differs from the advice." }],
    });
    expect(requested.status).toBe(200);
    const listed = await officer.get(`/api/corrections`).query({ fdrId, status: "OPEN" });
    const correctionId = listed.body.items[0]?.id as number | undefined;
    expect(correctionId).toBeGreaterThan(0);

    const cancelled = await college.post(`/api/corrections/${correctionId}/cancel`);
    expect(cancelled.status).toBe(403);
    const officerCancel = await officer.post(`/api/corrections/${correctionId}/cancel`);
    expect(officerCancel.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3. Replacement lifecycle
// ---------------------------------------------------------------------------

dbDescribe("acceptance: replacement of a matured instrument", () => {
  it("recommend + accept establishes the supersession; reject does not", async () => {
    if (!DB_TESTS_ENABLED) return;
    // Predecessor: verified and matured, created directly as a fixture.
    const previous = await createFdr({
      institutionId: fx.instA.id,
      publicCode: `PREV-${Date.now()}`,
      status: "verified",
      maturityInDays: -10,
      issueInDays: -400,
    });

    const college = await loginAgent(app, fx.collegeA.email, "college");
    const replacementId = await createSubmittedCase(college, previous.id);

    const officer = await loginAgent(app, fx.officer.email, "officer");
    await reviewToVerified(officer, replacementId);

    // Before the authority accepts, no supersession exists.
    const before = await officer.get(`/api/cases/${replacementId}`);
    expect(before.body.previousFdr?.supersededByFdrId).toBeNull();

    const recommended = await officer.post("/api/replacements/recommend").send({
      fdrId: replacementId,
      note: "Verified replacement of the matured instrument.",
    });
    expect(recommended.status).toBe(200);

    // The authority accepts; supersession is now a recorded fact.
    const approver = await loginAgent(app, fx.approver.email, "officer");
    const accepted = await approver.post("/api/replacements/accept").send({
      fdrId: replacementId,
    });
    expect(accepted.status).toBe(200);

    const after = await officer.get(`/api/cases/${replacementId}`);
    expect(after.body.previousFdr?.supersededByFdrId).toBe(replacementId);
    expect(after.body.previousFdr?.id).toBe(previous.id);

    const queue = await officer.get("/api/replacements");
    const item = queue.body.items.find((r: { fdrId: number }) => r.fdrId === replacementId);
    expect(item?.stage).toBe("accepted");

    // The college cannot accept its own replacement.
    const collegeFdr = await createSubmittedCase(college);
    const selfAccept = await college.post("/api/replacements/accept").send({ fdrId: collegeFdr });
    expect([403, 404]).toContain(selfAccept.status);
  });
});

// ---------------------------------------------------------------------------
// 4. Release lifecycle
// ---------------------------------------------------------------------------

dbDescribe("acceptance: release with completion evidence", () => {
  it("request -> recommend -> approve -> complete records the external refund evidence", async () => {
    if (!DB_TESTS_ENABLED) return;
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const fdrId = await createSubmittedCase(college);
    const officer = await loginAgent(app, fx.officer.email, "officer");
    await reviewToVerified(officer, fdrId);

    const opened = await college.post("/api/releases").send({
      fdrId,
      reason: "The deposit matured and the institution requests the refund.",
      evidenceType: "ORIGINAL_FDR_RECEIPT",
      evidenceRef: "RCPT-2026-11",
    });
    expect(opened.status, `release create failed: ${JSON.stringify(opened.body)}`).toBe(201);
    // The create response carries no id; the list endpoint is the source of truth.
    const releaseList = await officer.get("/api/releases").query({ fdrId });
    const releaseId = releaseList.body.items[0]?.id as number | undefined;
    expect(releaseId).toBeGreaterThan(0);

    // Officer recommends; the authority then decides.
    const recommended = await officer.post("/api/releases/action").send({
      releaseId,
      action: "recommend",
      note: "Verified against the case record.",
    });
    expect(recommended.status).toBe(200);

    const approver = await loginAgent(app, fx.approver.email, "officer");
    const approved = await approver.post("/api/releases/action").send({
      releaseId,
      action: "approve",
      note: "",
    });
    expect(approved.status).toBe(200);

    // Approval is never completion: the external evidence step is separate.
    const completed = await approver.post("/api/releases/complete").send({
      releaseId,
      evidenceType: "BANK_REFUND_CONFIRMATION",
      evidenceRef: "REFUND-8899",
      evidenceDate: "2026-10-20",
      completedAmountRupees: "100000.55",
      note: "Refund confirmation received from the bank.",
    });
    expect(completed.status).toBe(200);

    const list = await officer.get("/api/releases");
    const item = list.body.items.find((r: { id: number }) => r.id === releaseId);
    // Completion supersedes approval in the recorded decision trail.
    expect(item.decision).toBe("completed");
    expect(item.completionEvidenceRef).toBe("REFUND-8899");
    expect(item.completedByName).not.toBeNull();

    // The college cannot decide or complete releases.
    const collegeApprove = await college.post("/api/releases/action").send({
      releaseId,
      action: "approve",
      note: "",
    });
    expect(collegeApprove.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 5. Admin provisioning
// ---------------------------------------------------------------------------

dbDescribe("acceptance: admin provisioning and forced password change", () => {
  it("provisioned account must replace the one-time temporary password", async () => {
    if (!DB_TESTS_ENABLED) return;
    const admin = await loginAgent(app, fx.admin.email, "admin");

    const listed = await admin.get("/api/admin/users");
    expect(listed.status).toBe(200);

    const provisioned = await admin.post("/api/admin/users").send({
      institutionId: fx.instA.id,
      fullName: "New College User",
      email: `provisioned-${Date.now()}@example.test`,
      designation: "Accounts Officer",
    });
    expect(provisioned.status).toBe(201);
    const tempPassword = provisioned.body.temporaryPassword as string;
    expect(typeof tempPassword).toBe("string");
    expect(tempPassword.length).toBeGreaterThanOrEqual(10);
    // The temporary password is stored only as a hash, never in plaintext.
    const storedUser = await prisma.user.findUnique({ where: { email: provisioned.body.account.email } });
    expect(storedUser?.passwordHash).not.toContain(tempPassword);
    expect(storedUser?.mustChangePassword).toBe(true);

    // Non-admins cannot provision.
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const forbidden = await college.post("/api/admin/users").send({
      institutionId: fx.instA.id,
      fullName: "Escalation Attempt",
      email: `escalation-${Date.now()}@example.test`,
    });
    expect(forbidden.status).toBe(403);

    // The new account signs in, but every other API call is gated until the
    // temporary password is replaced.
    const newUser = await loginAgent(app, provisioned.body.account.email, "college", tempPassword);
    const me = await newUser.get("/api/auth/me");
    expect(me.body.user.mustChangePassword, JSON.stringify(me.body)).toBe(true);
    const gated = await newUser.get("/api/fdrs");
    expect(gated.status).toBe(403);

    const changed = await newUser.post("/api/auth/change-password").send({
      currentPassword: tempPassword,
      newPassword: "Fresh#Access2026",
    });
    expect(changed.status).toBe(200);

    const unblocked = await newUser.get("/api/fdrs");
    expect(unblocked.status).toBe(200);
    const meAfter = await newUser.get("/api/auth/me");
    expect(meAfter.body.user.mustChangePassword).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Isolation and role negatives
// ---------------------------------------------------------------------------

dbDescribe("acceptance: isolation and role enforcement", () => {
  it("foreign institution and out-of-jurisdiction actors are refused", async () => {
    if (!DB_TESTS_ENABLED) return;
    const college = await loginAgent(app, fx.collegeA.email, "college");
    const fdrId = await createSubmittedCase(college);

    // College B cannot read the case by guessing its id.
    const collegeB = await loginAgent(app, fx.collegeB.email, "college");
    const read = await collegeB.get(`/api/cases/${fdrId}`);
    expect([403, 404]).toContain(read.status);
    const upload = await collegeB
      .post(`/api/fdrs/${fdrId}/documents`)
      .attach("file", PDF_BYTES, { filename: "intrusion.pdf", contentType: "application/pdf" });
    expect([403, 404]).toContain(upload.status);
    const release = await collegeB.post("/api/releases").send({
      fdrId,
      reason: "A foreign institution must not open releases.",
      evidenceType: "OTHER_DOCUMENT",
    });
    expect([403, 404]).toContain(release.status);

    // An officer without jurisdiction sees nothing, never everything.
    const outsiderOfficer = await createUser({ email: `wo2-${Date.now()}@example.test`, role: "REVIEW_OFFICER" });
    const outsider = await loginAgent(app, outsiderOfficer.email, "officer");
    const outsiderRead = await outsider.get(`/api/cases/${fdrId}`);
    expect([403, 404]).toContain(outsiderRead.status);

    // College users can never start reviews, record checks or verify.
    const collegeStart = await college.post(`/api/fdrs/${fdrId}/review/start`).send({ fdrId });
    expect(collegeStart.status, `review/start: ${JSON.stringify(collegeStart.body)}`).toBe(403);
    const collegeCheck = await college.post(`/api/fdrs/${fdrId}/checks`).send({
      field: "amount",
      source: "SIMULATED_BANK_CHECK",
      observedValue: "100000.55",
    });
    expect(collegeCheck.status, `check: ${JSON.stringify(collegeCheck.body)}`).toBe(403);

    // Approving authority cannot verify cases (separation of duties).
    const approver = await loginAgent(app, fx.approver.email, "officer");
    await reviewToVerified(await loginAgent(app, fx.officer.email, "officer"), fdrId);
    const approverVerify = await approver.post(`/api/fdrs/${fdrId}/verify`).send({ note: "" });
    expect(approverVerify.status).toBe(403);
  });
});
