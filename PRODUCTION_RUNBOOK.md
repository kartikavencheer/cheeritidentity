# CheerIT identity: production runbook

For the engineer deploying this to production. Every command below was run on the dev server and worked as
shown. Production differs only in where things live (separate frontend, backend and database servers) and in
how careful you are. Follow the phases in order and do not skip the checks.

## What this does

One account per person across all CheerIT apps, identified by phone number (E.164, India default).

- A new **identity database** (`cheeritidentity`) holds one row per person (`users`) and which apps they use
  (`user_apps`). It holds no app data (no coins, bookings, predictions).
- A small **identity service** (Node, port 4100) is the only thing that reads and writes that database.
- Each **app backend** keeps its own user table and its own database. It gets one new nullable column,
  `identity_id`, and after every successful OTP login it makes one non-blocking call to the identity service.
  If the service is down, slow or the call fails, **login still works** (it logs `[Identity] linking … failed`).
- **Frontends do not change at all.** Nothing in the browser or the mobile wrappers uses identity yet.

Until an app's `.env` has `IDENTITY_SERVICE_URL` and `IDENTITY_API_KEY`, the new code does nothing.

## Apps

| App | Repo | Backend dir (dev) | pm2 name (dev) | Key name | User table / new column |
|---|---|---|---|---|---|
| Score | `Shriya2020/ScoreIT` | `ScoreIT/backend` | `scoreit-backend` | `score` | `si_user.si_user_identityid` |
| GameIT | `Shriya2020/pickleball` | `pickleball/backend` | `pickleball-backend` | `booking` | `users.identity_id` |
| PredictIt | `Shriya2020/predictitapp` | `predictitapp/backend` | `predictit-backend` | `predictit` | `users.identity_id` |
| TurfIT | `Shriya2020/turfitweb` | `turfitweb/Backend` | `turfitweb-backend` | `turfit` | `"User"."identityId"` |
| CheerIT API | `Shriya2020/CheerITWebAPI` (branch `globaldb`) | `CheerITWebAPI/CheerITWebAPIV4` | (not on the dev server above; deployed by the CheerIT team) | `com` | `"User".identity_id` (SQL in `identity_link.sql`) |
| Sponsor | `Shriya2020/CheerIT-Sponsor` | `CheerIT-Sponsor/backend` | `cheerit-sponsor-backend` | `sponsor` | `sp_sponsor_auth_users.identity_id` |

Identity repo: `https://github.com/kartikavencheer/cheeritidentity`, branch `main`. Use `main` from GitHub, not
anyone's local copy.

Sponsor was left out on dev (0 users in the dev database). Decide separately whether to include it; see Phase 8.

## Branches and fixes to deploy

Merge these first so production runs reviewed code:

- **Score:** the identity code plus `fix/verify-otp-on-login` (makes `/api/auth/otp-verify` actually check the
  OTP). **Deploy this Score fix before anything else, on its own.** Without it, anyone can log in to Score as
  any phone number with any code.
- **GameIT and TurfIT:** the identity code plus `fix/identity-skip-data-avatar` (stops sending base64 profile
  photos to the identity service; GameIT photos are up to 300 KB and the service accepts 10 KB, which made the
  call fail with `HTTP 500`).
- **PredictIt:** `master` already has the identity code.

## Topology assumptions

This runbook assumes: one **backend server** runs all app backends under pm2 (as on dev) plus the identity
service; a separate **database server** (or managed Postgres) holds all databases; separate **frontend
server(s)** serve the websites.

- Identity service and the five backends on the **same** backend server: use
  `IDENTITY_SERVICE_URL=http://127.0.0.1:4100`. The service listens on `127.0.0.1` only. Safest option.
- Backends on **more than one** server: start the service with `HOST=<private-ip>` (or `0.0.0.0`) and allow
  port 4100 only from the backend servers in the firewall or security group. Never expose it to the internet.
  Use that private address as `IDENTITY_SERVICE_URL`. The API key is a second layer, not the only one.
