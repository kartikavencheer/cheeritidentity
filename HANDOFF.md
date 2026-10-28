# CheerIT identity: handoff notes

Last updated 2026-10-28 (Windows PC). Read this first when continuing on another device or in a new session.
For the full discussion, see `CONVERSATION.md`. Plan page: https://claude.ai/artifact/YR4jNKegTPLKBUfoeZuoR4

## Goal and where we are

One account per person across all CheerIT apps, identified by **phone number**, with a record of which apps each
person uses.

| Step | What | Status |
|---|---|---|
| Stage 1 | Common users DB `cheeritidentity`, filled from all apps | ✅ Done locally (Mac and Windows) |
| Stage 2 | `identity_id` column in each app, filled for existing users | ✅ Done locally, all 5 apps |
| Step A | Identity service (HTTP API the app backends call) | ✅ Built, tested, pushed |
| Step B | Each app calls the service after OTP login | ✅ 5 apps, tested end to end, on `cheerit-identity` branches, **not merged** |
| CheerIT-COM | Same as step B | ❌ Backend is with another developer |
| Dev / prod servers | Run all of the above on real servers | ❌ Not started |
| Step C | SSO: log in once, stay logged in across apps | ❌ Not started |

Nothing has changed for real users yet. The new code is off until a server's `.env` has `IDENTITY_SERVICE_URL` and
`IDENTITY_API_KEY`, and the branches are not merged.

## The apps

| App | Repo (GitHub) | Folder on Windows PC | Branch to merge into | User table | Prod / dev domain |
|---|---|---|---|---|---|
| PredictIt | `Shriya2020/predictitapp` | `D:\Downloads\PredictIT-Extract` | `master` | `users` (uuid) | predictitplay.com / devpredictit.avenengage.com |
| TurfIT | `Shriya2020/turfitweb` | `D:\Downloads\turfit` | `master` | `"User"` (cuid), one row per (phone, role) | turfitplay.com / devturfit.avenengage.com |
| Score | `Shriya2020/ScoreIT` | `D:\Downloads\ScoreIT` | `scoreit/badminton` (branch starts there) | `si_user` (Int) | scoreitplay.com / devscoreit.avenengage.com |
| GameIT (booking) | `Shriya2020/pickleball` | `D:\Downloads\pickleball` | `main` | `users` (cuid) | gameitplay.com / devgameit.avenengage.com |
| Sponsor | `Shriya2020/CheerIT-Sponsor` | `D:\Downloads\CheerIT-Sponsor-main\CheerIT-Sponsor-main` | `stackchnage` (the OTP code lives there, not on `main` or `version2`) | `sp_sponsor_auth_users` (uuid) | sponsoritplay.com / devsponsorit.avenengage.com |
| CheerIT-COM | `Shriya2020/CheerIT-COM` (frontend only) | `D:\Downloads\CheerIT-COM` | n/a | separate backend, no access | cheerit.com / devcheerit.avenengage.com |
| Identity | `kartikavencheer/cheeritidentity` | `D:\Downloads\cheeritidentity` | `main` (pushed directly) | `users`, `user_apps` | proposed accounts.cheerit.com / devaccounts.avenengage.com |

Compare links to review and merge:
- https://github.com/Shriya2020/predictitapp/compare/cheerit-identity
- https://github.com/Shriya2020/turfitweb/compare/cheerit-identity
- https://github.com/Shriya2020/ScoreIT/compare/cheerit-identity
- https://github.com/Shriya2020/pickleball/compare/cheerit-identity
- https://github.com/Shriya2020/CheerIT-Sponsor/compare/cheerit-identity

## Decisions made

- Phone number (E.164, India default) is the person. Email is not unique.
- Separate database `cheeritidentity`. Apps never read it; they call the identity service.
- Each app keeps its own user table. Only one nullable `identity_id` column is added (Score: `si_user_identityid`,
  TurfIT: `"identityId"`, unique per (identityId, role)).
- Conflicts on name or email: the most recently active app wins. Profile fields only ever fill blanks.
- An app user already linked to a different phone is never moved automatically (service answers `409`).
- Sponsor: a mobile on the auth user counts as verified; a contact mobile only as unverified. `@mobile.sponsor`
  emails are dropped. Superadmin is not a person.
