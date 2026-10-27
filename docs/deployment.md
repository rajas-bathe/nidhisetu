# Deployment

## The one thing to fill in

`backend/.env` (git-ignored) currently runs against the bundled local database.
For Railway:

1. Railway -> your PostgreSQL service -> **Connect**
2. Copy the **public** connection string (a private-network hostname will not
   work from a laptop)
3. Put it in `backend/.env`:

```ini
DATABASE_URL="postgresql://<user>:<password>@<proxy-host>.rlwy.net:<port>/<dbname>"
```

4. Verify without touching anything destructive:

```powershell
npm run db:status     # shows applied/pending migrations for this URL
npm run db:apply      # prisma migrate deploy (adds missing migrations only)
```

Never run destructive resets against shared databases. The seed refuses
non-localhost hosts unless `SEED_ALLOW_REMOTE=true` for that explicit run.

## Backend host (Railway service)

- Build: `npm run build` at the repo root (contracts + backend + frontend).
- Start command (backend only): `npm run start -w @sih26265/backend`
  which runs `node backend/dist/server.js`.
- Service variables:
  - `DATABASE_URL` (from the DB plugin)
  - `NODE_ENV=production`, `COOKIE_SECURE=true`
  - `ALLOWED_ORIGINS=https://<your-frontend-domain>`
  - storage (see next section)
- Health check path: `/api/health`.

## Storage driver

Development/demo keeps `STORAGE_DRIVER=local` + `LOCAL_STORAGE_DIR` default
(`<repo>/storage/local-dev`). Files live in a private, git-ignored directory and
are reachable only through `/api/documents/:id` authorization.

For durable deployments you should provision a real bucket:

1. Create an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Wasabi...).
   Deny public reads; the portal serves bytes itself.
2. Set in the backend host environment:

```ini
STORAGE_DRIVER=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
# for non-AWS S3-compatible providers:
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_FORCE_PATH_STYLE=true
```

NOTE: with missing bucket credentials the backend refuses to use `s3` mode with
a clear startup/use error. It never silently substitutes temporary local
storage for a configured-but-unavailable bucket. Until you provision the
bucket, `local` mode remains functional but is *not* durable across deploys.

## Scheduled jobs on a host

Run the worker once per interval with your scheduler (Railway cron, GitHub
Actions, Windows Task Scheduler on self-host):

```powershell
npm run worker:once       # executes one pass and exits
```

or keep it running:

```powershell
npm run worker            # watch mode, interval = JOB_INTERVAL_MINUTES
```

Duplicate-instance resistance: local pid lock file + PostgreSQL advisory lock +
deduplicated reminder keys; a second accidentally started copy will not create
duplicate reminders.

## Frontend (Vercel)

- Import the repo, framework preset: Vite, root directory `frontend`.
- Build command: `npm run build -w @sih26265/frontend`; output: `frontend/dist`.
- Rewrites: route `/api/(.*)` to the Railway backend URL (example
  `vercel.json`):

```json
{ "rewrites": [{ "source": "/api/(.*)", "destination": "https://<backend-host>/api/$1" }] }
```

- No env vars needed by the frontend (absolute API paths are relative `/api`).

## Docker (optional)

`docker-compose.yml` still provisions PostgreSQL (and MinIO under the
`storage` profile) for anyone preferring Compose:

```powershell
docker compose up -d postgres
```

Normal startup does not depend on it; it exists purely as an alternative.
