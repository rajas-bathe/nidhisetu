# SIH26265 - Security Deposit / FDR Portal (Stage 1)

Prototype portal for engineering colleges to register fixed-deposit/security-deposit
instruments, and for reviewing officers / the approving authority to verify,
monitor and act on them - with strict per-institution data isolation.

**Status: Stage 1 complete and runnable.** Stage 1 covers authentication,
institutions, institution-scoped dashboards/lists, private document upload/download
and deadline-reminder jobs. The submission - verification - correction workflow
(evidence recording, corrections, releases) is the next stage and its surfaces are
already modelled in the schema/contracts.

Everything runs **without Docker** on plain Node.js + a bundled PostgreSQL binary.
Docker Compose files are kept as an optional alternative.

---

## Quick start (local, Windows PowerShell)

```powershell
# 1. one-time install
npm install

# 2. terminal 1: start the bundled local PostgreSQL (port 5433)
npm run local:db

# 3. terminal 2: create schema + optional demo data
npm run db:apply
npm run db:seed -- --yes          # explicit opt-in; upserts only, deletes nothing

# 4. terminal 3: run backend + frontend together
npm run dev

# extra terminal (optional): deadline reminder worker (one-shot or watched)
npm run worker:once
npm run worker
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000/api/health
- Demo logins (SAMPLE accounts from the seed):

| Role | Email | Password |
| --- | --- | --- |
| College A (Lotus) | college.lotus@demo.fdrportal.local | Demo#College1 |
| College B (Shivalik) | college.shivalik@demo.fdrportal.local | Demo#College2 |
| Reviewing officer | officer.review@demo.fdrportal.local | Demo#Officer |
| Approving authority | authority.approve@demo.fdrportal.local | Demo#Authority |

All demo rows are synthetic and labelled SAMPLE in payloads/logs; they represent
no real instruments and no official AICTE regulations.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | run backend (4000) + frontend (5173) together |
| `npm run local:db` | start the bundled local PostgreSQL (Ctrl+C stops it) |
| `npm run db:apply` | apply committed migrations (safe; status is checked first by prisma) |
| `npm run db:status` | show migration status of the current DATABASE_URL |
| `npm run db:generate` | (re)generate the Prisma client |
| `npm run db:seed -- --yes` | seed/upsert demo data (opt-in; repeatable; non-destructive) |
| `npm run worker:once` | run the deadline-reminder job once (also for OS schedulers) |
| `npm run worker` | run the worker in watch mode (single-instance guarded) |
| `npm run test` | run the backend test suite |
| `npm run build` | production builds (contracts + backend + frontend) |
| `npm run typecheck` | TS typecheck of all workspaces |

## Switching to Railway PostgreSQL (production/dev-shared DB)

`backend/.env` is the only file to edit (never committed):

```ini
# Railway -> your database service -> Connect -> use the PUBLIC host/port user/db
DATABASE_URL="postgresql://<user>:<password>@<public-proxy-host>.rlwy.net:<port>/<db>"
```

Requirements and cautions:

- Use the **externally accessible** connection string; a Railway
  private-network hostname will not resolve from a laptop.
- Check first with `npm run db:status`, then `npm run db:apply` (deploy-only, no resets).
- Do **not** seed remote/shared databases casually: the seed refuses non-localhost
  hosts unless `SEED_ALLOW_REMOTE=true` is set for that run.
- Keep `STORAGE_DRIVER=local` for the demo; for a durable deployment switch to
  `STORAGE_DRIVER=s3` + the `S3_*` keys (see `docs/deployment.md`).

## Tests

```powershell
npm run local:db     # supplies the dedicated fdr_portal_test database
npm run test         # rules unit tests + PostgreSQL integration tests
```

- Integration tests run against the **dedicated** `fdr_portal_test` database
  (name-checked; refusal if `TEST_DATABASE_URL` equals the dev/prod URL or lacks
  "test" in the name). Tests truncate only that test database.
- If no test database is available, the suite still runs the pure unit tests and
  honestly reports DB-dependent suites as **skipped/not run** (never mocked).

## Security model (implemented in DB + code, not UI-only)

- Sessions: server-side, opaque token in an `HttpOnly; SameSite=Lax` cookie
  (only SHA-256 hashes stored; login rate limited per ip+email).
- Portals: college vs officer enforced against the DB role, not the request.
- Data scope: college accounts only ever see their institution; officers only
  their recorded jurisdiction; empty scope yields empty results.
- Documents: uploaded to a private directory (or S3 bucket), only reachable
  through authorized backend routes; metadata lives in PostgreSQL; foreign
  document ids look identical to nonexistent ones (no existence leak).
- All mutating requests pass an Origin-allowlist + custom-header CSRF guard.

## Documentation

- `docs/architecture.md` - layers, storage adapters, decision records
- `docs/api-contracts.md` - endpoint + payload reference
- `docs/workflow.md` - instrument lifecycle (implemented vs stage-2)
- `docs/deployment.md` - Railway/Vercel/S3 setup, Docker-free workflow
- `docs/implementation-status.md` + `docs/handoff.md` - what exists, what's next
- `demo/scenarios.md` - guided demo script for the prototype walkthrough