- **Frontend servers:** no change, no access to the identity service needed.
- **Database server:** the backend server must reach it on the Postgres port. Replace `<db-host>` below.
  Managed Postgres (for example Aiven) usually needs `?sslmode=require` on the connection strings.
- Requires **Node 22 or newer** on whichever machine runs the identity scripts (they run TypeScript directly).
  Check with `node -v`.

## Rules (all learned on dev)

1. **Back up first**, every app database, before any write.
2. Use **test numbers you own**. A real OTP SMS is sent on every login test. Never use seed or colleague numbers.
3. **Never paste the `<placeholders>`** in commands literally. They must be replaced (this went wrong twice on dev).
4. **Never run `prisma db push` or `prisma migrate deploy`** against an existing database for this change. The
   identity column is added by `link.ts`. Only run `npx prisma generate`. A `db push` can drop data if the schema
   has drifted.
5. One app at a time. Confirm login works before starting the next.
6. Keys are shown **once**. Issuing a key for an app revokes the previous one.
7. Do not commit `.env` files. Several app repos track `.env`; untrack them (Phase 1).

---

## Phase 0: preparation

Have ready: SSH to the backend server; admin access to Postgres; each app's current `DATABASE_URL` (read it from
the app's `.env`, do not guess database names); a phone number you own for tests.

Take backups of **every** app database (run from the backend server, or any host that can reach the database):

```bash
mkdir -p ~/identity-backups
for db in <score_db> <gameit_db> <predictit_db> <turfit_db>; do
  PGPASSWORD='<admin-password>' pg_dump -h <db-host> -U <admin-user> -Fc "$db" \
    -f ~/identity-backups/$db-$(date +%Y%m%d-%H%M).dump
done
ls -la ~/identity-backups        # every file must be non-empty
```

Restore, if ever needed: `pg_restore --clean -h <db-host> -U <admin-user> -d <db> <dumpfile>`.

## Phase 1: security items (before connecting anything)

1. **Score OTP fix** deployed and verified (Phase 6a below). This is the most urgent item.
2. **Sponsor `AUTH_SECRET`:** confirm it is set in Sponsor's production `.env`. If unset, Sponsor falls back to
   the hardcoded secret `"cheerit-demo-secret"` and tokens can be forged.
3. **Committed `.env` files:** `.env` is tracked in git in several app repos (JWT secrets, database passwords,
   SMS keys are in history). Untrack with `git rm --cached .env`, add `.env` to `.gitignore`, and **rotate**
   the secrets that were committed.
4. **Turn off OTP logging and dev OTP mode in production**, otherwise every OTP code is written to the logs:
   - Score: `LOG_OTP_TO_CONSOLE=false`
   - PredictIt: `OTP_DEV_MODE=false`, `OTP_LOG_CODE=false`
   - GameIT and TurfIT: check their OTP / demo-login settings the same way.

## Phase 2: create the identity database

Run on the backend server. `psql` access to the database server as an admin:

```bash
git clone https://github.com/kartikavencheer/cheeritidentity.git
cd cheeritidentity && git checkout main && npm install

export PGPASSWORD='<admin-password>'
psql -h <db-host> -U <admin-user> -d postgres -c "CREATE DATABASE cheeritidentity;"
psql -h <db-host> -U <admin-user> -d cheeritidentity -f sql/001_identity_schema.sql
psql -h <db-host> -U <admin-user> -d cheeritidentity -f sql/002_app_clients.sql
psql -h <db-host> -U <admin-user> -d cheeritidentity -c "\dt"
```

`\dt` must show exactly: `app_clients`, `migration_log`, `migration_runs`, `user_apps`, `users`.
Do **not** run `sql/003_sso_tokens.sql` if it exists in your checkout; it belongs to unfinished SSO work.

Recommended: create a dedicated database user for the identity database instead of using the admin user, and
read-only users for reading the app databases:

```sql
-- on the identity database
CREATE ROLE identity_app LOGIN PASSWORD '<strong-password>';
GRANT ALL PRIVILEGES ON DATABASE cheeritidentity TO identity_app;
-- then, connected to cheeritidentity:
GRANT ALL ON ALL TABLES IN SCHEMA public TO identity_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO identity_app;

-- on EACH app database (repeat per database), for the read-only dry run and apply step:
CREATE ROLE identity_ro LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE <app_db> TO identity_ro;
-- connected to <app_db>:
GRANT USAGE ON SCHEMA public TO identity_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO identity_ro;
```

