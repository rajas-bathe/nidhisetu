/**
 * Document pipeline tests against a real PostgreSQL instance:
 * - upload validation (size, declared type vs magic bytes, duplicates)
 * - institution isolation on downloads (404 for out-of-scope ids, no 403 leak)
 * - officer access within jurisdiction, unauthenticated rejection
 * - local storage adapter protections (generated keys, traversal refusal)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import path from "node:path";
import { dbDescribe, DB_TESTS_ENABLED } from "./helpers/guards.js";
import { resetDatabase } from "./helpers/db.js";
import {
  appInstance,
  createFdr,
  createInstitution,
  createUser,
  grantJurisdiction,
  loginAgent,
} from "./helpers/scenario.js";
import { buildObjectKey, getStorageAdapter } from "../src/integrations/storage/index.js";

const app = appInstance();

interface Fixture {
  instA: { id: number; code: string };
  instB: { id: number; code: string };
  collegeA: { id: number; email: string };
  collegeB: { id: number; email: string };
  officer: { id: number; email: string };
  fdrA: { id: number; publicCode: string };
  fdrB: { id: number; publicCode: string };
}

let fx: Fixture;

const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.alloc(512, 0x41),
]);

beforeEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
  const instA = await createInstitution(11);
  const instB = await createInstitution(12);
  const collegeA = await createUser({ email: `doc-a-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: instA.id });
  const collegeB = await createUser({ email: `doc-b-${Date.now()}@example.test`, role: "COLLEGE_USER", institutionId: instB.id });
  const officer = await createUser({ email: `doc-off-${Date.now()}@example.test`, role: "REVIEW_OFFICER" });
  const fdrA = await createFdr({ institutionId: instA.id, publicCode: `DOCA-${Date.now()}`, maturityInDays: 200 });
  const fdrB = await createFdr({ institutionId: instB.id, publicCode: `DOCB-${Date.now()}`, maturityInDays: 200 });
  await grantJurisdiction(officer.id, instA.id); // officer sees A, not B
  fx = { instA, instB, collegeA, collegeB, officer, fdrA, fdrB };
});

afterEach(async () => {
  if (!DB_TESTS_ENABLED) return;
  await resetDatabase();
});

dbDescribe("POST /api/fdrs/:id/documents (upload)", () => {
  it("stores a pdf upload with metadata and returns 201", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "receipt scan.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    const meta = res.body.document;
    expect(meta.mimeType).toBe("application/pdf");
    expect(meta.fileName).toBe("receipt scan.pdf");
    expect(meta.fdrPublicCode).toBe(fx.fdrA.publicCode);
    expect(meta.checksumSha256).toBe(createHash("sha256").update(PDF_BYTES).digest("hex"));
    expect(meta.sizeBytes).toBe(PDF_BYTES.length);
  });

  it("rejects files whose bytes do not match the declared type", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const res = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", pngBytes, { filename: "fake.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unsupported types even with a matching-looking header", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const res = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", Buffer.from("MZ\x90\x00 executable-ish"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty files and oversized files", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");

    const empty = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", Buffer.alloc(0, 0), { filename: "empty.pdf", contentType: "application/pdf" });
    expect(empty.status).toBe(422);

    const big = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(1_100_000, 0x42)]), {
        filename: "big.pdf",
        contentType: "application/pdf",
      });
    expect(big.status).toBe(422);
  });

  it("rejects duplicate content for the same instrument with 409", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const first = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "a.pdf", contentType: "application/pdf" });
    expect(first.status).toBe(201);
    const second = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "another-name.pdf", contentType: "application/pdf" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
  });

  it("forbids officers and other-institution users from uploading", async () => {
    const officer = await loginAgent(app, fx.officer.email, "officer");
    const resOfficer = await officer
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "x.pdf", contentType: "application/pdf" });
    expect(resOfficer.status).toBe(403);

    const collegeB = await loginAgent(app, fx.collegeB.email, "college");
    const resB = await collegeB
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "x.pdf", contentType: "application/pdf" });
    // Not B's instrument: same response as a nonexistent record (no leak).
    expect(resB.status).toBe(404);
  });
});

dbDescribe("GET /api/documents/:id (download isolation)", () => {
  it("round-trips the exact bytes for the owning college user", async () => {
    const agent = await loginAgent(app, fx.collegeA.email, "college");
    const upload = await agent
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "scan.pdf", contentType: "application/pdf" });
    const id = upload.body.document.id as number;

    const download = await agent.get(`/api/documents/${id}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.compare(download.body, PDF_BYTES)).toBe(0);
    expect(String(download.headers["content-disposition"])).toContain("attachment");
  });

  it("serves documents to officers inside the jurisdiction", async () => {
    const uploader = await loginAgent(app, fx.collegeA.email, "college");
    const upload = await uploader
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "scan.pdf", contentType: "application/pdf" });
    const id = upload.body.document.id as number;

    const officer = await loginAgent(app, fx.officer.email, "officer");
    const res = await officer.get(`/api/documents/${id}`);
    expect(res.status).toBe(200);
  });

  it("denies other-institution users and unauthenticated access", async () => {
    const uploader = await loginAgent(app, fx.collegeA.email, "college");
    const upload = await uploader
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "scan.pdf", contentType: "application/pdf" });
    const id = upload.body.document.id as number;

    const collegeB = await loginAgent(app, fx.collegeB.email, "college");
    const resB = await collegeB.get(`/api/documents/${id}`);
    expect(resB.status).toBe(404); // no 403 leak of the document's existence

    constDeny: {
      const anonymous = await request(app).get(`/api/documents/${id}`);
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe("UNAUTHENTICATED");
      break constDeny;
    }
  });

  it("lists documents only inside the requesting user's scope", async () => {
    const agentA = await loginAgent(app, fx.collegeA.email, "college");
    await agentA
      .post(`/api/fdrs/${fx.fdrA.id}/documents`)
      .attach("file", PDF_BYTES, { filename: "scan-a.pdf", contentType: "application/pdf" });

    const listA = await agentA.get(`/api/fdrs/${fx.fdrA.id}/documents`);
    expect(listA.status).toBe(200);
    expect(listA.body.total).toBe(1);

    const agentB = await loginAgent(app, fx.collegeB.email, "college");
    const listB = await agentB.get(`/api/fdrs/${fx.fdrA.id}/documents`);
    expect(listB.status).toBe(404);
  });
});

/** Storage adapter checks run without the database. */
describe("local storage adapter (no database required)", () => {
  it("writes under generated keys and reads back the exact bytes", async () => {
    const adapter = getStorageAdapter();
    const key = buildObjectKey(999, "receipt.pdf");
    const bytes = Buffer.from("%PDF-traversal-check");
    await adapter.put(bytes, key);
    try {
      expect(await adapter.get(key)).toEqual(bytes);
      expect(key).toMatch(/^fdr\/999\//);
    } finally {
      await adapter.delete(key);
    }
  });

  it("refuses keys that attempt path traversal or absolute paths", async () => {
    const adapter = getStorageAdapter();
    const evil = ["/etc/passwd", "../package.json", "fdr/../../backend/.env", "fdr///x", "notfdr/x.pdf", "fdr/..%2f/x"];
    for (const key of evil) {
      await expect(adapter.get(key)).rejects.toThrow();
      await expect(adapter.put(Buffer.from("x"), key)).rejects.toThrow();
    }
  });

  it("keeps the storage directory outside served bundles", async () => {
    const { config } = await import("../src/config/env.js");
    const normalised = path.normalize(config.storage.localStorageDir).toLowerCase();
    expect(normalised).not.toContain(path.join("frontend", "public").toLowerCase());
  });
});
