# Workflows (what happens with an instrument)

All flows below are implemented, persisted, and server-enforced (role +
scope on every call). SAMPLE-labelled thresholds are illustrative.

## 1. Submission (college)

1. College creates a draft: `POST /api/fdrs` → status `draft`, `versionNo 0`.
   A replacement is created with `?replacesFdrId=N` (validated: predecessor
   belongs to the institution and is matured/verified).
2. College attaches ≥1 supporting document (PDF/JPEG/PNG, magic-byte
   verified, private storage, checksummed).
3. Submit: atomic transaction creates the immutable **version 1** snapshot
   (`FdrVersion`), sets status `submitted`, and notifies in-jurisdiction
   officers. Money arrives as a rupee string, is stored as minor units
   (bigint); version history keeps every prior snapshot unchanged.

## 2. Review & verification (reviewing officer)

1. Start review: status `submitted → under_review`.
2. Evidence checks are recorded on the current version:
   - `SIMULATED_BANK_CHECK` (field `amount`): the server derives
     MATCH/MISMATCH deterministically from the submitted vs observed value.
   - `MANUAL_OFFICER_REVIEW` (e.g. `reference_no`, `bank_name`): the officer
     records the observed value + outcome.
   All checks are labelled with their source; nothing is random.
3. Verify is **blocked (409 CONFLICT)** until readiness passes: ≥1 document,
   required checks present and MATCH on the current version, no open
   corrections. The response lists the remaining blockers.
4. Verified: status `verified`, timestamp + verifier recorded.

## 3. Correction loop

1. Officer requests corrections per field (reason required): status may move
   to `discrepancy`; the college is notified.
2. College responds once: one transaction creates **version n+1** (immutable)
   and invalidates the affected verification checks
   (`invalidatedAt`/`invalidatedVersionNo`) so stale evidence never silently
   counts. Unaffected checks survive.
3. Officer re-records evidence against the new version and verifies again.
4. Only open requests can be cancelled (officer action).

## 4. Release (refund after maturity)

`requested → recommended → decided (approved/rejected) → completed`

1. College requests with evidence (e.g. original FDR receipt).
2. Reviewing officer recommends (OPEN, decision `recommended`).
3. Approving authority approves or rejects (status DECIDED).
4. Approval is not completion: the authority later records the **external
   refund evidence** (type, reference, date, completed amount, note) —
   decision `completed`, completer identity stored.

## 5. Replacement (renewal)

1. From a matured, verified case the college creates a replacement draft
   (`?replacesFdrId`), attaches the new receipt and submits it.
2. Officer verifies it like any submission, then recommends.
3. Approving authority accepts → the supersession is a recorded fact
   (`previousFdrId` / `supersededByFdrId`) and the renewal obligation closes.
   Rejecting leaves no supersession. Only one live supersession per
   predecessor.

## 6. Administration (SYSTEM_ADMIN)

- Provision college users: the one-time temporary password is shown exactly
  once in the response and stored only as a hash; `mustChangePassword` gates
  every other API call until replaced.
- Password reset (revokes sessions), activate/deactivate, revoke sessions.
- Jurisdiction assignment (`REVIEW_OFFICER` | `APPROVING_AUTHORITY` roles) —
  admins never gain review/approval powers themselves.

## 7. Deadline reminders (worker)

30/14/7-day SAMPLE thresholds + matured instruments; deduplicated staged
reminders, escalation stages recorded, `JobRun` bookkeeping, single-scheduler
guards. Run via `npm run worker:once` / `npm run worker`.

## Acceptance coverage

`backend/tests/workflow.test.ts` runs 8 end-to-end scenarios on
`fdr_portal_test` (submission→verify, document gate, correction versioning +
invalidation, role negatives, replacement supersession, release lifecycle,
admin provisioning + forced password change, isolation falsification
attempts). Full suite: 71 tests green.

## Demo walkthrough

See `demo/scenarios.md`; it pairs this pipeline with concrete sample accounts
and UI/curl steps.