Check pg_hba / the security group lets the backend server connect.

## Phase 3: configure the identity folder

Create `cheeritidentity/.env` (never commit it):

```
IDENTITY_URL=postgresql://identity_app:<pw>@<db-host>:5432/cheeritidentity
PORT=4100
# HOST=127.0.0.1            # default; see "Topology assumptions" if backends are on other servers

# Read-only, used by dry-run and apply. Leave a line empty to skip an app.
SRC_SCORE_URL=postgresql://identity_ro:<pw>@<db-host>:5432/<score_db>
SRC_BOOKING_URL=postgresql://identity_ro:<pw>@<db-host>:5432/<gameit_db>
SRC_PREDICTIT_URL=postgresql://identity_ro:<pw>@<db-host>:5432/<predictit_db>
SRC_TURFIT_URL=postgresql://identity_ro:<pw>@<db-host>:5432/<turfit_db>
SRC_SPONSOR_URL=            # leave empty to skip Sponsor

# Write access, used only by link.ts to add and fill the identity column. Use each app's own
# database owner credentials (the same user the app's DATABASE_URL uses).
LINK_SCORE_URL=postgresql://<owner>:<pw>@<db-host>:5432/<score_db>
LINK_BOOKING_URL=postgresql://<owner>:<pw>@<db-host>:5432/<gameit_db>
LINK_PREDICTIT_URL=postgresql://<owner>:<pw>@<db-host>:5432/<predictit_db>
LINK_TURFIT_URL=postgresql://<owner>:<pw>@<db-host>:5432/<turfit_db>
LINK_SPONSOR_URL=
```

Every command below uses `node --env-file=.env` so the variables are read. (Without it the scripts report
`Skipped` for every app. That happened on dev.) Add `?sslmode=require` to a URL if the database needs SSL.
`SRC_*` and `IDENTITY_URL` must be **different databases**; the script refuses to write into the one it reads.

## Phase 4: dry run (reads only, writes nothing)

```bash
cd cheeritidentity
node --env-file=.env src/dry-run.ts
```

Expected: one `Reading <app> from … (read-only)` line per app, then
`N records -> M people (K in several apps, R rejected phones).` No `Skipped:` line for an app you configured.
Open the report folder it names (`out/<timestamp>/`) and review it. On dev it was 42 records to 16 people.

Read the report with someone who knows the users:
- **name_conflict** warnings are harmless (spelling differences; the most recently active app wins).
- **same_app_multiple_roles** is by design (one person with TurfIT player + owner, Score user + admin).
- **invalid_phone** rows (placeholders such as `9999999999`) are listed and left out. Those users keep working.
- If an app shows 0 records, its `SRC_*` database or table is wrong. Fix before going on.

Stop here and get sign-off on the numbers before Phase 5.

## Phase 5: write the people, then link each app

### 5a. Write people and memberships (writes only to the identity database)

```bash
node --env-file=.env src/apply.ts                 # plan: must match the dry run
node --env-file=.env src/apply.ts --apply         # writes
node --env-file=.env src/apply.ts --verify-only
node --env-file=.env src/apply.ts --apply         # repeat: must write 0 new people, 0 new memberships
```

Expected after `--apply`: `Written: N new people … 0 ownership clashes`, then six `PASS` lines. The second
`--apply` must say `0 new people … 0 new memberships`. Any `FAIL` or ownership clash: stop and investigate.

### 5b. Link each app database (first write to the app databases)

```bash
node --env-file=.env src/link.ts                  # plan: shows "column not added yet", rows to link per app
node --env-file=.env src/link.ts --apply          # adds the nullable identity column and fills it, per app
node --env-file=.env src/link.ts --verify-only
node --env-file=.env src/link.ts --apply          # repeat: must link 0 new rows
```

