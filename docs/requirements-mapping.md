# Requirements mapping (SIH26265, Stage 1)

Each line maps a published-problem/design-guide requirement to what exists in
this repository. Sample policies are labelled SAMPLE - they are placeholders,
NOT official AICTE rules, and are marked as such in payloads, seeds and UI.

| Requirement (published problem / design guide) | Implementation |
| --- | --- |
| College account can register & log in | POST /api/auth/login with DB-backed sessions, rate limiting; seeded SAMPLE accounts for demo |
| Three roles: college user, reviewing officer, approving authority | UserRole + server-enforced requireRole guards; portals enforce role (WRONG_LOGIN_PORTAL) |
| A separate college must not access another's records by guessing IDs | scope-aware queries; document/list FDRs filter by officer jurisdiction or own institution; IDs outside scope behave as nonexistent (404) |
| Correction/re-upload must create a NEW version (append-only history) | Fdr + FdrVersion snapshots; verification checks attach to the reviewed version; corrections planned to invalidate affected checks (stage 2 mechanics ready) |
| Verification depends on independent evidence, not just an upload | VerificationCheck model with sources (simulated bank check / manual officer review / document fingerprint) - recording UI is stage 2; everything in demo data is labelled SAMPLE/SIMULATED |
| Officer dashboard: pending items, approaching maturity, overdue | GET /api/dashboard counters + tasks incl. overdue flags; worker creates reminder tasks (SAMPLE thresholds 30/14/7 days) |
| Wall-clock matters; submitted deadlines derive from recorded dates | calendar-date columns + business-timezone helpers; dateCondition derived, released state derives only from recorded decisions |
| Release after maturity/withdrawal needs separate approval flow | ReleaseRequest state machine modelled (requested -> recommended/rejected -> approved -> completed); interactive flow stage 2 |
| Replacement re-registering before maturity must be authorized | previousFdrId/supersededByFdrId links; dashboards exclude superseded instruments |
| Audit trail for sensitive actions | AuditEvent (login/logout, document upload/download; stage 2 adds verification/decision actions) |
| Storage of receipts must be private (not publicly hosted) | local private directory adapter + auth/scoped download routes; S3 adapter for deployment; metadata in PostgreSQL |
| Reminder/notification engine | deadline worker with dedup keys + JobRun bookkeeping; Notification rows modelled (delivery provider stage 2) |
| Prototype must handle multiple colleges | 2 seeded institutions + jurisdictions; isolation tests with two colleges |
| Data separation approval-hold vs reviewed conditions | review status vs dateCondition vs release status kept as separate fields |

## Explicit non-goals / honesty notes

- No claim of official AICTE compliance; threshold values are SAMPLE config.
- No guarantee of selection or production-readiness beyond the stated scope.
- Simulated bank checks are SIMULATED - evidence never claimed real.
