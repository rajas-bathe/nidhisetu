# Demo scenario walkthrough

All data below is SYNTHETIC SAMPLE data (seeded via `npm run db:seed -- --yes`).
No real instruments, no real money, no official AICTE regulations are involved.

Prerequisites (3 terminals):

```powershell
npm run local:db          # terminal 1 (keep running)
npm run db:apply
npm run db:seed -- --yes  # explicit opt-in
npm run dev               # terminal 2
```

## Scenario A - College (Lotus) sees its own world

1. Open http://localhost:5173, log in as
   `college.lotus@demo.fdrportal.local` / `Demo#College1` (portal: College).
   The login is portal-aware: the same password on the Officer portal fails.
2. Dashboard: counters + task list reflect only Lotus rows (9 seeded
   instruments, incl. matured/approaching/discrepancy cases).
3. My FDRs: instruments incl. `FDR-2026-0005` (12 days to maturity) and
   `FDR-2026-0006` (matured, marked for renewal).

## Scenario B - Isolation (Shivalik cannot see Lotus)

1. Log out; log in as `college.shivalik@demo.fdrportal.local` /
   `Demo#College2`.
2. My FDRs lists only the 2 Shivalik instruments (FDR-2026-0008/0009).
   Guessing Lotus' FDR ids in API paths returns the same 404 as nonexistent.
3. As Shivalik, `GET /api/documents/1` (a Lotus document id) => 404, identical
   to a missing document (no existence leak).

## Scenario C - Officer reviews within jurisdiction

1. Log in as `officer.review@demo.fdrportal.local` / `Demo#Officer`
   (portal: Officer). This officer has jurisdiction over both demo
   institutions: the dashboard aggregates both, and an `institutionId`
   filter narrows to one.
2. Officer accounts can download instruments' documents (authorized route),
   but cannot upload (403).

## Scenario D - Document upload + download (private storage)

Using curl with the college session cookie (`$c` captured from login):

```powershell
# login, keep the cookie
curl.exe -s -c .cookies -H "Content-Type: application/json" `
  -H "Origin: http://localhost:5173" -H "X-Requested-With: XMLHttpRequest" `
  -d "{\"email\":\"college.lotus@demo.fdrportal.local\",\"password\":\"Demo#College1\",\"context\":\"college\"}" `
  http://localhost:4000/api/auth/login

# make a tiny valid PDF-ish sample file (demo-only content)
Set-Content -Encoding Ascii storage\fdr-demo-note.txt "SAMPLE - NOT A BANK DOCUMENT"
# NOTE: a real browser upload is the intended UX (stage 2); the API accepts
# a pdf whose bytes begin with %PDF, e.g. a prepared sample file:
curl.exe -s -b .cookies -H "Origin: http://localhost:5173" -H "X-Requested-With: XMLHttpRequest" `
  -F "file=@sample-file.pdf;type=application/pdf" `
  http://localhost:4000/api/fdrs/1/documents

# list, then download
curl.exe -s -b .cookies http://localhost:4000/api/fdrs/1/documents
curl.exe -s -b .cookies -o out.pdf http://localhost:4000/api/documents/1
```

Expected: upload => 201 with metadata (sha256, size, SAMPLE uploader name);
a second identical upload => 409; foreign-institution ids => 404.
Files live in `storage/local-dev/` (git-ignored, outside frontend/public) and
the bytes never show up in the API listing - only metadata does.

Try cheating: uploading `MZ...` bytes declared as pdf => 422
("content does not match its declared type"); a text file with
`Content-Type: application/pdf` => 422; >10MB (MAX_UPLOAD_MB) => 422.

## Scenario E - Deadline worker (deduplicated reminders)

```powershell
npm run worker:once       # creates reminder tasks for approaching/matured FDRs
npm run worker:once       # runs again: created = 0 (dedup keys), a JobRun row added
```

Run it twice on purpose: the FDRs inside the 30/14/7-day SAMPLE window get one
task per crossed stage; nothing duplicates. Two workers at the same tick:
one runs, the other logs "lock busy" and skips.
Watch mode for a live demo: `npm run worker` (Ctrl+C to stop).

## Scenario F - Login hardening

- 8 wrong attempts on one email within 10 minutes => 429 RATE_LIMITED.
- Cross-portal logins => 403 WRONG_LOGIN_PORTAL (college via officer portal
  and officer via college portal).