Expected per app: `Written: column ensured, N rows linked.` and `Verification PASS … 0 mismatched, 0 unknown`.
`NOT IN IDENTITY: 1` for an app is normal if it has an invalid-phone user (for example a placeholder).
The script refuses an app if any row already holds a different identity; do not override that, investigate.

The column added is additive (nullable) and harmless to the apps even before their code is updated.

## Phase 6: start the identity service and issue keys

```bash
cd cheeritidentity
pm2 start "npm start" --name identity
pm2 save
curl http://127.0.0.1:4100/health          # must return {"ok":true}
```

Make pm2 survive reboots once: run `pm2 startup` and execute the command it prints.

Issue one key per app (shown once; the command extracts the key and prints only its length). The expected
length is about 53 to 57 characters. A length of `0` means it failed; stop:

```bash
cd cheeritidentity
KEY=$(npm run -s issue-key -- score | grep -o 'cid_score_[A-Za-z0-9_-]*'); echo "score key length: ${#KEY}"
```

Better: write the key straight into that app's `.env` (next phase) in the same shell, so it is never displayed
or copied by hand.

## Phase 7: deploy each app, one at a time

Order: **Score first** (it carries the security fix), then PredictIt, TurfIT, GameIT.

For each app, on the backend server:

```bash
# 1. deploy the code through your normal process (merged branch from "Branches and fixes to deploy")
# 2. in the backend directory:
npm install
npx prisma generate            # Prisma apps only: Score, GameIT, PredictIt, TurfIT. NOT migrate deploy, NOT db push.

# 3. issue the key and add the two env lines (replace <key-name> and <backend-dir>; run the echo lines ONCE)
cd <path>/cheeritidentity
KEY=$(npm run -s issue-key -- <key-name> | grep -o 'cid_<key-name>_[A-Za-z0-9_-]*'); echo "len ${#KEY}"
cd <backend-dir>
grep -c '^IDENTITY_' .env          # must be 0 before you add; 2 afterwards
echo "" >> .env
echo "IDENTITY_SERVICE_URL=http://127.0.0.1:4100" >> .env
echo "IDENTITY_API_KEY=$KEY" >> .env
unset KEY

# 4. restart so the new environment is loaded
pm2 restart <pm2-name> --update-env
pm2 logs <pm2-name> --lines 30 --nostream
```

Key names and pm2 names are in the Apps table. Backend directories and process names on production may differ;
use `pm2 jlist` to find each app's folder (`pm_cwd`).

### 7a. Score: verify the OTP fix before anything else

With a number you own (an SMS is sent). `<port>` is Score's `PORT`:

```bash
curl -s -X POST localhost:<port>/api/auth/send-otp -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>"}'
curl -s -X POST localhost:<port>/api/auth/otp-verify -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>","otp":"000000"}'
# MUST return {"error":"OTP invalid"} (or "OTP invalid or expired") and NO accessToken
curl -s -X POST localhost:<port>/api/auth/otp-verify -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>","otp":"<code from the SMS>"}'
# must return an accessToken
```

If the wrong code returns an `accessToken`, the fix is not deployed. Do not continue with Score.

### 7b. After each app: test

1. Log in on that app's website with your own number (real OTP).
2. Check the person updated (run on the backend server):
   ```bash
   PGPASSWORD='<pw>' psql -h <db-host> -U identity_app -d cheeritidentity -c \
   "select u.phone, a.app_key, a.last_seen_at from users u join user_apps a on a.user_id=u.id \
    where u.phone='+91<your10digits>' order by a.last_seen_at desc nulls last;"
   ```
   The app you just used must show a `last_seen_at` of the last minute or so. (Do not filter by `app_key` unless
   you want one app only; a filtered query hides the others, which confused testing on dev.)
3. Check for warnings (empty output is good):
   ```bash
   pm2 logs <pm2-name> --lines 100 --nostream | grep -i identity
   ```

Do not move to the next app until step 2 shows a fresh time.

### 7c. After all apps: service-down test

```bash
pm2 stop identity
# log in on one app: it must still work; its log shows "[Identity] linking … failed"
pm2 start identity
curl http://127.0.0.1:4100/health      # {"ok":true}
```

