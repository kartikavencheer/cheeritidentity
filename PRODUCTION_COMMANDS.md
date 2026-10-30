# CheerIT identity: production commands

## Before you start

Replace every `<placeholder>` with a real value. Run everything on the backend server unless stated.

- Deploy the **Score OTP fix first** and confirm a wrong code returns no token (step 8).
- Never run `prisma db push` or `prisma migrate deploy` for this. Only `npx prisma generate`.
- Use phone numbers you own for tests. A real OTP SMS is sent.
- Node 22 or newer is required for the identity scripts: `node -v`.

## 1. Back up every app database

```bash
mkdir -p ~/identity-backups
for db in <score_db> <gameit_db> <predictit_db> <turfit_db> <cheerit_api_db>; do
  PGPASSWORD='<admin-password>' pg_dump -h <db-host> -U <admin-user> -Fc "$db" -f ~/identity-backups/$db-$(date +%Y%m%d-%H%M).dump
done
ls -la ~/identity-backups
```

## 2. Get the code and create the identity database

```bash
git clone https://github.com/kartikavencheer/cheeritidentity.git
cd cheeritidentity && git checkout main && npm install

export PGPASSWORD='<admin-password>'
psql -h <db-host> -U <admin-user> -d postgres -c "CREATE DATABASE cheeritidentity;"
psql -h <db-host> -U <admin-user> -d cheeritidentity -f sql/001_identity_schema.sql
psql -h <db-host> -U <admin-user> -d cheeritidentity -f sql/002_app_clients.sql
psql -h <db-host> -U <admin-user> -d cheeritidentity -c "\dt"
```

`\dt` must list: `app_clients`, `migration_log`, `migration_runs`, `user_apps`, `users`.

## 3. Create `cheeritidentity/.env`

Do not commit this file. Leave a `SRC_` or `LINK_` line empty to skip that app.

```
IDENTITY_URL=postgresql://<user>:<pw>@<db-host>:5432/cheeritidentity
PORT=4100

SRC_SCORE_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<score_db>
SRC_BOOKING_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<gameit_db>
SRC_PREDICTIT_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<predictit_db>
SRC_TURFIT_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<turfit_db>
SRC_SPONSOR_URL=
SRC_COM_URL=postgresql://<readonly-user>:<pw>@<db-host>:5432/<cheerit_api_db>

LINK_SCORE_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<score_db>
LINK_BOOKING_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<gameit_db>
LINK_PREDICTIT_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<predictit_db>
LINK_TURFIT_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<turfit_db>
LINK_SPONSOR_URL=
LINK_COM_URL=postgresql://<owner-user>:<pw>@<db-host>:5432/<cheerit_api_db>
```

Add `?sslmode=require` to a URL if that database needs SSL.

## 4. Dry run (reads only)

```bash
node --env-file=.env src/dry-run.ts
```

Expected: `N records -> M people`, and no `Skipped` for an app you configured. Review `out/<timestamp>/`.

## 5. Write the people, then link each app

```bash
node --env-file=.env src/apply.ts
node --env-file=.env src/apply.ts --apply
node --env-file=.env src/apply.ts --verify-only
node --env-file=.env src/apply.ts --apply

node --env-file=.env src/link.ts
node --env-file=.env src/link.ts --apply
node --env-file=.env src/link.ts --verify-only
node --env-file=.env src/link.ts --apply
```

Expected: every check `PASS`. The second `--apply` of each writes 0 new people, 0 new memberships, 0 new links.

## 6. Start the identity service

```bash
pm2 start "npm start" --name identity
pm2 save
curl http://127.0.0.1:4100/health
```

Expected: `{"ok":true}`.

## 7. Turn on each app, one at a time

| App | `APP` (key name) | `PM2` | `DIR` |
|---|---|---|---|
| Score | `score` | `scoreit-backend` | `<path>/ScoreIT/backend` |
| PredictIt | `predictit` | `predictit-backend` | `<path>/predictitapp/backend` |
| TurfIT | `turfit` | `turfitweb-backend` | `<path>/turfitweb/Backend` |
| GameIT | `booking` | `pickleball-backend` | `<path>/pickleball/backend` |
| CheerIT API | `com` | `<cheerit-api-pm2-name>` | `<path>/CheerITWebAPI/CheerITWebAPIV4` |

Deploy the app's code first (merged branch, `npm install`). **CheerIT API only:** run `identity_link.sql` with `psql` **before** pulling the code, then pull branch `globaldb` (see the note below the block). Then, for that app:

```bash
APP=score; PM2=scoreit-backend; DIR=<path>/ScoreIT/backend

cd <path>/cheeritidentity
KEY=$(npm run -s issue-key -- $APP | grep -o "cid_${APP}_[A-Za-z0-9_-]*"); echo "key length: ${#KEY}"

cd $DIR
grep -c '^IDENTITY_' .env
printf '\nIDENTITY_SERVICE_URL=http://127.0.0.1:4100\nIDENTITY_API_KEY=%s\n' "$KEY" >> .env
unset KEY
npx prisma generate
pm2 restart $PM2 --update-env
```

The key length must be about 53 to 57, not `0`. The `grep -c` must print `0` before the `printf`, so you do not add the lines twice. Run the `printf` once.

CheerIT API: `identity_link.sql` is in `CheerITWebAPIV4/`. It is additive and safe to repeat:

```bash
psql -h <db-host> -U <owner-user> -d <cheerit_api_db> -f identity_link.sql
```

Order for CheerIT: run the SQL, then pull, then `npx prisma generate`, then restart. Pulling and regenerating before the SQL breaks queries on `User` and `Event`.

## 8. Test after each app

Score only: a wrong code must return no token.

```bash
curl -s -X POST localhost:<port>/api/auth/send-otp -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>"}'
curl -s -X POST localhost:<port>/api/auth/otp-verify -H 'content-type: application/json' -d '{"phoneNumber":"<your10digits>","otp":"000000"}'
```

Then log in on the app's website with your own number, and check it was recorded:

```bash
PGPASSWORD='<pw>' psql -h <db-host> -U <user> -d cheeritidentity -c "select u.phone, a.app_key, a.last_seen_at from users u join user_apps a on a.user_id=u.id where u.phone='+91<your10digits>' order by a.last_seen_at desc nulls last;"
pm2 logs <pm2-name> --lines 100 --nostream | grep -i identity
```

The app you used must show a `last_seen_at` from the last minute. The log grep should print nothing.

## 9. Service-down test

```bash
pm2 stop identity
# log in on one app: it must still work
pm2 start identity
curl http://127.0.0.1:4100/health
```

## Rollback

```bash
# turn off one app: remove its two IDENTITY_ lines from .env, then
pm2 restart <pm2-name> --update-env

# turn off everywhere
pm2 stop identity

# remove the identity data
psql -h <db-host> -U <admin-user> -d postgres -c "DROP DATABASE cheeritidentity;"

# restore an app database
pg_restore --clean -h <db-host> -U <admin-user> -d <db> ~/identity-backups/<file>.dump
```

## If something fails

| You see | Do this |
|---|---|
| `Skipped` for every app | Run with `node --env-file=.env …` |
| `HTTP 401` in an app log | Reissue that app's key, rewrite the `.env` line, restart with `--update-env` |
| `HTTP 500` and `PayloadTooLargeError` | Deploy the avatar fix (`fix/identity-skip-data-avatar`) on GameIT and TurfIT |
| `identityId` Prisma errors | `npx prisma generate` in that backend, then restart |
