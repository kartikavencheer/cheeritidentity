# CheerIT shared identity and cheering: production deployment guide

**This is the one document to follow.** It covers everything, in order: the shared identity (one person per phone number across all apps),
connecting each app, hosting the CheerIT API with single sign-on, and the ScoreIT cheering feature. Every step names the project, the folder,
the exact settings to put in `.env` and the exact commands. Every check says what you must see.

Other files in this repository are background only: `CHEERIT_PRODUCTION_GUIDE.md` (the cheer feature in depth), `PRODUCTION_RUNBOOK.md` and
`PRODUCTION_COMMANDS.md` (earlier versions of Parts B and C), `HANDOFF.md` (status), `CONVERSATION.md` (history), `dev-tools/` (test scripts).
If anything differs, this file is the newer one.

**No secret value appears in any file in this repository. Never type a secret into chat, a ticket or Git.** Settings are named; you supply the values.

---

## 0. Read this first

### 0.1 The six rules (each one was learned by a real failure on the dev server)

1. **Back up every database before any write.** Part B has the commands.
2. **Use phone numbers you own for tests.** Every login test sends a real SMS.
3. **Never paste a `<placeholder>`.** Replace it with the real value first. Pasting `<key>` into a `.env` happened twice.
4. **Never run `prisma db push` or `prisma migrate` on an existing database.** Only `npx prisma generate`. A `db push` can drop data.
5. **One app at a time.** Confirm login works before the next one.
6. **Keys are shown once.** Issuing a key for an app cancels the previous key for that app. Write each key straight into that app's `.env` with the commands below; never read it aloud or paste it.

Two terminal habits that avoid errors: put no `# comment` after a command on the same line, and check a `.env` for **duplicate lines** (the last one wins).

### 0.2 What you are deploying

```
 Viewer ── ScoreIT website ──▶ ScoreIT backend ──▶ Identity service (port 4100) ──▶ Identity database
                 │                    │                      ▲
                 │                    └─ every 15 s: events, teams, logos, scores ─▶ CheerIT API ──▶ CheerIT database
                 │                                                                       ▲   │
                 └── camera, upload ─────────────────────────────────────────────────────┘   └─▶ storage (S3)
 Other apps (GameIT, PredictIt, TurfIT, Sponsor): after every OTP login they tell the identity service who logged in.
 CheerIT: after an SSO login (and after its own OTP login) it does the same.
```

- **Identity database** (`cheeritidentity`): one row per person (`users`) and which apps they use (`user_apps`). No app data.
- **Identity service** (Node, port 4100): the only program that touches that database. It listens on `127.0.0.1` unless you set `HOST`.
- **Each app** keeps its own users and its own database, and gets one new **nullable** column `identity_id`. If the identity service is down, **logins still work**.
- Until an app's `.env` has `IDENTITY_SERVICE_URL` and `IDENTITY_API_KEY`, the new code does nothing.

### 0.3 Which parts you need

| Part | What | Needed for |
|---|---|---|
| A | Security items | always, first |
| B | Identity database and service, data sync | always |
| C | Connect each app (Score, PredictIt, TurfIT, GameIT, Sponsor) | always |
| D | CheerIT API with SSO (add to the live CheerIT, or host a new one) | SSO and the cheering feature |
| E | ScoreIT cheering feature | the cheer card |
| F | CheerIT-COM card (team name and score) | optional |
| G | Final acceptance checks | always |

### 0.4 The worksheet: collect these values before you start

