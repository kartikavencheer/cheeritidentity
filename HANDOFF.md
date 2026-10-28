# CheerIT identity: handoff notes

Last updated 2026-10-28. Read this first when continuing on another device or in a new session.

Plan page (same content, formatted): https://claude.ai/artifact/YR4jNKegTPLKBUfoeZuoR4

## Goal

One account per person across all CheerIT apps, identified by **phone number**, with a record of which apps each
person uses. Order of work: **1. common users DB** (in progress), **2. SSO** (not started).

## The apps

| App | Repo folder | Prod domain | Dev domain | User table | Login |
|---|---|---|---|---|---|
| CheerIT-COM | `CheerIT-COM` (frontend only) | cheerit.com | devcheerit.avenengage.com | Separate backend built and hosted by someone else, no access | Phone OTP, SSO from Android app |
| CheerIT-Score | `CheerIT-Score` | scoreitplay.com | devscoreit.avenengage.com | `si_user` (Int id) | Phone OTP, JWT |
| Booking platform | `scoreit-sports-booking-match-platform` | gameitplay.com | devgameit.avenengage.com | `users` (cuid) | Phone OTP, JWT |
| PredictIt | `predictitapp` | predictitplay.com | devpredictit.avenengage.com | `users` (uuid) | Phone OTP, sessions |
| TurfIT | `turfitweb` | turfitplay.com | devturfit.avenengage.com | `"User"` (cuid), unique on (phone, role) | Phone OTP, JWT |
| Sponsor | `CheerIT-Sponsor` | sponsoritplay.com | devsponsorit.avenengage.com | `sp_sponsor_auth_users` (uuid) | Email + password, and phone OTP |

The domain-to-app mapping above is an assumption. **Still to confirm:** which of scoreitplay.com and gameitplay.com is Score and which is the booking platform.

All backends are Express + Prisma + Postgres (TurfIT uses Prisma 7 and Express 5).

## Decisions made

- Phone number (E.164, India default) is the primary key for a person.
- A new, separate Postgres database `cheerit_identity` on the same server as the others, with its own DB user. Apps never read it directly; they will go through an identity API later.
- Each app keeps its own user table and its own data. Only one new nullable column `identity_id` is added to each app's user table. Existing ids and relations are untouched.
- Conflicts on name or email: **the most recently active app wins** (last login or newest session where the app records it, else updated time; an app with an activity signal beats one without; an empty value never overrides a real one).
- TurfIT: one person with several roles (PLAYER, OWNER, ADMIN) in TurfIT's own table. Uniqueness becomes (identity_id, role).
- Email is not unique in the identity DB.
- Sponsor: a mobile stored on the auth user counts as verified (it was set by a real OTP). A primary-contact mobile is allowed only as unverified. Made-up `@mobile.sponsor` emails are never imported. Superadmin (env-var login) is not migrated.
- CheerIT-COM is left out of the first migration until its developer supplies the users table and an export.
- Dev must behave like production: no shared parent-domain cookies in dev, even though all dev domains share `avenengage.com`.

## SSO design (agreed in principle, not built)

Browsers never share logins across different domains, and your six prod domains are unrelated, so a shared DB alone cannot give SSO. The approach is to reuse the token handoff you already built:

- CheerIT-COM already accepts `/sso/login?token=…` (see `src/pages/SsoLogin.tsx` and `ssoLogin()` in `src/context/AuthContext.tsx`): the Android app opens the link, the page exchanges the token for an access token and stores it in localStorage.
- Score already has `POST /api/auth/handoff` (`backend/server.ts`): signed token, 2 minute life, single use.
- Add a small Identity service (suggested `accounts.cheerit.com` in prod, `devaccounts.avenengage.com` in dev) that issues the one-time tokens and keeps its own cookie. A click from App A to App B asks Identity for a token. A direct open of App B redirects to Identity, which recognizes the browser and sends the user back with a token.
- Tokens must be short-lived and single-use. Roles stay inside each app; Identity only says who the person is.
- Wrapped mobile apps keep separate WebView storage, so a login in one app on the phone does not automatically appear in another. A remembered-device token could reduce repeat OTPs.

## What is built (folder `cheerit-identity/`)

