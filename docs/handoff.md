# Handoff notes (Stage 2 delivered)

## How to run (exact commands, Windows PowerShell)

```powershell
npm install              # once (approve embedded-postgres script if prompted)
npm run local:db         # terminal 1: bundled local PostgreSQL on :5433
npm run db:apply         # apply committed migrations (idempotent)
npm run db:seed -- --yes # demo data (explicit opt-in, upsert-only)
npm run dev              # terminal 2: backend :4000 + frontend :5173
npm run test             # full suite (71 tests, uses fdr_portal_test only)
npm run build            # production builds of all three workspaces
```

Note: if the shell is elevated (admin), the bundled PostgreSQL refuses to
start. Start seclogon and launch it via a restricted token:

```powershell
Start-Service seclogon
runas /trustlevel:0x20000 "wscript.exe storage\local-postgres\pg-start-hidden.vbs"
```

## Demo accounts (after `npm run db:seed -- --yes`)

| Role | Email | Password | Portal |
| --- | --- | --- | --- |
| System admin | `system.admin@demo.fdrportal.local` | `Demo#Admin` | admin (`context: "admin"`) |
| College (Lotus) | `college.lotus@demo.fdrportal.local` | `Demo#College1` | college |
| College (Shivalik) | `college.shivalik@demo.fdrportal.local` | `Demo#College2` | college |
| College (Kaveri) | `college.kaveri@demo.fdrportal.local` | `Demo#College3` | college |
| Reviewing officer | `officer.review@demo.fdrportal.local` | `Demo#Officer` | officer |
| Officer (no jurisdiction) | `officer.isolated@demo.fdrportal.local` | `Demo#Officer2` | officer |
| Approving authority | `authority.approve@demo.fdrportal.local` | `Demo#Authority` | officer (shared entry) |

The login `context` field is `college | officer | admin`; the approving
authority signs in through the officer portal and only sees actions its role
allows (recommendations queue, decisions — never verification).

## Five-minute walkthrough (all roles)

1. **College (Lotus)**: Dashboard → My instruments → New submission → fill
   fields → upload a PDF receipt → Submit → case shows `submitted`.
2. **Officer review**: log in as `officer.review` → Tasks → open the case →
   Start review → Verification tab → record the amount check
   (SIMULATED_BANK_CHECK, auto-derived MATCH) + reference/bank manual checks
   → Verify (blocked with 409 + blockers until all recorded).
3. **Correction loop** (optional): raise a correction on `amount`; respond as
   the college → a new immutable version is created, the stale check is
   invalidated; re-record and verify.
4. **Release**: as the college, open a verified case → Request release (with
   evidence) → officer recommends → authority approves → authority completes
   with the bank refund evidence.
5. **Replacement**: from a matured verified case, New submission with
   `?replacesFdrId`; officer recommends; authority accepts → supersession.
6. **Admin**: log in as `system.admin` → Admin console → provision a college
   user (one-time temporary password shown once) → sign in as that user →
   forced password change → workspace unlocks.

Every screen consumes real authorized APIs; nothing is mocked or hardcoded.

## Architecture map (where things live)

- `packages/contracts` — zod schemas shared by client and server (request +
  response shapes, money as rupee strings → server-side minor units bigint).
- `backend/src/routes/*` — thin route handlers; validation + `requireAuth`.
- `backend/src/services/*` — workflow logic; all writes transactional with
  audit events; scope assertions via `scope.service`.
  - `fdrWrite.service.ts` draft/update/submit; `review.service.ts`
    start/checks/verify + readiness blockers; `correction.service.ts`
    versioned corrections + check invalidation; `replacement.service.ts`
    supersession; `release.service.ts` request/recommend/decide/complete;
    `userAdmin.service.ts` provisioning; `caseDetail.service.ts` +
    `caseGuidance.service.ts` the case workspace payload and next-step
    advice.
- `frontend/src/pages/**` — 16 screens; `frontend/src/services/portal.ts` —
  typed API client.

## Operational notes

- Storage: `STORAGE_DRIVER=local` (dev). For durable deploys provision an
  S3-compatible bucket and switch `STORAGE_DRIVER=s3` (docs/deployment.md).
- Worker: `npm run worker:once` for schedulers, `npm run worker` for a local
  watch interval; duplicate copies refused (pid lock) or safely skip.
- Tests: run `npm run local:db` first so `fdr_portal_test` exists; suites
  otherwise honestly report DB suites as skipped (never mocked).
- Sample policy thresholds (30/14/7 days, approaching window 30 days) are
  labelled SAMPLE; change via a new PolicyVersion row after official rules
  are confirmed.

## Known limitations (honest)

- No email/SMS delivery; Notification rows stay PENDING without a provider.
- DeepSeek guidance integration deferred; deterministic "Case guidance"
  fallback ships (labelled, no randomness).
- SIMULATED_BANK_CHECK is a deterministic stand-in for a real bank API.
- Built and verified on Windows/Node 24; remote Railway deployment uses the
  PUBLIC `DATABASE_URL` (see docs/deployment.md).