- Score logins are sent as **not verified**, because Score's OTP check is broken (see open items).
- Dev must behave like production: no shared `avenengage.com` cookies for SSO.
- App changes go on `cheerit-identity` branches, never straight to the deploy branch.

## What is built (this repo)

| Path | Purpose |
|---|---|
| `sql/001_identity_schema.sql` | `users`, `user_apps`, `migration_runs`, `migration_log` |
| `sql/002_app_clients.sql` | API keys (stored as SHA-256 only) |
| `sql/apps/*.sql` | The identity column per app (Prisma-compatible plain unique indexes) |
| `src/phone.ts`, `src/sources.ts`, `src/merge.ts`, `src/collect.ts`, `src/db.ts` | Read every app read-only, merge by phone |
| `src/dry-run.ts` | Report only |
| `src/apply.ts` | Stage 1: write people and memberships. `--apply`, `--verify-only` |
| `src/link.ts`, `src/link-plan.ts` | Stage 2: add and fill the identity column in each app. Refuses an app with any mismatch. Reports `NOT IN IDENTITY` for app users never seen (new signups in an app not yet calling the service, or rejected phones) |
| `src/server.ts`, `src/service/` | Step A: the identity service (Express 5, port 4100, 127.0.0.1 only) |
| `src/issue-key.ts` | One key per app; reissuing revokes the old one |
| `test/` | 29 tests. Six need `TEST_IDENTITY_URL` pointing at a throwaway DB with "test" in its name |

Service API (details and a copy-paste snippet in `README.md`): `POST /v1/users/resolve`, `GET /v1/users/:id`,
`GET /v1/users?phone=`, `GET /health`. Every `/v1` call needs `Authorization: Bearer <IDENTITY_API_KEY>`.

## What each app got (step B)

Same pattern everywhere: an identity client file, one **not awaited** call right after a successful login, a
migration that adds the column (`IF NOT EXISTS`), and the Prisma field. If the service is down, login carries on
(tested: fails in about 20 ms with a warning in the log).

| App | Client file | Call added in | Migration |
|---|---|---|---|
| PredictIt | `backend/src/services/identityClient.ts` | `authService.ts` `verifyOtpAndLogin` | `prisma/migrations/20261028000000_identity_id` |
| TurfIT | `Backend/src/lib/identityClient.ts` (skips the "New User" placeholder name) | `playerAuth.ts` and `ownerAuth.ts` verify-otp | `prisma/migrations/20261028000000_identity_id` |
| Score | `backend/server/identity.ts` | `server.ts`: otp-verify (both branches) and `/api/auth/handoff` | `prisma/migrations/20261028000000_identity_id` |
| GameIT | `backend/src/services/identityClient.ts` | `authService.ts` `verifyOtpAndLogin` | `prisma/migrations/20261028000000_identity_id` |
| Sponsor | `backend/services/identityClient.ts` | `authService.ts` `verifyLoginOtp` (OTP login only, not email+password) | `sql/sponsor_portal/024_identity_link.sql` |

## How to run (PowerShell)

```powershell
cd D:\Downloads\cheeritidentity
npm install
npm test
npm start                              # identity service on http://127.0.0.1:4100, reads .env
npm run issue-key -- turfit            # prints a new key once; goes in that backend's .env as IDENTITY_API_KEY
Invoke-RestMethod http://127.0.0.1:4100/health
```

`.env` in this folder holds `IDENTITY_URL=postgresql://postgres:<password>@127.0.0.1:5432/cheeritidentity`.

Check every app is linked:

```powershell
$env:IDENTITY_URL="postgresql://postgres:root@127.0.0.1:5432/cheeritidentity"
$env:LINK_SCORE_URL="postgresql://postgres:root@127.0.0.1:5432/post"
$env:LINK_BOOKING_URL="postgresql://postgres:root@127.0.0.1:5432/gameit"
$env:LINK_PREDICTIT_URL="postgresql://postgres:root@127.0.0.1:5432/predictit"
$env:LINK_TURFIT_URL="postgresql://postgres:root@127.0.0.1:5432/turfitweb"
$env:LINK_SPONSOR_URL="postgresql://postgres:root@127.0.0.1:5432/sponsor_db"
npm run link:verify
```

