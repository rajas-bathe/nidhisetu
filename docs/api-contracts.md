# API contracts

Base URL: `/api`. All error bodies use the shared shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fieldErrors": { "file": ["..."] } } }
```

Codes: `VALIDATION_ERROR | INVALID_CREDENTIALS | ACCOUNT_INACTIVE |
UNAUTHENTICATED | FORBIDDEN | WRONG_LOGIN_PORTAL | PASSWORD_CHANGE_REQUIRED |
RATE_LIMITED | NOT_FOUND | CONFLICT | INTERNAL_ERROR` (see
`packages/contracts/src/errors.ts`).

Schemas referenced below live in `@sih26265/contracts` (zod, shared with the
frontend). Roles: `COLLEGE_USER`, `REVIEW_OFFICER`, `APPROVING_AUTHORITY`,
`SYSTEM_ADMIN` — every route re-checks role **and** scope server-side.

## Public (no session)

| Method & path | Body/Query | Response |
| --- | --- | --- |
| GET /api/health | - | `{ status: "ok" }` |
| POST /api/auth/login | `{ email, password, context: "college" \| "officer" \| "admin" }` | 200 `CurrentUserResponse` + `HttpOnly; SameSite=Lax` cookie; wrong portal → 403 WRONG_LOGIN_PORTAL; 429 after repeated failures |

## Auth / session

| Method & path | Notes |
| --- | --- |
| GET /api/auth/me | `{ user: CurrentUser }` or 401; `mustChangePassword` flag drives the forced-change flow |
| POST /api/auth/logout | 204; invalidates the session server-side |
| POST /api/auth/change-password | `{ currentPassword, newPassword }`; replaces a temporary password; other sessions revoked, current kept |

Accounts with a pending temporary password get `403 PASSWORD_CHANGE_REQUIRED`
on every call except `/api/auth/*`.

## Dashboard / lists (scope-aware)

| Method & path | Notes |
| --- | --- |
| GET /api/dashboard | Role-specific counters (college: activeInstruments/activeAmount/drafts/awaitingReview/correctionsRequired/approachingMaturity/openReplacementObligations/pendingReleaseRequests; officer: submittedAwaitingReview/underReview/correctionsAwaitingCollege/correctedReadyForReReview/replacementsAwaitingReview/releasesAwaitingRecommendation/assignedTasks/overdueTasks), date buckets, urgent tasks |
| GET /api/fdrs | query `q,status,institutionId(officers),dateCondition,sort,page,pageSize`; institution-scoped for colleges, jurisdiction-scoped for officers |
| GET /api/tasks | query `page,pageSize,status,onlyOverdue,fdrId,type`; personal + institution tasks inside jurisdiction |
| GET /api/notifications | scoped list; POST `/read-all` and POST `/:notificationId/read` |

## Case workspace

| Method & path | Role / notes |
| --- | --- |
| POST /api/fdrs | college; body `FdrDraftInput` (money as rupee string); optional `?replacesFdrId=N` marks a replacement; 201 `{ fdrId, publicCode, versionNo: 0 }` |
| PATCH /api/fdrs/:fdrId/draft | college, own draft; `FdrDraftUpdate` with optimistic `baseUpdatedAt` |
| POST /api/fdrs/:fdrId/submit | college; atomic version 1; 422 without a supporting document; 409 already submitted |
| GET /api/cases/:fdrId | scoped CaseDetail: overview, immutable versions, documents, checks, corrections, replacement, releases, tasks |
| GET /api/cases/:fdrId/guidance | deterministic next-step advice (SAMPLE-labelled) |
| POST /api/fdrs/:fdrId/review/start | officer in jurisdiction; status submitted → under_review |
| POST /api/fdrs/:fdrId/checks | officer; `CheckRecordRequest` `{ field, source, outcome?, observedValue? }`; SIMULATED_BANK_CHECK derives MATCH/MISMATCH server-side |
| POST /api/fdrs/:fdrId/verify | officer; 409 CONFLICT listing remaining readiness blockers until all required checks are MATCH and no open corrections |

## Documents

| Method & path | Notes |
| --- | --- |
| POST /api/fdrs/:fdrId/documents | multipart `file`; college, own institution; 201 `{ document: DocumentMeta }`; 409 on identical content |
| GET /api/fdrs/:fdrId/documents | scoped list |
| GET /api/documents/:id | binary download; out-of-scope ids ⇒ 404 |

DocumentMeta: `{ id, fdrId, fdrPublicCode, fileName, mimeType, sizeBytes,
checksumSha256, uploadedAt, uploadedByName }`. Server-side validation: size ≤
MAX_UPLOAD_MB, MIME ∈ {pdf, jpeg, png}, magic bytes must match.

## Corrections (versioned)

| Method & path | Role / notes |
| --- | --- |
| GET /api/corrections | scoped list (`fdrId`, `status` filters) |
| POST /api/corrections | officer; `{ fdrId, fields: [{ field, reason }], note? }`; only while status ∈ submitted/under_review/discrepancy; 200 `{ fdrId, message }` (fetch the id from the list) |
| POST /api/corrections/respond | college; `{ correctionId, values: [{ field, value }], note? }`; one transaction: new immutable version + invalidation of affected checks |
| POST /api/corrections/:id/cancel | officer; only open requests |

## Replacements (supersession)

| Method & path | Role / notes |
| --- | --- |
| GET /api/replacements | scoped queue with stage |
| POST /api/replacements/recommend | officer on a verified replacement case |
| POST /api/replacements/accept | approving authority; sets supersession (previousFdrId/supersededByFdrId); refuses when absent/already superseded |
| POST /api/replacements/reject | approving authority |

## Releases

| Method & path | Role / notes |
| --- | --- |
| GET /api/releases | scoped list (`fdrId`, `status`) |
| POST /api/releases | college; `{ fdrId, reason, evidenceType, evidenceRef? }`; 201 `{ fdrId, message }` |
| POST /api/releases/action | `{ releaseId, action: "recommend" \| "reject" \| "approve", note }`; officer recommends; authority decides (OPEN → recommended → DECIDED) |
| POST /api/releases/complete | authority; `{ releaseId, evidenceType, evidenceRef, evidenceDate, completedAmountRupees, note? }`; records external refund evidence + completer identity; decision becomes `completed` |

## Admin (SYSTEM_ADMIN only)

| Method & path | Notes |
| --- | --- |
| GET /api/admin/users | directory (`q,role,institutionId,status,sort`) |
| POST /api/admin/users | provision college user; 201 `{ temporaryPassword, account }` — one-time, plaintext never stored |
| POST /api/admin/users/:userId/password-reset | new temporary password; revokes sessions |
| POST /api/admin/users/:userId/status | activate/deactivate |
| POST /api/admin/users/:userId/revoke-sessions | force logout |

Institutions: GET/POST `/api/institutions`, GET/PATCH `/:id`,
POST `/:id/status`, POST `/:id/assignments` (officer jurisdiction rows carry
the role REVIEW_OFFICER \| APPROVING_AUTHORITY), GET `/officers`.

Reports (admin/officer): GET `/api/reports/:kind` and `/api/reports/:kind/export`
(CSV, formula-injection guarded); kind ∈ `register`,
`upcoming_maturity`, `pending_corrections`, `replacement_obligations`,
`release_status`. Approvals queue: GET `/api/approvals`. Audit: GET
`/api/audit` (scoped, admin/officer).

## Money / dates

- Money: `{ "currency": "INR", "amountMinor": "500000000" }` (exact integers,
  never floats). Requests take rupee strings (`"500000.55"`); the server
  converts to minor units (bigint).
- Calendar dates: `"YYYY-MM-DD"`; timestamps: ISO 8601.

## Worker/job CLI (not HTTP)

```
npm run worker:once        # one pass, exit
npm run worker             # watch every JOB_INTERVAL_MINUTES minutes
```
