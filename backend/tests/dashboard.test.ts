/**
 * Dashboard query correctness against seeded scenarios:
 * - counters reflect exact database state
 * - status separation (review state vs date condition)
 * - overdue tasks counted only past boundary day
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { dbDescribe, DB_TESTS_ENABLED } from "./helpers/guards.js";
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
  college: { id: number; email: string };
  inst: { id: number };
  officer: { id: number; email: string };
}

let fx: Fixture;

beforeEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
  const inst = await createInstitution(7);
  const college = await createUser({ email: `c-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: inst.id });
  const officer = await createUser({ email: `o-${Date.now()}@example.test`, role: "REVIEW_OFFICER" });

  // Cases: 1 verified current, 1 submitted (pending), 1 approaching (12d),
  // 1 matured, plus two tasks (one due in future, one overdue by 5 days).
  await createFdr({ institutionId: inst.id, publicCode: `DASH-V-${Date.now()}`, status: "verified", maturityInDays: 300 });
  await createFdr({ institutionId: inst.id, publicCode: `DASH-P-${Date.now()}`, status: "submitted", maturityInDays: 300 });
  await createFdr({ institutionId: inst.id, publicCode: `DASH-A-${Date.now()}`, status: "verified", maturityInDays: 12 });
  await createFdr({ institutionId: inst.id, publicCode: `DASH-M-${Date.now()}`, status: "verified", maturityInDays: -20, issueInDays: -380 });

  await createTask({
    type: "DOCUMENT_CORRECTION",
    title: "Fix something",
    assigneeInstitutionId: inst.id,
    dueInDays: 3,
  });
  await createTask({
    type: "RENEWAL_AFTER_MATURITY",
    title: "Renew matured case",
    assigneeInstitutionId: inst.id,
    dueInDays: -5,
  });
  await createTask({
    type: "VERIFICATION_REVIEW",
    title: "Review case",
    assigneeUserId: officer.id,
    dueInDays: 10,
  });

  fx = { college, inst, officer };
});

afterEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
});

dbDescribe("GET /api/dashboard (college)", () => {
  it("counts exactly match the scenario", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/dashboard");

    expect(res.status).toBe(200);
    // CollegeCounters (v2): scope = this institution only.
    expect(res.body.counters).toEqual({
      activeInstruments: 4,
      activeAmount: { currency: "INR", amountMinor: "40000000" }, // 4 x 100000.00
      drafts: 0,
      awaitingReview: 1, // the submitted case
      correctionsRequired: 0,
      approachingMaturity: 2, // the 12-day case + the matured one (non-current)
      openReplacementObligations: 2,
      pendingReleaseRequests: 0,
    });
  });

  it("separates date condition from review status", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/dashboard");

    const matured = res.body.upcomingMaturity.find(
      (item: { dateCondition: string; status: string }) => item.dateCondition === "matured",
    );
    expect(matured).toBeTruthy();
    expect(matured.status).toBe("verified"); // a matured VERIFIED receipt is data upkeep, not a violation verdict

    const approaching = res.body.upcomingMaturity.find(
      (item: { dateCondition: string }) => item.dateCondition === "approaching_maturity",
    );
    expect(approaching?.daysToMaturity).toBe(12);
  });

  it("lists action-required tasks ordered by urgency with overdue first", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/dashboard");
    const tasks = res.body.actionRequiredTasks;
    expect(tasks.length).toBe(2);
    expect(tasks[0].isOverdue).toBe(true);
    expect(tasks[0].title).toBe("Renew matured case");
  });

  it("reports the configured sample window", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/dashboard");
    expect(res.body.approachingWindowDays).toBeGreaterThan(0);
    expect(typeof res.body.generatedAt).toBe("string");
  });
});

dbDescribe("GET /api/dashboard (officer)", () => {
  it("officer counters describe their assigned workload", async () => {
    // The officer needs jurisdiction over the fixture institution for the
    // case-scoped counters and the linked task to be visible.
    await grantJurisdiction(fx.officer.id, fx.inst.id);
    const agent = await loginAgent(app, fx.officer.email, "officer");
    const res = await agent.get("/api/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.counters).toEqual({
      submittedAwaitingReview: 1, // the submitted case within jurisdiction
      underReview: 0,
      correctionsAwaitingCollege: 0,
      correctedReadyForReReview: 0,
      replacementsAwaitingReview: 0,
      releasesAwaitingRecommendation: 0,
      assignedTasks: 1, // the personally assigned review task
      overdueTasks: 0,
    });
    expect(res.body.role).toBe("REVIEW_OFFICER");
  });
});

dbDescribe("GET /api/fdrs filters", () => {
  it("status filter works with pagination metadata", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/fdrs").query({ status: "verified", page: 1, pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.pageSize).toBe(2);
  });

  it("dateCondition filter drives maturity ranges", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/fdrs").query({ dateCondition: "matured" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].dateCondition).toBe("matured");
  });

  it("search matches reference and bank fields", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/fdrs").query({ q: "Test Bank" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
  });

  it("invalid query params return structured 422 errors", async () => {
    const agent = await loginAgent(app, fx.college.email, "college");
    const res = await agent.get("/api/fdrs").query({ status: "bogus" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.error.fieldErrors ?? {})).toContain("status");
  });
});
