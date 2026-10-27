# API contracts

Base URL: `/api`. All error bodies use the shared shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fieldErrors": { "file": ["..."] } } }
```

Codes: `VALIDATION_ERROR | INVALID_CREDENTIALS | ACCOUNT_INACTIVE |
UNAUTHENTICATED | FORBIDDEN | WRONG_LOGIN_PORTAL | RATE_LIMITED | NOT_FOUND |
CONFLICT | INTERNAL_ERROR` (see `packages/contracts/src/errors.ts`).

Schemas referenced below live in `@sih26265/contracts`.

## Public (no session)

| Method & path | Body/Query | Response |
| --- | --- | --- |
| GET /api/health | - | `{ status: "ok" }` |
| POST /api/auth/login | LoginRequest `{ email, password, context: "college" \| "officer" }` | 200 `CurrentUserResponse` + `HttpOnly; SameSite=Lax` session cookie; 429 RATE_LIMITED after LOGIN_RATE_LIMIT_MAX_ATTEMPTS within the window |

## Session-required (cookie)

| Method & path | Notes |
| --- | --- |
| GET /api/auth/me | CurrentUser or 401 |
| POST /api/auth/logout | 204; invalidates the session server-side |
| GET /api/dashboard | DashboardResponse: counters (pending/underReview/verified/discrepancy/totals), date-condition buckets, tasks incl. overdue flags; scoped to the acting user |
| GET /api/fdrs | query `q,status,institutionId(officers),dateCondition,sort,page,pageSize`; FdrListResponse (institution-scoped) |
| GET /api/fdrs/:fdrId/documents | DocumentListResponse `{ items: DocumentMeta[], total }` |
| POST /api/fdrs/:fdrId/documents | multipart form field `file`; college role, own institution; 201 `{ document: DocumentMeta }`; 409 CONFLICT on identical content for the same instrument |
| GET /api/documents/:id | binary download (Content-Type from verified magic; `Content-Disposition: attachment`); out-of-scope ids => 404 like nonexistent ones |
| GET /api/tasks | query `page,pageSize,status,onlyOverdue,fdrId,type`; TaskListResponse |

## DocumentMeta shape

```json
{
  "id": 12,
  "fdrId": 7,
  "fdrPublicCode": "FDR-2026-0004",
  "fileName": "receipt scan.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 689123,
  "checksumSha256": "<64 hex>",
  "uploadedAt": "2026-10-28T04:12:00.000Z",
  "uploadedByName": "Dr. Meera Joshi (Registrar, Lotus)"
}
```

Upload validation (all enforced server-side): one file per request, size
<= MAX_UPLOAD_MB, MIME in {application/pdf, image/jpeg, image/png}, and the
declared type must match the file's magic bytes.

## Money / dates

- Money: `{ "currency": "INR", "amountMinor": "500000000" }` (exact integers,
  never floats).
- Calendar dates: `"YYYY-MM-DD"` strings; timestamps: ISO 8601.

## Worker/job CLI (not HTTP)

```
npm run worker:once        # one pass, exit
npm run worker             # watch every JOB_INTERVAL_MINUTES minutes
```
