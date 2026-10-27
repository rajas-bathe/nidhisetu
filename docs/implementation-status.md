# Implementation status (Stage 1)

## Done and verified

- Contracts package builds to CJS + ESM; shared zod validation everywhere.
- Backend: Express 5 + Prisma 6; request pipeline (requestId, http logger,
  CSRF origin guard, rate limiting, DB-backed session auth, role checks);
  scope-aware services and routes for auth/dashboard/fdr/tasks/documents.
- Local private document storage adapter (env-configured directory, generated
  keys, traversal-safe resolution, type+size checks, orphan cleanup) +
  provider-neutral interface + lazy S3-compatible adapter for future
  deployment storage.
- Deadline worker: one-shot + watch CLI, default 30/14/7 SAMPLE thresholds,
  reminder deduplication by stable keys, JobRun bookkeeping, single-scheduler
  guards (local pid lock + advisory lock).
- Seed: opt-in only (`--yes`/`SEED_ALLOW_DEMO=true`), remote-host guard,
  repeatable upserts (no wipes to any DB), SAMPLE labels throughout.
- Windows-friendly npm scripts for everything (no Docker dependency);
  bundled local PostgreSQL runner `npm run local:db` (embedded binary,
  persistent data under `storage/`, the same URL as docker-compose used).
- Committed initial migration (`prisma/migrations/20261028090000_init`),
  applied via `migrate deploy` only.
- Tests: pure date-condition unit tests; PostgreSQL integration suites for
  auth (incl. rate limiting + portal mismatch), institution isolation (incl.
  ID-guess refusal), dashboard counter correctness, documents (validation,
  isolation, adapter traversal), deadline reminders (dedup, boundary,
  superseded skips). Test DB is dedicated and name-guarded; suites skip
  cleanly (reported as NOT RUN, never mocked) when no test database exists.
- Frontend: login screen, session bootstrap, role-aware layout + dashboards,
  My FDRs list, 404/403 pages; builds clean.
- Docs: README, architecture, api-contracts, workflow, deployment, demo
  script, requirements mapping, handoff.

## Not in Stage 1 (stage 2 plan)

- Submission/correction/verification UI flows and their endpoints (the schema
  already carries versions, checks, replacements, releases, jurisdiction).
- Evidence recording against `VerificationCheck` with simulated-source
  labelling; invalidate-on-correction mechanics.
- Release recommendation/approval/completion flows.
- Escalation stage rotation for overdue reminders.
- Document upload/download UI in the app (API + curl demo only right now).
- Email/notification delivery (Notification rows exist but no provider).

## Verification summary

- `npm run typecheck` clean for all workspaces.
- `npm run build` succeeds (contracts CJS+ESM, backend tsc, frontend vite).
- `npm run test` against the bundled local test database (results reported in
  the handoff/run log; DB-dependent suites skip - never mocked - when a test
  database is unavailable).