To add users who signed up since: run `node src/apply.ts --apply` (with the `SRC_*_URL` variables, same values),
then `node src/link.ts --apply`.

## Current state: Windows PC

- Postgres 18 on `localhost:5432`, user `postgres`. Tools in `C:\Program Files\PostgreSQL\18\bin` (not on PATH).
- Databases: `post` (Score), `gameit` (GameIT), `predictit`, `turfitweb` (TurfIT, local), `sponsor_db`,
  `cheeritidentity`, `cheeritidentity_test` (for tests only).
- `cheeritidentity`: 11 people, 15 memberships. Linked: Score 1, GameIT 3, PredictIt 9, TurfIT 1, Sponsor 1.
  One Sponsor account has no phone at all and stays out.
- `sponsor_db` got Sponsor migrations `022`, `023` and `024`.
- Keys issued for predictit, turfit, score, booking and sponsor. Each sits **only** in that backend's local `.env`.
- Backups of every app database from before each change are in `backups/` (git-ignored). Restore with
  `pg_restore --clean -d <db> backups/<db>-<time>.dump`.
- Repos are left on their `cheerit-identity` branches. Their local `.env` files are modified (the two identity
  lines) and must not be committed.
- TurfIT's own `.env` points at a **remote Aiven database**. All tests here overrode it to local `turfitweb`.
  Never touch the Aiven one without explicit approval.

The Mac has its own local `cheerit_identity` (31 people, from different local data). Local databases do not travel
with git; rebuild on each machine with `apply.ts --apply` and `link.ts --apply`.

## Open items (most urgent first)

1. 🔴 **Score login does not check the OTP.** `POST /api/auth/otp-verify` in `ScoreIT/backend/server.ts` never
   calls `validateOtp`, so any code logs in as any phone (tested here with `0000`). Check production; fix it.
2. 🔴 **Sponsor `AUTH_SECRET`:** `middleware/auth.ts` and the OTP hash fall back to `"cheerit-demo-secret"` when it is
   unset. Confirm it is set in production.
3. **`.env` files are committed** in all five app repos (JWT secrets, DB passwords, SMS keys in git history). Untrack
   them and rotate the secrets before production.
4. **`cheeritidentity/.env`:** removed from `.gitignore` by hand. Either commit it on purpose or ignore it again.
5. **Prisma drift:** local `post` has `si_reward*` tables ScoreIT's schema no longer has; local `turfitweb` is behind
   TurfIT's schema; Sponsor's `schema.prisma` lacks `mobile_number` and `identity_id`. A `prisma db push` in any of
   these would drop data.
6. CheerIT-COM: get the users table and an export from its developer, give them a key (`npm run issue-key -- com`).
7. Confirm the domain mapping (scoreitplay.com = Score, gameitplay.com = GameIT) and the identity domain names.
8. Sponsor email+password logins do not link at login time; only the batch scripts link them.
9. Not yet checked: whether CheerIT-COM's SSO token is single-use.

## Next steps

1. Fix and check open items 1 and 2.
2. Review and merge the five `cheerit-identity` branches (into the branch named in the table above).
3. Put the identity service on the dev server (`devaccounts.avenengage.com`) with its own Postgres database, run
   `apply.ts` and `link.ts` against the dev databases, issue one key per dev backend, set the two env vars there.
4. CheerIT-COM.
5. Production: backup, one app at a time.
6. Step C, SSO: the identity service issues short-lived single-use tokens and keeps its own login cookie; apps
   redirect to it when the browser is not logged in. Reuse the existing handoff pattern (Score
   `/api/auth/handoff`, CheerIT-COM `/sso/login?token=`).

## Lessons from testing (do not repeat)

- Test phone numbers can be real seed users (`+919000000001` was "Amit" in PredictIt and was deleted, then restored
  from backup). Always check a number does not exist first, and delete only rows the test created, by id.
- Local `.env` files hold live SMS keys. One real OTP SMS went to 9898989898 during a GameIT test. Before any OTP
  request, read that app's OTP code and make sure sending is skipped, or override the SMS URL to a dead address.
