# Workflows (what happens with an instrument)

Implemented vs planned surfaces, so progress is auditable.

## Stage 1 (implemented)

1. **Registration/login** - accounts exist server-side (seed for the demo).
   College accounts only ever see their institution; officers only their
   recorded jurisdiction. Wrong portal => WRONG_LOGIN_PORTAL, not access.
2. **Instrument list** - `GET /api/fdrs` returns institution-scoped rows with
   derived `dateCondition` (current / approaching_maturity / matured from
   SAMPLE_APPROACHING_MATURITY_DAYS) and derived release status.
3. **Dashboards** - `GET /api/dashboard` counters computed from DB rows only,
   separate review state from date condition; tasks (incl. overdue) listed.
4. **Document upload** - `POST /api/fdrs/:fdrId/documents` (college role, own
   institution only): validated (size, declared type, magic bytes), stored
   under a generated key in the private storage area, metadata in PostgreSQL.
5. **Document download** - `GET /api/documents/:id`: authorized + scoped; an
   id outside your scope looks identical to a nonexistent document.
6. **Deadline reminders** - the worker creates deduplicated, SAMPLE-labelled
   tasks for instruments inside the threshold window and for matured ones.
7. **Tasks inbox** - `GET /api/tasks` shows the acting user's open work with
   overdue flags from calendar dates.

## Stage 2 (modelled, not yet interactive)

- **Submission** of instrument details (a UI form; the schema and version
  snapshots already exist: `Fdr`, `FdrVersion`, `status` flow
  draft -> submitted -> under_review/verified/discrepancy).
- **Verification workflow**: officer reviews the material, records evidence in
  `VerificationCheck` (sources: simulated bank check / manual review /
  document fingerprint - all labelled SIMULATED/SAMPLE in UI + exports),
  decides verified vs discrepancy and, for a discrepancy, requests a
  correction.
- **Correction loop**: corrections create a new `FdrVersion`; the affected
  checks are invalidated (`invalidatedAt`/`invalidatedVersionNo`) so stale
  evidence never silently stays counted.
- **Release handling**: `ReleaseRequest` flow requested -> recommended ->
  approved -> completed (or rejected) with the fdr link remaining auditable.
- **Replacement acceptance**: `previousFdrId`/`supersededByFdrId` completion
  closes the renewal-obligation task only after the approving authority
  accepts the replacement.
- **Escalation** stages recorded in the sample policy row
  (reviewing_officer -> approving_authority), ded chops by task key.

## Demo walkthrough

See `demo/scenarios.md`; it pairs this pipeline with concrete sample accounts
and curl calls.