| Path | Purpose |
|---|---|
| `sql/001_identity_schema.sql` | `users`, `user_apps`, `migration_runs`, `migration_log` |
| `sql/apps/*.sql` | The `identity_id` column for each app. **Not run yet** |
| `src/phone.ts` | Phone normalizer, rejects with a reason, never guesses |
| `src/sources.ts` | One read-only SELECT and mapper per app |
| `src/merge.ts` | Groups by phone, applies the conflict rule, deterministic output |
| `src/collect.ts` | Reads all sources read-only |
| `src/dry-run.ts` | Report only. Writes nothing to any database |
| `src/apply.ts` | Writes people and memberships into the identity DB. Also `--verify-only` |
| `src/verify.ts` | The six post-write checks |
| `src/db.ts` | Read-only guard: single SELECT, `BEGIN READ ONLY`, always rolled back |
| `test/` | 17 tests, all passing. `npm test` |
| `fixtures/demo/` | Invented data for `npm run dry-run:demo` |

Safety in `apply.ts`: it shows the plan unless `--apply` is passed; it refuses a non-local host without `--allow-remote`; it refuses to write into the same database it reads from; it only fills blanks and never overwrites existing identity data, so re-running is safe.

## How to run

```
cd cheerit-identity
npm install
npm test                       # 17 tests
npm run typecheck
npm run dry-run:demo           # demo data, no database

# Real data, read-only. Connection strings go in the shell environment, never in git.
# SRC_SCORE_URL, SRC_BOOKING_URL, SRC_PREDICTIT_URL, SRC_TURFIT_URL, SRC_SPONSOR_URL
npm run dry-run                # report in out/<timestamp>/ (issues.csv contains phone numbers; out/ is git-ignored)

IDENTITY_URL=postgresql://…/cheerit_identity node src/apply.ts            # plan only
IDENTITY_URL=… node src/apply.ts --apply                                   # write
IDENTITY_URL=… node src/apply.ts --verify-only                             # check
```

Requires Node 22.18 or newer (it runs TypeScript directly).

## Current state (this Mac only)

All five backends' `.env` files point at a **local Postgres on `localhost:5433`** (user `avenpc`), not at the dev servers. The databases are `cheeritadmin` (Score), `pickle` (booking), `predictit`, `turfit2` (TurfIT) and `cheerit_sponsor`.

- **Dry run on those local DBs:** 43 records, 42 with usable phones, **31 people**, 6 people in more than one app (one person is in all five), 3 name conflicts, 1 email conflict, 1 rejected phone (a Sponsor record with no phone at all).
- **Stage 1 done:** I created the local database `cheerit_identity` and wrote 31 people and 42 memberships. All six verification checks pass. A second run created nothing new. The five app databases were not changed (no `identity_id` column anywhere).
- Undo: `DROP DATABASE cheerit_identity;`
- Other local databases I did not read: `cheerit`, `scoreit`, `sponsorit`, `sponsor_db`, `turfit_dev`, `turfit_preview`. They may be older copies, or one may be a real dev copy.
- If you continue on another device, the local `cheerit_identity` database does not travel with the code. Recreate it by running `apply.ts --apply` against that device's databases, or restore a dump.

## Windows machine (2026-10-28)

- Postgres 18 runs on `localhost:5432`, user `postgres` (tools in `C:\Program Files\PostgreSQL\18\bin`, not on PATH). Databases: `post` (Score), `gameit` (booking), `predictit`, `turfitweb` (TurfIT, local), `sponsor_db`, and `cheeritidentity` (identity; on this PC the name has no underscore).
- Stage 1 done here: dry run 14 records, 11 people, 1 person in all four apps, 1 name conflict, 0 rejected. Wrote 11 people and 14 memberships, all six checks pass, and a second run created nothing. Sponsor was left out (old schema, see below).
- **Stage 2 done here** (Sponsor excluded): backups in `backups/` (git-ignored, `pg_dump -Fc`), then the identity column was added and filled in `post` (1 row), `gameit` (3), `predictit` (9) and `turfitweb` (1). Verification passes for all four, and a second run linked nothing new. Restore any app with `pg_restore --clean -d <db> backups/<db>-<time>.dump`.
- The field was added to `schema.prisma` in `ScoreIT/backend`, `PredictIT-Extract/backend` and `turfit/Backend` (not committed). `prisma validate` passes, and `prisma migrate diff` shows no difference for the identity column. The booking repo is not on this PC, so add `identityId String? @unique @map("identity_id") @db.Uuid` to its user model before its next `db push`.
- Unrelated drift found: the local `post` DB has `si_reward*` tables that ScoreIT's schema no longer has, and local `turfitweb` is behind TurfIT's schema. A `prisma db push` would drop or change those, regardless of this work.
- App repos are in `D:\Downloads`, and their `.env` files point to a mix of places: Sponsor `sponsor_db`, PredictIt `predictit`, Score something on local 5432, and **TurfIT at a remote Aiven cloud database**. Do not read or write the TurfIT one without explicit approval.
- `CheerIT-Sponsor-main` here is an **older copy**: no OTP/mobile migration and no `mobile_number` on `sp_sponsor_auth_users`. The Sponsor source query will fail against `sponsor_db` until it is updated.
- The booking platform repo is not here (`pickleball` may be related, unchecked).
- The per-app SQL now uses plain unique indexes with Prisma's default names, instead of partial indexes Prisma cannot express.

