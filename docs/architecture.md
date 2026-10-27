# Architecture

## Monorepo layout

```
packages/contracts   shared zod schemas + TS types (built to CJS dist as well as ESM dist/esm)
backend              Express 5 API + Prisma 6 + storage adapters + worker
frontend             React 19 + Vite 7 + Tailwind 4 + TanStack Query + React Router 7
scripts              dev tooling (Docker-free local PostgreSQL runner)
docker/              OPTIONAL docker-compose infrastructure (not required anymore)
```

Node >= 20.19 works; the repo was developed and verified on Node 24 on Windows.

## Request pipeline (backend)

```
request -> requestId -> httpLogger -> originGuard(CSRF) -> route
        -> authenticate (DB-backed session)
        -> service (scope resolution + business rules)
        -> serialize (contracts shapes; money as {currency, amountMinor})
```

- **originGuard**: mutating methods must originate from allow-listed origins and
  carry `X-Requested-With: XMLHttpRequest` (CSRF layering; SameSite=Lax is the
  first layer).
- **authenticate**: opaque cookie token; only SHA-256 hash stored server-side.
  Expired/invalidated/deactivated => 401 with stable codes.
- **scope.service**: authoritative source of "which institutions may this user
  act on". College => own institution; officer => OfficerJurisdiction rows;
  empty scope => empty results (never all rows).
- **Errors**: `AppError` with machine codes from `@sih26265/contracts`.

## Data model (highlights)

- Money: `amountMinor BigInt` minor units; serialized `{currency, amountMinor: string}`.
- Calendar dates: `@db.Date` columns + `{@db.Date}`-round-trip helpers
  (`parseLocalDate`/`toDateOnly`); "today" derived in `BUSINESS_TIMEZONE`
  (default Asia/Kolkata).
- FDR versioning: `Fdr` (current) + append-only `FdrVersion` snapshots;
  corrections produce new versions (stage 2 uses this for re-verification).
- Replacement links: `previousFdrId` on submit, `supersededByFdrId` set only on
  authorised acceptance - reports never double-count.
- `Task.deduplicationKey` gives idempotent worker/seed task creation.
- `JobRun` records every scheduled run's outcome.
- `AuditEvent` records auth + document actions.

## Document storage adapters

`backend/src/integrations/storage/`:

- **Interface** (`types.ts`): `put(bytes, key)`, `get(key)`, `delete(key)` -
  write-once semantics, adapter never trusts client paths.
- **Keys** (`keys.ts`): `buildObjectKey` generates `fdr/<id>/<YYYY-MM>/<uuid><ext>`
  (client file names contribute only a sanitized extension);
  `assertValidObjectKey` rejects traversal/absolute/empty segments.
- **Local adapter** (`localFileStorage.ts`): directory from `LOCAL_STORAGE_DIR`
  (default `<repo>/storage/local-dev`, git-ignored, outside frontend/public).
  Resolves every key against the root and refuses anything escaping it; uses
  write-once (`wx`); missing files 404. Mode default for development.
- **S3 adapter** (`s3Storage.ts`): AWS SDK v3 lazily imported only when
  `STORAGE_DRIVER=s3`; clear error when bucket credentials are missing - it never
  silently downgrades to local/temp storage. Works with AWS S3 or any
  S3-compatible endpoint (MinIO/R2/Wasabi) via `S3_ENDPOINT`.

Document metadata (fdrId, fileName, mimeType confirmed by magic bytes, size,
sha256 checksum, uploader) lives in PostgreSQL; bytes never enter the DB and
never sit in a publicly served directory.

## Worker

`backend/src/jobs/worker.ts` runs `runDeadlineReminderJob`:

- one-shot (`worker:once`, suited for OS schedulers) or `watch` interval mode;
- deduplication via `Task.deduplicationKey`
  (`DEADLINE_REMINDER:fdr:<id>:t<stage>` / `:matured`) - repeated runs add nothing;
- single-scheduler guarantees: local pid lock file (`storage/worker.lock`) with
  dead-owner recovery, plus a PostgreSQL advisory lock around each pass so
  concurrent passes cannot interleave;
- every pass is recorded in `JobRun`.

Thresholds come from `SAMPLE_REMINDER_THRESHOLDS_DAYS` (default 30/14/7) and are
SAMPLE demonstration configuration, not official AICTE rules.

## Frontend

- Vite dev server proxies `/api` to localhost:4000 (single origin; cookies work).
- `AuthProvider` hydrates `/api/auth/me`; `AppLayout` renders role-aware nav;
  routes guard on auth. Role-specific dashboards read from
  `/api/dashboard` (counters scoped server-side).
- Upload/download UI intentionally ships behind the API in Stage 1 (see
  `demo/scenarios.md` for curl usage); the submission/correction UI is stage 2.

## Environment / config

- `backend/.env` (never committed) - see `backend/.env.example`.
- The database URL is `DATABASE_URL` (Railway public string, or the bundled
  local PostgreSQL on localhost:5433).
- `LOCAL_STORAGE_DIR` guards against residing in `frontend/public` at boot.
