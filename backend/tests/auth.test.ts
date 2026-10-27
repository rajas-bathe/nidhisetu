/**
 * Authentication tests against a real PostgreSQL instance:
 * - cookie shape and session round trip
 * - credential failures (no account enumeration, timing-safe path exercised)
 * - portal/role mismatch handling (college cannot use the officer login)
 * - input validation errors
 * - login rate limiting
 * - logout invalidation and deactivated-account behaviour
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { dbDescribe, DB_TESTS_ENABLED } from "./helpers/guards.js";
import request from "supertest";
import { resetDatabase } from "./helpers/db.js";
import {
  appInstance,
  createInstitution,
  createUser,
  DEMO_PASSWORD,
} from "./helpers/scenario.js";
import { prisma } from "../src/db/client.js";

const app = appInstance();

let collegeEmail: string;
let officerEmail: string;
let deactivatedEmail: string;

beforeEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
  const inst = await createInstitution(1);
  collegeEmail = `college-a-${Date.now()}@example.test`;
  officerEmail = `officer-a-${Date.now()}@example.test`;
  deactivatedEmail = `deceased-${Date.now()}@example.test`;
  await createUser({ email: collegeEmail, role: "COLLEGE_USER", institutionId: inst.id });
  await createUser({ email: officerEmail, role: "REVIEW_OFFICER" });
  await createUser({ email: deactivatedEmail, role: "COLLEGE_USER", institutionId: inst.id, isActive: false });
});

afterEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
});

dbDescribe("POST /api/auth/login", () => {
  it("returns 200 with an HttpOnly SameSite cookie for valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: collegeEmail, password: DEMO_PASSWORD, context: "college" });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(collegeEmail);
    expect(res.body.user.role).toBe("COLLEGE_USER");
    const cookies = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]];
    const sessionCookie = cookies.find((c) => String(c).startsWith("fdr_session="));
    expect(sessionCookie).toBeTruthy();
    expect(String(sessionCookie)).toContain("HttpOnly");
    expect(String(sessionCookie)).toContain("SameSite=Lax");
  });

  it("rejects wrong passwords with 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: collegeEmail, password: "wrong-password", context: "college" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects unknown accounts without a distinguishable error", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@nowhere.test", password: "whatever", context: "college" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("blocks college accounts from the officer portal (and vice versa)", async () => {
    const collegeViaOfficer = await request(app)
      .post("/api/auth/login")
      .send({ email: collegeEmail, password: DEMO_PASSWORD, context: "officer" });
    expect(collegeViaOfficer.status).toBe(403);
    expect(collegeViaOfficer.body.error.code).toBe("WRONG_LOGIN_PORTAL");

    const officerViaCollege = await request(app)
      .post("/api/auth/login")
      .send({ email: officerEmail, password: DEMO_PASSWORD, context: "college" });
    expect(officerViaCollege.status).toBe(403);
    expect(officerViaCollege.body.error.code).toBe("WRONG_LOGIN_PORTAL");
  });

  it("returns 422 field errors for missing fields", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.error.fieldErrors ?? {})).toContain("email");
  });

  it("rate limits repeated attempts keyed by ip+email", async () => {
    const email = `ratelimit-${Date.now()}@example.test`;
    let last = 0;
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "nope", context: "college" });
      last = res.status;
      if (res.status === 429) {
        expect(res.body.error.code).toBe("RATE_LIMITED");
        break;
      }
    }
    expect(last).toBe(429);
  });

  it("rejects forbidding origins for mutating requests", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://evil.example")
      .send({ email: collegeEmail, password: DEMO_PASSWORD, context: "college" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("accepts allow-listed origins that also carry the CSRF custom header", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ email: collegeEmail, password: DEMO_PASSWORD, context: "college" });
    expect(res.status).toBe(200);
  });

  it("persists failed login attempts in the audit trail", async () => {
    await request(app).post("/api/auth/login").send({ email: collegeEmail, password: "bad", context: "college" });
    const events = await prisma.auditEvent.findMany({ where: { action: "AUTH_LOGIN_FAILED" } });
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) {
      expect(JSON.stringify(event.detail ?? {})).not.toContain(DEMO_PASSWORD);
    }
  });
});

dbDescribe("GET /api/auth/me", () => {
  it("round-trips a fresh session", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: officerEmail, password: DEMO_PASSWORD, context: "officer" });

    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", login.headers["set-cookie"]);

    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("REVIEW_OFFICER");
    expect(me.body.user.institution).toBeNull();
  });

  it("rejects unauthenticated calls with 401 UNAUTHENTICATED", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

dbDescribe("POST /api/auth/logout", () => {
  it("invalidates the session server-side", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: collegeEmail, password: DEMO_PASSWORD, context: "college" });
    const cookie = login.headers["set-cookie"];

    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(204);

    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
  });
});

dbDescribe("deactivated accounts", () => {
  it("cannot sign in", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: deactivatedEmail, password: DEMO_PASSWORD, context: "college" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("loses access mid-session when deactivated", async () => {
    const target = await prisma.user.findUnique({ where: { email: deactivatedEmail } });
    const login = await request(app)
      .post("/api/auth/login")
      .send({
        email: collegeEmail,
        password: DEMO_PASSWORD,
        context: "college",
      });

    // deactivate the OTHER account to keep this test independent
    await prisma.user.update({ where: { id: login.body.user.id }, data: { isActive: false } });
    void target;

    const me = await request(app).get("/api/auth/me").set("Cookie", login.headers["set-cookie"]);
    expect(me.status).toBe(401);
  });

  it("expired sessions are rejected", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: collegeEmail, password: DEMO_PASSWORD, context: "college" });

    await prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const me = await request(app).get("/api/auth/me").set("Cookie", login.headers["set-cookie"]);
    expect(me.status).toBe(401);
  });
});
