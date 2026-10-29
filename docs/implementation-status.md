# Implementation status (Stage 2 complete)

## Done and verified

- Contracts package builds to CJS + ESM; shared zod validation everywhere.
- Backend: Express 5 + Prisma 6; request pipeline (requestId, http logger,
  CSRF origin guard, rate limiting, DB-backed session auth, role checks);
  scope-aware services for every workflow.
- **End-to-end workflows (all persisted, server-enforced authorization):**
  - Submission: draft → documents → submit (atomic version 1; ≥1 supporting
    document required; notifications to in-jurisdiction officers).
  - Review: start review → record evidence checks (SIMULATED_BANK_CHECK
    derives MATCH/MISMATCH deterministically; MANUAL_OFFICER_REVIEW records
    observed values) → verify blocked with 409 + remaining blockers until
    readiness passes.
  - Corrections: officer requests field corrections (reason per field); the
    college responds in one transaction that creates a new immutable version
    and invalidates the affected verification checks; open corrections block
    verification; requests can be cancelled while in review.
  - Replacements: verified replacement of a matured instrument; officer
    recommends, approving authority accepts → supersession recorded
    (previousFdrId/supersededByFdrId).
  - Releases: college requests with evidence; officer recommends; approving
    authority decides; completion requires external refund evidence
    (evidence type/ref/date/amount + completed-by identity).
  - Admin: user directory, provisioning with one-time temporary password
    (hashed at rest, mustChangePassword forced; every other API gated until
    changed), password reset, activate/deactivate, revoke sessions.
  - Case detail: one scoped payload with overview, versions, documents,
    checks, corrections, replacements, releases, tasks and audit trail;
    deterministic "Case guidance" next-step advice (DeepSeek deferred by
    design).
- **Frontend (16 screens, professional UI):** landing page, college/officer
  login, role-aware dashboards with v2 counters, My instruments (search,
  status/maturity filters, pagination), submission wizard (incl. replacement
  mode), case workspace (Overview, Documents, Verification, Corrections &
  versions, Renewal history, Release history, Activity), tasks inbox,
  corrections, releases, replacements, notifications, reports (5 kinds +
  CSV export), admin console, change-password, 403/404.
- Deadline worker: one-shot + watch CLI, 30/14/7 SAMPLE thresholds with
  escalation stages, reminder deduplication, JobRun bookkeeping.
- Seed: opt-in, remote-host guard, repeatable upserts, SAMPLE labels.
- Committed migrations, applied via `migrate deploy` only.

## Acceptance tests

`backend/tests/workflow.test.ts` — 8 scenarios against the dedicated
`fdr_portal_test` database (never the dev DB):

1. Submission → review → simulated evidence checks → verify (409 blockers
   asserted before checks are recorded).
2. Submission requires a supporting document (SAMPLE rule).
3. Correction response → version 2, version-1 snapshot immutable, affected
   check invalidated, unchanged checks survive, re-verify passes.
4. Only the reviewing officer can raise/cancel corrections.
5. Replacement: recommend + accept establishes the supersession; college
   cannot self-accept.
6. Release: request → recommend → approve → complete records external refund
   evidence; college cannot decide.
7. Admin provisioning: one-time temporary password, plaintext never stored,
   forced change gates every other call; non-admins refused.
8. Isolation: foreign institution refused (read/upload/release), no-
   jurisdiction officer sees nothing, college cannot review/verify, approving
   authority cannot verify (separation of duties).

Full suite: **71/71 passing** (7 files). `npm run typecheck` and
`npm run build` clean for all workspaces.

## Known limitations (by design, SAMPLE-labelled)

- DeepSeek case guidance integration is deferred; deterministic fallback ships.
- Notification rows are in-app only (no email provider).
- Simulated bank check is a deterministic stand-in for a real bank API.