## Phase 8: Sponsor (optional, left out on dev)

Sponsor uses numbered SQL files, not Prisma, and keeps one login per company. The OTP login code lives on the
`stackchnage` branch (not `main`, not `version2`). Before including it:

1. Confirm `AUTH_SECRET` is set (Phase 1).
2. Confirm its production database has `sp_sponsor_auth_users.mobile_number` (migrations `022` and `023`).
   Apply `sql/sponsor_portal/024_identity_link.sql` as part of its deploy, or let `link.ts` add the column.
3. Set `SRC_SPONSOR_URL` and `LINK_SPONSOR_URL`, rerun Phases 4 and 5 (they are repeatable), then do Phase 7 for
   `sponsor` (key name `sponsor`, pm2 `cheerit-sponsor-backend`). Only OTP logins link; email+password logins do not.

## Rollback

- **Turn the feature off for one app:** remove `IDENTITY_SERVICE_URL` or `IDENTITY_API_KEY` from its `.env`, then
  `pm2 restart <pm2-name> --update-env`. Login behaves exactly as before.
- **Turn it off everywhere:** `pm2 stop identity`. Apps keep working (they log a warning per login).
- **Undo the data:** `DROP DATABASE cheeritidentity;` The `identity_id` columns are nullable and harmless; leave
  them, or `ALTER TABLE … DROP COLUMN` them later.
- **Restore an app database:** `pg_restore` from the Phase 0 backup.

## Troubleshooting (every problem seen on dev)

| Symptom | Cause and fix |
|---|---|
| dry-run or link prints `Skipped` for every app | The `SRC_*` / `LINK_*` variables were not loaded. Run with `node --env-file=.env …`. |
| `database "cheeritidentity" does not exist` | Create it (Phase 2) or fix the name in `IDENTITY_URL`. |
| `Set IDENTITY_URL …` on start | The variable is named `IDENTITY_URL`, not `DATABASE_URL`. |
| `[Identity] linking … failed: HTTP 401` | Wrong or revoked key. Issue a new one and rewrite the `.env` line; restart with `--update-env`. |
| `HTTP 500 internal_error` and `PayloadTooLargeError` in `pm2 logs identity --err` | The app sent a huge body (a base64 avatar). Deploy `fix/identity-skip-data-avatar` (GameIT, TurfIT). |
| `[Identity] … failed: HTTP 409` | That app user is already linked to a different phone (number changed). Fix by hand; the service never moves a user. |
| Link silently never updates the app's own column, or `identityId` Prisma errors | The Prisma client is stale. Run `npx prisma generate` in that backend and restart it. |
| Key length printed as `0` | The issue command failed. Run `npm run issue-key -- <app>` and read the error. |
| `.env` has `IDENTITY_API_KEY=<…>` or `…PASTE_THE_REST_HERE` | A placeholder was pasted literally. Reissue the key and rewrite the line. |
| Old `Can't reach database server` lines in app logs | The log has no timestamps; they are probably old. `pm2 flush <name>`, hit an endpoint, re-read. |
| `git pull` blocked by local edits on a server | Do not `stash` or `reset`. Apply changes as a patch (`git show origin/<branch> \| git apply --check`) or deploy from CI. |

## Final checklist

- [ ] Backups of all app databases exist and are non-empty
- [ ] Score OTP fix deployed; wrong code returns no token
- [ ] Sponsor `AUTH_SECRET` confirmed; `.env` files untracked and committed secrets rotated
- [ ] OTP logging and dev OTP mode off in production
- [ ] Identity database created; dry run reviewed and signed off
- [ ] `apply.ts --apply` verified (all PASS; repeat writes 0)
- [ ] `link.ts --apply` verified (all PASS; repeat links 0)
- [ ] Identity service running under pm2 with `pm2 save` and `pm2 startup`
- [ ] Each app: key issued, two env lines added once, restarted with `--update-env`, login tested, `last_seen_at` fresh
- [ ] Service-down test passed
- [ ] Nobody committed a `.env` file or pasted a key into chat or a ticket
