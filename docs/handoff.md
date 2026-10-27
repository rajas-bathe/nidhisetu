# Handoff notes (Stage 1 -> Stage 2)

## How to run (exact commands, Windows PowerShell)

```powershell
npm install              # once (approve embedded-postgres script if prompted)
npm run local:db         # terminal 1: bundled local PostgreSQL on :5433
npm run db:apply         # apply the committed migration (idempotent)
npm run db:seed -- --yes # optional demo data (explicit opt-in, upsert-only)
npm run dev              # terminal 2: backend :4000 + frontend :5173
npm run test             # full test suite (uses fdr_portal_test database)
npm run build            # production builds of all three workspaces
```

The single environment value that matters for Railway:

```ini
# backend/.env  (file is git-ignored; template in backend/.env.example)
DATABASE_URL="postgresql://<user>:<password>@<public-host>.rlwy.net:<port>/<db>"
```

Use Railway's PUBLIC connection string; PRIVATE hostnames will not resolve
from a laptop. Verify with `npm run db:status` before `npm run db:apply`.
Never reset/drop shared databases; the seed refuses remote hosts unless
`SEED_ALLOW_REMOTE=true` is set for that one run.

## Where to continue (Stage 2 code entry points)

- Submission flow: add
  `POST /api/fdrs` + `PATCH /api/fdrs/:id/corrections` in
  `backend/src/routes/fdr.routes.ts` + services - `Fdr`/`FdrVersion` already
  carry draft -> submitted states and version snapshots; reuse
  `scope.service.assertInstitutionInScope` and `audit.service.recordAudit`.
- Verification recording: extend `routes/task.routes.ts` +
  `VerificationCheck` inserts; keep source labelling SIMULATED/SAMPLE.
- Correction invalidations: mark affected checks by
  `fdrId + field + fdrVersionNo < newVersion` in the same transaction that
  creates `FdrVersion (n+1)`.
- Releases: add routes around `ReleaseRequest`
  (requested -> recommended/rejected -> approved -> completed) with
  requireRole checks (REVIEW_OFFICER recommends, APPROVING_AUTHORITY decides).
- Replacement acceptance: set `supersededByFdrId` + close the seeded renewal
  task in one transaction on authority approval.
- UI for documents: upload button on the FDR detail (stage 2) hitting the
  existing multipart endpoint; the API contract is in `docs/api-contracts.md`.

## Operational notes

- Storage: `STORAGE_DRIVER=local` (dev). Before production durability:
  provision an S3-compatible bucket, set the `S3_*` keys in the host and
  switch `STORAGE_DRIVER=s3` (see docs/deployment.md). local mode is NOT
  durable across clean deploys, and S3 mode never silently degrades.
- Worker: use `npm run worker:once` from schedulers, `npm run worker` for a
  local watch interval. Duplicate copies are refused
  (pid lock `storage/worker.lock`) or safely skip tick (advisory lock).
- Seeds: always explicit; `reset-db.ts` remains a guarded LOCAL-ONLY helper
  (never point it at shared/dev remote DBs).
- Tests: run `npm run local:db` first so `fdr_portal_test` exists; suites
  otherwise run pure tests and honestly report the rest as skipped.

## Known limitations (honest)

- No frontend screens for upload yet (API is complete + curl-documented).
- No email/SMS delivery; Notification rows stay PENDING without a provider.
- Sample policy thresholds (30/14/7, approaching window 30 days) are
  illustrative, labelled SAMPLE throughout; replace after official rules are
  confirmed (new PolicyVersion row).
- Local PostgreSQL: the bundled binary cluster on :5433 is a dev convenience
  (its locale is derived from the host regional settings); remote Railway is
  the intended shared environment.
- pretrained builds were done on Windows/Node 24; nothing else was verified.
