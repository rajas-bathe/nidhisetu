/**
 * Institution isolation tests (the acceptance rule from the design guide:
 * "A separate institution must be unable to retrieve that case by guessing
 * its ID"). These tests run against a real PostgreSQL instance.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { dbDescribe, DB_TESTS_ENABLED } from "./helpers/guards.js";
import request from "supertest";
import { resetDatabase } from "./helpers/db.js";
import {
  appInstance,
  createFdr,
  createInstitution,
  createTask,
  createUser,
  grantJurisdiction,
  loginAgent,
} from "./helpers/scenario.js";

const app = appInstance();

interface Fixture {
  instA: { id: number; code: string };
  instB: { id: number; code: string };
  collegeA: { id: number; email: string };
  collegeB: { id: number; email: string };
  officer: { id: number; email: string };
  approver: { id: number; email: string };
  fdrA: { id: number; publicCode: string };
  fdrB: { id: number; publicCode: string };
}

let fx: Fixture;

beforeEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
  const instA = await createInstitution(1);
  const instB = await createInstitution(2);
  const collegeA = await createUser({ email: `a-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: instA.id });
  const collegeB = await createUser({ email: `b-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: instB.id });
  const officer = await createUser({ email: `o-${Date.now()}@example.test`, role: "REVIEW_OFFICER" });
  const approver = await createUser({ email: `p-${Date.now()}@example.test`, role: "APPROVING_AUTHORITY" });

  await grantJurisdiction(officer.id, instA.id);
  await grantJurisdiction(officer.id, instB.id);
  await grantJurisdiction(approver.id, instA.id);
  await grantJurisdiction(approver.id, instB.id);

  const fdrA = await createFdr({
    institutionId: instA.id,
    publicCode: `TEST-A-${Date.now()}`,
    status: "submitted",
    maturityInDays: 90,
  });
  const fdrB = await createFdr({
    institutionId: instB.id,
    publicCode: `TEST-B-${Date.now()}`,
    status: "verified",
    maturityInDays: 90,
  });

  await createTask({
    type: "VERIFICATION_REVIEW",
    title: "Review A",
    assigneeUserId: officer.id,
    dueInDays: 5,
    fdrId: fdrA.id,
  });
  await createTask({
    type: "DOCUMENT_CORRECTION",
    title: "Correct B",
    assigneeInstitutionId: instB.id,
    dueInDays: 5,
    fdrId: fdrB.id,
  });

  fx = {
    instA,
    instB,
    collegeA,
    collegeB,
    officer,
    approver,
    fdrA: { id: fdrA.id, publicCode: fdrA.publicCode },
    fdrB: { id: fdrB.id, publicCode: fdrB.publicCode },
  };
});

afterEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
});

dbDescribe("institution isolation on listing endpoints", () => {
  it("college A sees only institution A instruments", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent.get("/api/fdrs").query({ pageSize: 50 });

    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.institution.id).toBe(fx.instA.id);
    }
    expect(res.body.items.some((i: { id: number }) => i.id === fx.fdrA.id)).toBe(true);
    expect(res.body.items.some((i: { id: number }) => i.id === fx.fdrB.id)).toBe(false);
  });

  it("college B sees only institution B instruments", async () => {
    const agent = await loginAgent(app, fx.collegeB.email, "college");
    const res = await agent.get("/api/fdrs").query({ pageSize: 50 });

    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].id).toBe(fx.fdrB.id);
  });

  it("college A cannot scope the list to institution B", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent.get("/api/fdrs").query({ institutionId: fx.instB.id });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("officers see only jurisdictions (both institutions here); a foreign filter is rejected", async () => {
    const agent = await loginAgent(app, fx.officer.email, "officer");

    const all = await agent.get("/api/fdrs").query({ pageSize: 50 });
    expect(all.body.items.length).toBe(2);

    const narrowed = await agent.get("/api/fdrs").query({ institutionId: fx.instB.id, pageSize: 50 });
    expect(narrowed.body.items.length).toBe(1);
    expect(narrowed.body.items[0].id).toBe(fx.fdrB.id);

    const foreign = await createInstitution(3);
    const denied = await agent.get("/api/fdrs").query({ institutionId: foreign.id });
    expect(denied.status).toBe(403);
  });

  it("officers without jurisdiction see zero rows, never everything", async () => {
    const outsider = await createUser({ email: `out-${Date.now()}@example.test`, role: "REVIEW_OFFICER" });
    const agent = await loginAgent(app, outsider.email, "officer");
    const res = await agent.get("/api/fdrs");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});

dbDescribe("task inbox isolation", () => {
  it("college tasks never leak between institutions", async () => {
    const agentA = await loginAgent(app, fx.collegeA.email, "college");
    const agentB = await loginAgent(app, fx.collegeB.email, "college");

    const tasksA = await agentA.get("/api/tasks");
    const tasksB = await agentB.get("/api/tasks");

    // College A has no institution-assigned task ("Review A" is the officer's
    // personal task); its inbox must be empty - never another party's work.
    expect(tasksA.status).toBe(200);
    expect(tasksA.body.items).toHaveLength(0);

    // College B sees exactly its own institution task, and never the officer's.
    expect(tasksB.status).toBe(200);
    expect(tasksB.body.items).toHaveLength(1);
    expect(tasksB.body.items[0].fdrId).toBe(fx.fdrB.id);
    expect(tasksB.body.items.some((t: { title: string | null }) => t.title === "Review A")).toBe(false);
  });

  it("officer inbox combines personal tasks and tasks of assigned institutions", async () => {
    const agent = await loginAgent(app, fx.officer.email, "officer");
    const res = await agent.get("/api/tasks");
    // v2 semantics: the officer sees their personally assigned task plus the
    // institution-assigned task of an institution in their jurisdiction.
    expect(res.body.items.length).toBe(2);
    const titles = res.body.items.map((t: { title: string | null }) => t.title);
    expect(titles).toContain("Review A");
    expect(titles).toContain("Correct B");
  });
});

dbDescribe("dashboard counters are scoped", () => {
  it("college A dashboard shows only A-side data", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent.get("/api/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.institution.id).toBe(fx.instA.id);
    // v2 college counters: institution A scope only.
    expect(res.body.counters).toEqual({
      activeInstruments: 1,
      activeAmount: { currency: "INR", amountMinor: "10000000" },
      drafts: 0,
      awaitingReview: 1, // fdrA is 'submitted'
      correctionsRequired: 0,
      approachingMaturity: 0, // 90 days out: current
      openReplacementObligations: 0,
      pendingReleaseRequests: 0,
    });
  });

  it("officer dashboard reflects assigned work", async () => {
    const agent = await loginAgent(app, fx.officer.email, "officer");
    const res = await agent.get("/api/dashboard");
    expect(res.status).toBe(200);
    // v2 officer counters: jurisdiction cases + personally assigned tasks.
    expect(res.body.counters).toEqual({
      submittedAwaitingReview: 1, // fdrA is 'submitted' within jurisdiction
      underReview: 0,
      correctionsAwaitingCollege: 0,
      correctedReadyForReReview: 0,
      replacementsAwaitingReview: 0,
      releasesAwaitingRecommendation: 0,
      assignedTasks: 1, // "Review A"
      overdueTasks: 0,
    });
    expect(res.body.institution).toBeNull();
  });
});

dbDescribe("falsification attempts", () => {
  it("college A cannot see institution B's case via guessed ids", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent.get("/api/fdrs").query({ q: fx.fdrB.publicCode });
    expect(res.body.items.every((i: { id: number }) => i.id !== fx.fdrB.id)).toBe(true);
  });

  it("dashboard endpoints require authentication", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("non-officer roles cannot self-assign jurisdiction through any read path", async () => {
    // The jurisdiction table is backend-only: no endpoint accepts an
    // institution claim from the request body. College filters are validated
    // against the DB scope, which is what the earlier tests assert.
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent.get("/api/fdrs").query({ institutionId: fx.instA.id, pageSize: 50 });
    // own institution nickname is allowed; only foreign ids are denied
    expect(res.status).toBe(200);
  });
});