| Value | Your value | Example from the dev server |
|---|---|---|
| Backend server (SSH) | | `ec2-user@<dev-server>`, Amazon Linux 2023, pm2, nginx |
| Database host and port | | `localhost:5432` |
| Database admin user | | `postgres` |
| Identity database name | `cheeritidentity` | `cheeritidentity` |
| Score database | | `postgres` (dev) |
| GameIT database | | `gameit` |
| PredictIt database | | `predictit` |
| TurfIT database | | `turfit_dev` |
| Sponsor database (optional) | | `sponsorit` |
| CheerIT database | | `cheeritback` (new, on the server's own Postgres) |
| Identity service address (as seen by the apps) | | `http://127.0.0.1:4100` |
| CheerIT API address (https, no trailing `/api`) | | `https://devcheerback.avenengage.com` |
| ScoreIT backend and website | | `https://devscoreit.avenengage.com` |
| CheerIT upload bucket and region | | `avencheer-s3-test`, `ap-south-1` |
| An organization id in CheerIT (for the "ScoreIT" competitions) | | any real `org_id` from CheerIT's `Organization` table |
| A phone number you own | | |

---

## Part A. Security items (before connecting anything)

Do these first. Several are urgent.

1. **ScoreIT login fix.** Today any code logs in to Score as any phone number. The fix is in the Score branch `feat/cheerit-cheer` (and in `fix/verify-otp-on-login`). Deploy and verify it in Part C, step C1, before anything else.
2. **Committed `.env` files.** `.env` is tracked in Git in several repositories, including **CheerIT's** (commit "env publish" on its `main`, which holds production database, AWS, SMS and JWT secrets) and the identity repository. Anything ever committed must be treated as exposed: rotate it. Then untrack the file: `git rm --cached .env`, add `.env` to `.gitignore`, commit. **Careful:** a server that pulls this commit can lose its working `.env`. On each server first run `git update-index --skip-worktree .env`, or copy the file aside and restore it after the pull.
3. **CheerIT's create routes have no login check** (`/api/events`, `/api/team`, `/api/venues`, `/api/competition`, `/api/event-groups`, `/api/competition-team`, `/api/scorecards`). Anyone on the internet can create data. Tell CheerIT's team to add authentication. (If they do, ScoreIT will need a credential: not built yet.)
4. **CheerIT's upload route trusts `user_id` from the request body** instead of the login. Tell CheerIT's team.
5. **OTP logging off in production.** Score: `LOG_OTP_TO_CONSOLE=false`. PredictIt: `OTP_DEV_MODE=false`, `OTP_LOG_CODE=false`. Check GameIT and TurfIT the same way.
6. **Sponsor `AUTH_SECRET`** must be set (otherwise it falls back to a hard-coded secret and tokens can be forged).
7. **Rotate secrets that were pasted into chats**: database passwords, AWS keys, SMS key, JWT secrets, identity keys.

---

## Part B. Identity database, service and data sync

Run on the backend server. Needs Node 22 or newer (`node -v`).

### B1. Back up every app database

```bash
mkdir -p ~/identity-backups
for db in <score_db> <gameit_db> <predictit_db> <turfit_db> <cheerit_db>; do PGPASSWORD='<admin-password>' pg_dump -h <db-host> -U <admin-user> -Fc "$db" -f ~/identity-backups/$db-$(date +%Y%m%d-%H%M).dump; done
ls -la ~/identity-backups
```
Every file must be non-empty. Restore if ever needed: `pg_restore --clean -h <db-host> -U <admin-user> -d <db> <file>`.

### B2. Get the code and create the identity database

```bash
git clone https://github.com/kartikavencheer/cheeritidentity.git
cd cheeritidentity
git checkout main
npm install
export PGPASSWORD='<admin-password>'
psql -h <db-host> -U <admin-user> -d postgres -c "CREATE DATABASE cheeritidentity;"
psql -h <db-host> -U <admin-user> -d cheeritidentity -f sql/001_identity_schema.sql
psql -h <db-host> -U <admin-user> -d cheeritidentity -f sql/002_app_clients.sql
psql -h <db-host> -U <admin-user> -d cheeritidentity -c "\dt"
```
`\dt` must list exactly: `app_clients`, `migration_log`, `migration_runs`, `user_apps`, `users`. Do not run any `003_*` file.
Recommended: create a dedicated database user for the identity database and read-only users for reading the app databases (SQL in `PRODUCTION_RUNBOOK.md` Phase 2).

Note: this repository's own `.env` is tracked in Git (local development addresses only). On a server, create your own `.env` and run `git update-index --skip-worktree .env` so a later `git pull` does not replace it.

### B3. Write `cheeritidentity/.env`

Open it with an editor (`nano .env`) so passwords do not enter your shell history. Leave a line empty to skip that app.

```
IDENTITY_URL=postgresql://<identity-user>:<pw>@<db-host>:5432/cheeritidentity
PORT=4100

SRC_SCORE_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<score_db>
SRC_BOOKING_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<gameit_db>
SRC_PREDICTIT_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<predictit_db>
SRC_TURFIT_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<turfit_db>
SRC_SPONSOR_URL=
SRC_COM_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<cheerit_db>

LINK_SCORE_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<score_db>
LINK_BOOKING_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<gameit_db>
LINK_PREDICTIT_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<predictit_db>
LINK_TURFIT_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<turfit_db>
LINK_SPONSOR_URL=
LINK_COM_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<cheerit_db>
```
- `SRC_*` are **read-only** (used by the dry run and by apply). `LINK_*` are the **owner** of each app database (used only to add and fill `identity_id`).
- `IDENTITY_URL` must be a **different** database from every `SRC_*`; the scripts refuse to write into the one they read.
- Add `?sslmode=require` to a URL if that database needs SSL. Every command below uses `node --env-file=.env`; without it the scripts print `Skipped` for every app.
- `SRC_COM_URL` / `LINK_COM_URL` are the CheerIT database. Leave them empty until Part D is done and CheerIT's database has been backed up.

### B4. Dry run (reads only, writes nothing)

```bash
node --env-file=.env src/dry-run.ts
```
You must see one `Reading <app> from … (read-only)` line per configured app and then `N records -> M people (K in several apps, R rejected phones).` with **no `Skipped`** for an app you configured.
Open the report folder it names (`out/<timestamp>/`). On the dev server it was 42 records to 16 people.
- `name_conflict` warnings: harmless (spelling differences).
- `same_app_multiple_roles`: by design (one person with two roles).
- `invalid_phone` rows (placeholders such as `9999999999`): listed and left out; those users keep working.
- An app showing 0 records means its `SRC_*` database or table is wrong. Fix it before going on.

**Stop here and have the numbers signed off.**

### B5. Write the people, then link each app

```bash
node --env-file=.env src/apply.ts
node --env-file=.env src/apply.ts --apply
node --env-file=.env src/apply.ts --verify-only
node --env-file=.env src/apply.ts --apply
```
After the first `--apply` you must see `Written: N new people … 0 ownership clashes` and six `PASS` lines. The second `--apply` must write **0 new people and 0 new memberships**. Any `FAIL` or ownership clash: stop and investigate.

```bash
node --env-file=.env src/link.ts
node --env-file=.env src/link.ts --apply
node --env-file=.env src/link.ts --verify-only
node --env-file=.env src/link.ts --apply
```
Per app you must see `Written: column ensured, N rows linked.` and `Verification PASS … 0 mismatched, 0 unknown`. The second `--apply` links 0 new rows. `NOT IN IDENTITY: 1` is normal for an app that has a placeholder-phone user (or one new signup: re-run `apply.ts`). If an app already holds a different identity on a row, the script refuses: do not override, investigate.
The added column is nullable and harmless to the apps even before their code is updated.

### B6. Start the identity service and keep it running

```bash
cd cheeritidentity
pm2 start "npm start" --name identity
pm2 save
curl http://127.0.0.1:4100/health
```
The answer must be `{"ok":true}`. Make pm2 survive a reboot **once per server**: `systemctl is-enabled pm2-ec2-user` (replace the user). If it says `enabled`, do nothing. If not, run `pm2 startup` and execute the line it prints.

**Topology:** if the identity service and every backend that uses it are on the **same** server, use `IDENTITY_SERVICE_URL=http://127.0.0.1:4100` (safest). If a backend, **including the CheerIT API**, runs on **another** server, start the service with `HOST=<private-ip>` (or `0.0.0.0`) and allow port 4100 **only** from those servers in the firewall or security group. Never expose it to the internet.

### B7. Issue a key and write it straight into the app's `.env` (the pattern used in every Part C step)

```bash
cd <path>/cheeritidentity
KEY=$(npm run -s issue-key -- <key-name> | grep -o 'cid_<key-name>_[A-Za-z0-9_-]*')
echo "key length: ${#KEY}"
cd <backend-dir>
grep -c '^IDENTITY_' .env
echo "" >> .env
echo "IDENTITY_SERVICE_URL=http://127.0.0.1:4100" >> .env
echo "IDENTITY_API_KEY=$KEY" >> .env
unset KEY
```
- The key length must be about **50 to 57**. `0` means it failed: stop.
- The `grep -c` must print **`0`** before you add the lines (so they are not added twice). If an `IDENTITY_` line already exists, replace it with `sed -i "s|^IDENTITY_API_KEY=.*|IDENTITY_API_KEY=$KEY|" .env` instead of appending.
- Key names: `score`, `booking` (GameIT), `predictit`, `turfit`, `sponsor`, `com` (the CheerIT API).

---

## Part C. Connect each app, one at a time

Order: **Score first** (security fix), then PredictIt, TurfIT, GameIT. Sponsor last and optional.

| App | Repo | Branch to deploy | Backend folder | pm2 name | Key name | New column |
|---|---|---|---|---|---|---|
| Score | `Shriya2020/ScoreIT` | `feat/cheerit-cheer` (includes the login fix and the cheer feature) | `ScoreIT/backend` | `scoreit-backend` | `score` | `si_user.si_user_identityid` |
| PredictIt | `Shriya2020/predictitapp` | `master` | `predictitapp/backend` | `predictit-backend` | `predictit` | `users.identity_id` |
| TurfIT | `Shriya2020/turfitweb` | `master` + `fix/identity-skip-data-avatar` | `turfitweb/Backend` | `turfitweb-backend` | `turfit` | `"User"."identityId"` |
| GameIT | `Shriya2020/pickleball` | `main` + `fix/identity-skip-data-avatar` | `pickleball/backend` | `pickleball-backend` | `booking` | `users.identity_id` |
| Sponsor | `Shriya2020/CheerIT-Sponsor` | `stackchnage` | `CheerIT-Sponsor/backend` | `cheerit-sponsor-backend` | `sponsor` | `sp_sponsor_auth_users.identity_id` |

Production folders and process names may differ: find an app's folder with `pm2 describe <pm2-name> | grep "exec cwd"`.
The avatar fix stops GameIT and TurfIT sending base64 profile photos to the identity service (it accepts 10 KB; their photos are up to 300 KB, which made the call fail with HTTP 500).

**The same four steps for every app** (after merging its branch):

```bash
cd <backend-dir>
npm install
npx prisma generate
```
then **B7** (issue the key, add the two lines), then:
```bash
pm2 restart <pm2-name> --update-env
pm2 logs <pm2-name> --lines 30 --nostream
```
`npx prisma generate` only (never `migrate` or `db push`). Sponsor has no Prisma: skip that line.

**After each app, test:** log in on that app's website with your own number (real OTP), then check:
```bash
PGPASSWORD='<pw>' psql -h <db-host> -U <identity-user> -d cheeritidentity -c "select u.phone, a.app_key, a.last_seen_at from users u join user_apps a on a.user_id=u.id where u.phone='+91<your10digits>' order by a.last_seen_at desc nulls last;"
pm2 logs <pm2-name> --lines 100 --nostream | grep -i identity
```
The app you used must show a `last_seen_at` from the last minute or so. The log grep should print nothing. Do not filter the query by `app_key`: a filtered query hides the other apps. Do not move on until the time is fresh.

### C1. Score: verify the login fix first

`<port>` is Score's `PORT`. An SMS is sent.
```bash
curl -s -X POST localhost:<port>/api/auth/send-otp -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>"}'
curl -s -X POST localhost:<port>/api/auth/otp-verify -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>","otp":"000000"}'
```
The second answer **must** be `{"error":"OTP invalid"}` (or "invalid or expired") with **no `accessToken`**. If it returns a token, the fix is not deployed: do not continue. Then verify the real code from the SMS returns a token.
Score's frontend is rebuilt in Part E; the identity step needs only the backend.

### C2. PredictIt
Branch `master` already has the identity code. Backend settings besides identity: `SCOREIT_API_URL` must be Score's API address (PredictIt mirrors Score matches). OTP settings off in production (Part A, step 5).
A newer, **unreviewed** branch `feat/identity-sso-login` (SSO login with another app's one-time token) exists in the same repository. Do not deploy it unless you want login-once across apps and have tested it.

### C3. TurfIT and C4. GameIT
Merge the identity code and `fix/identity-skip-data-avatar`, then the four steps above. Check their OTP / demo-login settings as in Part A.

### C5. Sponsor (optional, left out on dev because it had 0 users)
1. Confirm `AUTH_SECRET` is set. 2. Confirm its database has `sp_sponsor_auth_users.mobile_number` (migrations 022, 023); apply `sql/sponsor_portal/024_identity_link.sql` or let `link.ts` add the column. 3. Set `SRC_SPONSOR_URL` and `LINK_SPONSOR_URL`, repeat B4 and B5 (repeatable), then the four steps with key `sponsor`. Only OTP logins link; email-and-password logins do not.

### C6. Service-down test (once, after all apps)
```bash
pm2 stop identity
```
Log in on one app: it must still work, and its log shows `[Identity] linking … failed`. Then:
```bash
pm2 start identity
curl http://127.0.0.1:4100/health
```

---

## Part D. The CheerIT API: single sign-on and identity

The CheerIT API is the repository `Shriya2020/CheerITWebAPI` (Node, Express, Prisma, PostgreSQL). **Two situations:**

- **D1. CheerIT is already live in production:** add the SSO commit and two settings. This is the production task.
- **D2. You must host a new copy** (as was done for the dev server): follow D2 completely, then D1's SSO steps.

### D0. Which code
The SSO change is **one commit**: `d5f3b67` (5 files, 181 added lines, 0 deleted): `src/utils/identityClient.js`, `POST /api/auth/sso-login`, identity linking after login, `identity_link.sql`, 6 lines in `prisma/schema.prisma`.
- Cleanest: branch **`sso-login`** (that one commit on top of `main`). In it the project sits in the folder `CheerITWebAPIV4/`.
- Dev server currently runs branch **`globaldb`**, where the project sits at the **repository root** (no `CheerITWebAPIV4`). `globaldb` also contains an unused match mirror (it stays off unless its settings exist). Use whichever your team agrees; the steps below say "project folder" for the folder that holds `package.json` and `src`.
- Do **not** merge `globaldb` blindly: it includes a commit with a committed `.env` and a local-only database address. Check `.env` after any checkout (D1.3 / D2.4).

### D1. Add SSO to the CheerIT that is already running

1. Deploy the branch to the server in your normal way.
2. In the project folder:
   ```bash
   npm install
   psql "postgresql://<owner>@<db-host>:5432/<cheerit_db>" -f identity_link.sql
   npx prisma generate
   ```
   `identity_link.sql` adds only nullable columns and indexes (`User.identity_id`, `Event.external_source/external_id`) and is safe to repeat. **Never** `prisma migrate` or `db push`. Take the CheerIT database backup first (B1).
3. Put the two settings in CheerIT's `.env`, using B7 with key name **`com`**:
   `IDENTITY_SERVICE_URL=http://127.0.0.1:4100` (same server) or the identity service's private address (another server), and `IDENTITY_API_KEY`.
4. Restart: `pm2 restart <cheerit-pm2-name> --update-env`.
5. **Check** with a deliberately wrong token:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<cheerit-api>/api/auth/sso-login -H 'content-type: application/json' -d '{"token":"wrong"}'
   ```
   **401** = working. **503** = the two settings are missing or not loaded. **404** = the SSO commit is not deployed.
6. **What SSO does:** ScoreIT proves who the viewer is; the identity service issues a 5-minute one-time token; CheerIT swaps it for a normal web session. If the person has no CheerIT user (found by identity link, then by phone) **one is created** (`full_name` from the identity, `gender: OTHER`). Blocked users get 403. Confirm with CheerIT's team that creating accounts this way is acceptable.
7. Sync the existing CheerIT users into the identity: fill `SRC_COM_URL` and `LINK_COM_URL` in the identity `.env` (B3), then repeat **B4 and B5** (`com` appears as another app). Optional: users also get linked at their first login.

### D2. Host a new CheerIT API (what was done for `https://devcheerback.avenengage.com`)

Server: Amazon Linux 2023, user `ec2-user`, nginx, pm2, Node 22+ (24 worked). Replace `<domain>`, `<port>`, `<project-dir>`.

**D2.1 Prepare.** DNS: an A record for `<domain>` must point at the server (`dig +short <domain>` shows its public IP). Free port: `ss -ltnp | grep -E ':(3000|3001|3002|3003|4100)'`. **Redis is required** even though `REDIS_ENABLED=false`: CheerIT waits for Redis at start and never listens without it.
```bash
sudo dnf install -y redis6
sudo systemctl enable --now redis6
redis6-cli ping
```
The answer must be `PONG`. (Amazon Linux 2: `sudo amazon-linux-extras install -y redis6`, service `redis`.)

**D2.2 Code.**
```bash
cd ~/websites
git clone https://github.com/Shriya2020/CheerITWebAPI.git
cd CheerITWebAPI
git checkout <branch>
cd <project-dir>
git update-index --skip-worktree .env
npm install
```
`git update-index --skip-worktree .env` keeps later pulls from replacing the server's `.env`. If it says `Unable to mark file`, the `.env` path is wrong for this branch (the project folder is the repository root on `globaldb`, `CheerITWebAPIV4/` on `sso-login`).

**D2.3 Database.** Use the server's own Postgres. Create a **dedicated** database (and optionally a dedicated user; never change the password of a shared superuser):
```bash
createdb -h localhost -p 5432 -U postgres cheeritback
```
Create the tables from CheerIT's schema (the one place `prisma db push` is correct: a brand-new, empty database):
```bash
npx prisma db push
```
(Run it with `DATABASE_URL` pointing at the new database, never at an existing one.) An empty CheerIT has **no reference rows**; it needs these. **Run this only on a new empty database. Never on production**, which already has real rows:
```bash
psql -h localhost -p 5432 -U postgres -d cheeritback <<'SQL'
insert into "EventStatus"(eventstatus_id, code, name) overriding system value values
  (1,'UPCOMING','Upcoming'),(2,'SCHEDULED','Scheduled'),(3,'LIVE','Live'),(4,'COMPLETED','Completed')
  on conflict do nothing;
insert into "EventCategory"(event_category_id, code, name, is_sport, updated_at)
  values ('f7b3e5e6-a5f6-4aa8-9376-6384811c0165','SPORT','Sport',true,now()) on conflict do nothing;
insert into "EventType"(eventtype_id, code, name, event_category_id, updated_at) overriding system value values
  (1,'CRICKET','Cricket','f7b3e5e6-a5f6-4aa8-9376-6384811c0165',now()),
  (2,'FOOTBALL','Football','f7b3e5e6-a5f6-4aa8-9376-6384811c0165',now()),
  (8,'BADMINTON','Badminton','f7b3e5e6-a5f6-4aa8-9376-6384811c0165',now())
  on conflict do nothing;
insert into "Organization"(org_id, code, name, type, updated_at)
  values ('11111111-1111-4111-8111-111111111111','SCOREIT','ScoreIT','OTHER',now()) on conflict do nothing;
insert into "SMSSetting"(sms_setting_id, provider, is_active, updated_at)
  select gen_random_uuid(),'webtech',true,now() where not exists (select 1 from "SMSSetting");
insert into "SMSTemplate"(sms_template_id, code, message, is_active, updated_at)
  values (gen_random_uuid(),'LOGIN_OTP','Your OTP is {#var#}. Do not share it with anyone. AvenCheer',true,now())
  on conflict (code) do nothing;
SQL
```
Check: `psql … -c 'select (select count(*) from "EventStatus"), (select count(*) from "EventType"), (select count(*) from "Organization"), (select count(*) from "SMSSetting"), (select count(*) from "SMSTemplate")'` shows 4, 3, 1, 1, 1. (The OTP text must match the text registered with the SMS provider.) To start with real data instead, restore a `pg_dump` of an existing CheerIT database into the new one.
Then: `psql … -f identity_link.sql` and `npx prisma generate`.

**D2.4 Settings.** The `.env` that comes from Git may hold **another environment's settings, including production**. Edit it **before the first start**, with an editor for lines that hold passwords (`nano +4 .env`):

| Setting | Value |
|---|---|
| `DATABASE_URL` | `postgresql://<user>:<pw>@localhost:5432/cheeritback?schema=public`. **Check it never points at the production database.** Verify without showing the password: `grep '^DATABASE_URL=' .env \| sed -E 's#(://[^:/@]+):[^@]*@#\1:<pw>@#'` |
| `PORT` | the free port, e.g. `3002` |
| `BASE_URL`, `APP_PUBLIC_URL`, `SQUAD_INVITE_BASE_URL` | `https://<domain>` |
| `WEB_BASE_URL` | the CheerIT website address for this environment |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **new** random values: `sed -i "s\|^JWT_ACCESS_SECRET=.*\|JWT_ACCESS_SECRET=$(openssl rand -hex 48)\|" .env` (and the same for `JWT_REFRESH_SECRET`). Never reuse another environment's |
| `IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY` | via B7 with key name `com` (replace any value that came from Git) |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the bucket for cheer uploads and **fresh** keys allowed to write to it. **Do not set `AWS_ENDPOINT_URL_S3`** |
| `SMS_AUTH_KEY` and the other `SMS_*` | as for production SMS |
| `APPLE_REVIEW_ENABLED` | `false` in production (it is a fixed-code login for one number) |

**D2.5 Start.**
```bash
pm2 start src/server.js --name <cheerit-pm2-name>
pm2 save
pm2 logs <cheerit-pm2-name> --lines 30 --nostream
```
You must see `Prisma connected successfully` and `Server running on http://localhost:<port>`. If it stops after the Prisma line, Redis is not reachable. Then `curl -s http://127.0.0.1:<port>/api/events/mobile/live` returns `{"success":true,…}`.
Optional: the moderation worker `src/worker/Worker.js` (SQS) is needed only for events with CheerIT's AI check on: `pm2 start src/worker/Worker.js --name <cheerit-pm2-name>-worker`.

**D2.6 nginx** (`sudo nano /etc/nginx/conf.d/<domain>.conf`):
```nginx
server {
    listen 80;
    server_name <domain>;
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:<port>;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo nginx -t
sudo systemctl reload nginx
curl -s http://<domain>/api/events/mobile/live | head -c 150
```
`nginx -t` must say the syntax is ok. If the browser-style request gets nginx's own 404 page but `curl -H 'Host: <domain>' http://127.0.0.1/...` works, the file was not loaded when you tested: reload and retry. Check that nginx really loaded it: `sudo nginx -T | grep -n -B2 -A12 '<domain>'`.

**D2.7 HTTPS (required).** Browsers block insecure uploads from secure pages, and the CheerIT website rewrites `http://` media links to `https://`.
```bash
sudo certbot --nginx -d <domain>
curl -s https://<domain>/api/events/mobile/live | head -c 150
```
Choose "redirect http to https" when asked. The certificate renews itself.

**D2.8 Then do D1 steps 3 to 7** (key, restart, the 401 check, user sync).

### D3. Storage permission (CheerIT's upload bucket)
The viewer's browser uploads **straight to the bucket**, so the bucket must allow browser uploads from ScoreIT's website. In the bucket's CORS settings:
```json
[{
  "AllowedOrigins": ["https://<score-website>", "https://<cheerit-website>"],
  "AllowedMethods": ["POST", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```
Test it before any cheer:
```bash
curl -s -i -X OPTIONS "https://<bucket>.s3.<region>.amazonaws.com/" -H "Origin: https://<score-website>" -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```
It must print your website. After one test cheer: `aws s3 ls s3://<bucket>/non-ai-approved/ --recursive | tail -3` shows the new file. Everything must be https (the website, the CheerIT API and the bucket).

---

## Part E. ScoreIT cheering feature

Branch `feat/cheerit-cheer` of `Shriya2020/ScoreIT` (already includes the login fix). Do Part D first.

### E1. Decisions to make first
| Decision | Recommendation |
|---|---|
| SSO (no second code) or a CheerIT OTP once? | SSO (`VITE_CHEERIT_TOKEN_LOGIN=on`) |
| Created events **public or private**? | **Private** first. Public events appear in CheerIT's live list **and push a "live now" notification to every CheerIT user for every match** |
| May ScoreIT create events, teams and competitions in CheerIT? | Yes, but test with fake team names first. CheerIT's create routes need no login today |

### E2. Backend
Code, then in `ScoreIT/backend`: `npm install`, `npx prisma generate`. Add to its `.env` (check for duplicates; the last line wins):

| Setting | Value |
|---|---|
| `IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY` | already set by Part C |
| `CHEERIT_API_URL` | `https://<cheerit-api>` (no trailing `/api`) |
| `CHEERIT_CREATE_EVENTS` | `on` (**off by default**; turns on event creation, logos and score sending) |
| `CHEERIT_ORG_ID` | an organization id from CheerIT (needed only the first time, to create the "ScoreIT" competitions; not needed if CheerIT's admin created competitions "ScoreIT", "ScoreIT Football", "ScoreIT Badminton") |
| `CHEERIT_EVENT_ACCESS` | `private` (default) or `public` |
| `CHEERIT_EVENT_TAG` | `ScoreIT` (use `ScoreIT-dev` on a dev Score that feeds the same CheerIT: events are named "A vs B (ScoreIT #12)" and match numbers must not collide) |
| `CHEERIT_SYNC_SECONDS` | default `15` |
| `CHEERIT_EVENT_HOURS` | default `12` (must be longer than a match) |
| `SCORE_PUBLIC_URL` | where Score serves uploaded files, to copy uploaded team logos |
| optional | `CHEERIT_VENUE_ID`, `CHEERIT_COMPETITION_ID`, `CHEERIT_GROUP_ID`, `CHEERIT_EVENTTYPE_ID`, `CHEERIT_VIDEO_SECONDS` |

Restart: `pm2 restart scoreit-backend --update-env`. The log must say `creating CheerIT events and sending scores for live matches every 15s` and must **not** keep printing `background check failed`.

### E3. Frontend (rebuild; Vite bakes these in at build time)
Build environment:
```
VITE_CHEERIT_API_URL=https://<cheerit-api>
VITE_CHEERIT_TOKEN_LOGIN=on
```
Optional: `VITE_CHEERIT_WEB_URL` (the "On CheerIT" link), `VITE_PREDICT_API_URL` and `VITE_PREDICT_WEB_URL` (predict card).
```bash
cd <score-dir>/frontend
npm install
npm run build
```
Then publish the build to the folder nginx serves (dev: `/var/www/scoreit`). `npm install` is needed: the frontend now depends on `mediabunny` (tested version 1.55.2).
**If the Score server has uncommitted hand-edited files** (the dev server did), do not `git pull` over them: copy the folder aside first (`rsync -a --exclude node_modules --exclude dist <score-dir>/ <score-dir>.backup-<date>/`), look at `git status`, and bring the branch's files in deliberately.

### E4. Check
```bash
curl -s http://127.0.0.1:<score-port>/api/public/matches/<live-match-id>/cheerit
```
`{"linked":true,"eventId":…,"eventName":"A vs B (ScoreIT #n)"}` is working. Within 15 seconds of a match going live, that event exists in CheerIT. Reasons otherwise: `no_match` (creation off, match not live, or a sport that is not supported: only cricket is wired in today), `unavailable` (Score cannot read CheerIT: check `CHEERIT_API_URL` and for a duplicate `.env` line), `not_configured` (`CHEERIT_API_URL` not set).

### E5. What the feature does (for the person testing)
- **Each live Score match gets its own CheerIT event** `A vs B (ScoreIT #12)`; a team missing in Score data shows as "Unknown".
- Teams are found by name or created; they get the uploaded Score logo or else the same default picture the Score website shows.
- Every 15 seconds Score sends the ball-by-ball score to CheerIT's scorecard (only differences; edits and undos are copied; the scorecard is marked complete when the match ends).
- The viewer: picks a team, **full-screen camera** (Photo or Video, up to 7 seconds), **sound check** (refused if under 2 seconds, silent or too quiet), **video compression** (about 2 MB, first 7 seconds, in the browser), preview with **Retake**, consent, upload. Login is SSO; if SSO fails the card falls back to a CheerIT OTP login.
- A cheer is saved in CheerIT at once (**APPROVED** unless the event has CheerIT's AI check on) under the viewer's CheerIT account, and counts toward CheerIT's own limit of 5 cheers per user per event, whether cast from ScoreIT or the CheerIT app.
- CheerIT's own app and website can cheer on these events too if they are **public**.

---

## Part F. CheerIT website card (optional)

Repository `CheerIT-COM`, branch `feat/card-team-name-and-score`: shows the team name under each logo and the live score on the live-match card (reads `/scorecards/event/<id>/live`). Two files (`src/api/client.ts`, `src/components/MatchCard.tsx`). Merge in the normal way. The website reads CheerIT's address from `VITE_API_URL`, `VITE_DIRECT_API_BASE_URL`, `VITE_PROXY_API_URL` (all three; changing one leaves it half on another server).

---

## Part G. Acceptance checks (all must pass)

| # | Check | Pass |
|---|---|---|
| 1 | `curl http://127.0.0.1:4100/health` | `{"ok":true}` |
| 2 | `dry-run`, `apply`, `link --verify-only` | all PASS; second `--apply` writes 0 |
| 3 | Score wrong-code test (C1) | no token |
| 4 | Log in on each app with your own number, then the `user_apps` query | fresh `last_seen_at` for that app |
| 5 | `pm2 stop identity`, log in | login still works; `pm2 start identity` after |
| 6 | CheerIT `sso-login` with a wrong token | 401 |
| 7 | `GET /api/events/mobile/live` on the CheerIT address over https | `{"success":true…` |
| 8 | A fake live cricket match in Score | within 15 s an event "…(ScoreIT #n)" exists in CheerIT |
| 9 | The Score page for that match | cheer card shows Photo **and Video** |
| 10 | Cheer once from a phone you own, with SSO | no code asked; cheer saved (APPROVED) |
| 11 | The file in the bucket | `aws s3 ls …/non-ai-approved/ --recursive` shows it |
| 12 | The same cheer in the CheerIT app or website (My Cheers) | visible; playable (https) |
| 13 | Delete the fake match's rows in CheerIT's admin | done |

---

## Rollback

- **One app off:** remove its two `IDENTITY_` lines from its `.env`, then `pm2 restart <name> --update-env`. Login behaves as before.
- **Identity off everywhere:** `pm2 stop identity` (apps keep working and log a warning per login).
- **Stop creating events and scores:** unset `CHEERIT_CREATE_EVENTS` and restart Score. Existing events stay.
- **Back to OTP login in the card:** unset `VITE_CHEERIT_TOKEN_LOGIN` and rebuild.
- **Hide the card:** unset `VITE_CHEERIT_API_URL` and rebuild.
- **SSO off in CheerIT:** remove its two `IDENTITY_` lines and restart; the route then answers 503 and the card falls back to OTP.
- **Undo the identity data:** `DROP DATABASE cheeritidentity;`. The `identity_id` columns are nullable and harmless; leave them.
- **Restore a database:** `pg_restore --clean` from the B1 backup.

---

## Troubleshooting (every problem seen)

| You see | Cause and fix |
|---|---|
| `dry-run` prints `Skipped` for every app | the `.env` was not loaded: use `node --env-file=.env …` |
| `database "cheeritidentity" does not exist` | create it (B2) or fix `IDENTITY_URL` |
| `Set IDENTITY_URL …` on start | the variable is `IDENTITY_URL`, not `DATABASE_URL` |
| `HTTP 401` in an app's log (`[Identity] linking … failed`) | wrong or cancelled key: issue a new one, replace the `.env` line, `pm2 restart --update-env` |
| `HTTP 500` and `PayloadTooLargeError` in `pm2 logs identity` | an app sent a base64 avatar: deploy `fix/identity-skip-data-avatar` (GameIT, TurfIT) |
| `HTTP 409` | that app user is already linked to a different phone: fix by hand; the service never moves a user |
| `identityId` Prisma errors, or a link that never updates | stale Prisma client: `npx prisma generate`, restart |
| Key length prints `0` | the issue command failed: run `npm run issue-key -- <app>` and read the error |
| `.env` has `IDENTITY_API_KEY=<…>` | a placeholder was pasted literally: reissue and rewrite |
| `curl: (7)` or "no such file or directory" in the CheerIT folder | wrong folder: on `globaldb` the project is the repository root, on `sso-login` it is `CheerITWebAPIV4/` |
| CheerIT stops after `Prisma connected successfully` | Redis not running (D2.1) |
| CheerIT: `SMS settings not configured` on an OTP request | the new database lacks the SMS row (D2.3 seed) |
| OTP request accepted but no SMS arrives | the `LOGIN_OTP` text must match the text registered with the SMS provider: "Your OTP is {#var#}. Do not share it with anyone. AvenCheer" |
| nginx's own 404 for the domain | the new file was not loaded yet (reload), or another block catches the name: `sudo nginx -T \| grep -n -B2 -A12 '<domain>'` |
| `sso-login` answers 503 | `IDENTITY_SERVICE_URL`/`IDENTITY_API_KEY` missing in CheerIT's `.env`, or not loaded (`--update-env`) |
| `sso-login` answers 404 | the SSO commit is not deployed |
| `POST /api/auth/cheerit-sso` 502 in Score's log | the identity service is down or unreachable from Score; the card falls back to OTP |
| Score log repeats `background check failed: fetch failed` | `CHEERIT_API_URL` points at something that is down, or a duplicate line in `.env` overrides it |
| `{"linked":false,"reason":"unavailable"}` | same as above |
| Card shows only photo buttons | the CheerIT event was saved with video off: CheerIT's **create** route reads `allow_video_audio` (Score `03e0dc53` sends it); for an old event: `update "Event" set allow_video_with_audio = true where …` |
| 5 live matches show fewer events | old behaviour (one per pair of teams): deploy Score `867ef9ae` or later |
| A match gets a second event after hours | events stay open `CHEERIT_EVENT_HOURS` (12): keep it longer than a match |
| Private event creation fails "At least one group is required" | handled: Score creates an empty group "ScoreIT" |
| Upload slot is given but the browser upload fails | the bucket has no CORS rule for the website (D3), or something is not https |
| `ERR_SSL_PROTOCOL_ERROR` on media in the CheerIT website | media links point at a plain-http host (only happens with a local stand-in storage; real S3 is https) |
| Team pictures broken in the CheerIT website | its `BASE_URL` must be an https address |
| Cheer refused "team_id … not allowed for non-sports events" | the CheerIT event is not a sports type: only CheerIT's team can change it |
| Camera does not open | the page must be https (or localhost) and the browser must allow the camera; the card then offers "Use camera app" |
| Predict card empty | PredictIt is not reachable at `VITE_PREDICT_API_URL` |

---

## Appendix 1. Settings by file (what to paste where)

| File | Setting | Value |
|---|---|---|
| `cheeritidentity/.env` | `IDENTITY_URL`, `PORT`, `HOST`, `SRC_*_URL` (read-only), `LINK_*_URL` (owner) | Part B3 |
| Each app backend `.env` (Score, GameIT, PredictIt, TurfIT, Sponsor) | `IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY` | `http://127.0.0.1:4100` (same server) or the identity service's private address; the app's own key |
| CheerIT API `.env` | `IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY` | same address; the key for `com` |
| CheerIT API `.env` | `DATABASE_URL`, `PORT`, `BASE_URL`, `APP_PUBLIC_URL`, `SQUAD_INVITE_BASE_URL`, `WEB_BASE_URL`, `JWT_*`, `REDIS_URL`, `AWS_*`, `S3_BUCKET`, `SMS_*` | Part D2.4 |
| Score backend `.env` | `CHEERIT_API_URL`, `CHEERIT_CREATE_EVENTS`, `CHEERIT_ORG_ID`, `CHEERIT_EVENT_ACCESS`, `CHEERIT_EVENT_TAG`, `CHEERIT_SYNC_SECONDS`, `CHEERIT_EVENT_HOURS`, `SCORE_PUBLIC_URL` | Part E2 |
| Score frontend build env | `VITE_CHEERIT_API_URL`, `VITE_CHEERIT_TOKEN_LOGIN`, `VITE_CHEERIT_WEB_URL`, `VITE_PREDICT_API_URL`, `VITE_PREDICT_WEB_URL` | Part E3 |
| PredictIt backend `.env` | `SCOREIT_API_URL`, `OTP_DEV_MODE`, `OTP_LOG_CODE` | Score's API address; both `false` in production |
| Score backend `.env` | `LOG_OTP_TO_CONSOLE` | `false` in production |
| CheerIT website build env | `VITE_API_URL`, `VITE_DIRECT_API_BASE_URL`, `VITE_PROXY_API_URL` | the CheerIT API address, all three |
| CheerIT storage bucket | CORS | Part D3 |

## Appendix 2. Addresses used on the dev server (for orientation only)

CheerIT API `https://devcheerback.avenengage.com` (nginx to port 3002, pm2 `cheeritwebapi-dev`, database `cheeritback`); ScoreIT `https://devscoreit.avenengage.com`
(backend port 3001 under pm2 `scoreit-backend`, website built into `/var/www/scoreit`); identity service `127.0.0.1:4100` (pm2 `identity`); CheerIT-COM dev `devcheerit.avenengage.com`.
Production addresses are different: fill in the worksheet in section 0.4.

## Appendix 3. Where the code is

| Repository | Branch | Contents |
|---|---|---|
| `kartikavencheer/cheeritidentity` | `main` | identity service and scripts, these documents, `dev-tools/` |
| `Shriya2020/ScoreIT` | `feat/cheerit-cheer` | Score identity code, login fix, cheer card, event creation, logos, scores, video and sound logic |
| `Shriya2020/CheerITWebAPI` | `sso-login` (clean) or `globaldb` | SSO route and identity link (commit `d5f3b67`) |
| `Shriya2020/CheerIT-COM` | `feat/card-team-name-and-score` | team name and score on the live card |
| `Shriya2020/predictitapp` | `master` (identity), `feat/identity-sso-login` (optional) | |
| `Shriya2020/pickleball`, `Shriya2020/turfitweb` | `fix/identity-skip-data-avatar` | |
| `Shriya2020/CheerIT-Sponsor` | `stackchnage` | |