## Step A: identity service (built 2026-10-28)

- `src/server.ts` (Express 5, port 4100, localhost only by default), `src/service/` (routes, store, API keys), `src/issue-key.ts`, `sql/002_app_clients.sql`. API and the call for app backends are in `README.md`.
- 29 tests pass. Six of them run the service over HTTP against the throwaway database `cheeritidentity_test`.
- Started once against the real local `cheeritidentity`: health check OK, and calls without a key are refused. No API keys have been issued yet.
## Step B: apps call the service (2026-10-28)

Done and tested end to end on this PC for PredictIt, TurfIT (player and owner), Score (OTP login and booking handoff) and GameIT (`pickleball` repo). Each one is on a `cheerit-identity` branch on GitHub, not merged. Each app has an identity client file, one call after login (never awaited, never blocks login), a migration (`IF NOT EXISTS`, safe where link.ts already added the column), and the Prisma field. It is off unless `IDENTITY_SERVICE_URL` and `IDENTITY_API_KEY` are set in that backend's `.env`. Keys were issued for predictit, turfit, score and booking and written into the local `.env` files only.
- ScoreIT's branch starts from `scoreit/badminton`, not its main branch.
- **Score security bug:** `/api/auth/otp-verify` never checks the OTP, so any code logs in as any phone. Score therefore sends `phoneVerified: false`.
- Every repo commits its `.env` (secrets in git history). Not changed.
- Not done: Sponsor (old copy here), CheerIT-COM (other developer). Then step C, SSO.

## Next steps

1. **Stage 2 (writer built, waiting for approval to run):** `src/link.ts` adds the identity column to each app (using `sql/apps/*.sql`), fills it from `cheerit_identity`, and verifies every link. It shows the plan unless `--apply` is passed, refuses non-local hosts without `--allow-remote`, never overwrites a row holding a different identity (it refuses that app instead), and writes each app in its own transaction. Connection strings: `IDENTITY_URL` plus `LINK_SCORE_URL`, `LINK_BOOKING_URL`, `LINK_PREDICTIT_URL`, `LINK_TURFIT_URL`, `LINK_SPONSOR_URL`. Score admins are skipped (no column on `si_admin`). Add the Prisma field first, see `sql/apps/README.md`. The planning logic is unit tested, but the CLI has **not yet run against a real database**.
2. Run the same dry run and write against the **real dev servers** (devturfit, devgameit, devscoreit, devpredictit, devsponsorit). This needs read-only credentials or database dumps. Those servers were not reachable from the session.
3. **CheerIT-COM:** ask its developer for the users table name and columns and a read-only export or API.
4. Review the real dry-run report together: rejected phones, conflicts, overlaps.
5. Production migration: backup first, one app at a time, smallest app first.
6. Then start SSO: the Identity service, token issue and verify, and switch the apps over, keeping the old login behind a flag for rollback.

## Open items

- Confirm the Score versus booking domain mapping.
- **Security:** in `CheerIT-Sponsor/backend/middleware/auth.ts` the token secret falls back to `"cheerit-demo-secret"` if `AUTH_SECRET` is not set, and the OTP hash uses the same fallback. Confirm `AUTH_SECRET` is set in Sponsor production, otherwise login tokens can be forged.
- Confirm the identity domain names (`accounts.cheerit.com`, `devaccounts.avenengage.com` proposed).
- Score users: avatar, city and gender sit on the separate Players table and are not read yet. Score admins (`si_admin`) are included as people with role ADMIN but the local table was empty.
- The phone-verified assumption: Score, booking, PredictIt and TurfIT users are treated as verified because those apps create the user at OTP verification. Worth confirming.
- Not yet checked: whether the CheerIT-COM SSO token is single-use. A token in a URL can end up in logs and browser history.
- SMS: Sponsor sends OTP through the webtechsolution gateway (env vars). Confirm whether the other apps use the same provider before moving OTP into the Identity service.
