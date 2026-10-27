# Stage 2 working notes (WIP checkpoint)

Where the work stands at the moment of this checkpoint commit. Attached so any
future session (or a fresh review) can resume without reverse-engineering the
state. This file will be removed/renamed once Stage 2 is finished and the main
docs are refreshed.

## Already done (all typecheck-green)

- Schema migrations `20261028140000_stage2`, `20261028150000_check_evidence_ref`
  applied; `prisma/seed.ts` v3 (admin, Kaveri isolation case, isolated officer).
- Contracts v2 (case/readiness/workflow/institutions/notifications/reports/audit
  + extended auth/common/tasks/dashboard/fdr/errors).
- Backend foundations: money, checkFields registry, scope service, authenticate
  + requirePasswordNotPending, audit (safe summaries), notifications, serializers.
- Workflow services: fdrWrite (draft/submit/replacement-target), review
  (start/check/verify), corrections (respond -> version + check invalidation),
  replacements (accept = supersession in one tx), releases (serializable guard,
  recommend/approve/reject/complete), approval queue.
- Admin services: institution (list/create/update/status w/ session revocation,
  assign/unassign, detail) + user admin (list/provision with one-time temp
  password/reset/set status/revoke sessions).
- caseDetail.service.ts rebuilt after it vanished from disk (getCaseDetail with
  permissions/next-action/readiness/guidance + getCaseGuidance fallback).
- report.service.ts (5 kinds + CSV export with formula-injection guard).
- Routes written so far: case, corrections, replacements, releases, approvals,
  notifications, reports, audit, institutions (admin module).

## Still to do

1. `routes/admin.routes.ts` (user admin) - list/provision/password-reset/
   status/revoke-sessions.
2. Extend `routes/fdr.routes.ts`: POST create draft (optional `replacesFdrId`
   query for the replacement wizard), PATCH /:fdrId/draft, POST /:fdrId/submit,
   POST /:fdrId/review/start, POST /:fdrId/checks, POST /:fdrId/verify.
3. `routes/auth.routes.ts`: add "admin" to the login context enum (contracts
   already allow it) + POST /change-password.
4. `routes/index.ts`: mount requirePasswordNotPending after authenticate, then
   /cases /corrections /replacements /releases /approvals /notifications
   /reports /audit /institutions /admin.
5. Backend `npm run typecheck`, build.
6. Frontend: role-aware NAV_ENTRIES + routes (dashboards per role, FDR register
   with URL state, submit wizard, case workspace 7 tabs, corrections,
   replacements, releases, approvals, tasks, notifications, admin
   Colleges/Users/Settings + detail, reports + CSV download, audit view,
   change-password + temp-password card). Shared: useUrlState, DataTable,
   SearchSelect, toasts, breadcrumbs.
7. Tests: adjust scope/task/dashboard suites; acceptance scenarios 1-16 on
   `fdr_portal_test` (never on the dev DB).
8. Docs refresh + demo/scenarios.md; final verify (typecheck/build/test);
   cleanup; commit + push to origin/main.

## Conventions to keep

- SAMPLE/SIMULATED labels everywhere; no official AICTE claims.
- Money only as rupee strings -> server minor units (bigint).
- Dates through utils/dates (businessToday).
- Admins never gain officer capabilities; models enforce role + scope.
- Dev DB `fdr_portal` on bundled PostgreSQL :5433; tests on `fdr_portal_test`.
