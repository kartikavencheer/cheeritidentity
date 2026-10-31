# CheerIT identity and cheering: handoff notes

Last updated 2026-10-31 (Mac). Read this first. For production: `CHEERIT_PRODUCTION_GUIDE.md` (the cheer feature, SSO, events, scores,
every setting) and `PRODUCTION_RUNBOOK.md` (identity service and the four apps). The whole story: `CONVERSATION.md`.
**No secret values are in any of these files.** Refer to secrets by name.

## Goal and status

One account per person across the CheerIT apps (keyed by phone), and cheering for a match from the Score page, saved in CheerIT.

| Piece | Status |
|---|---|
| Identity DB + service + data move (`apply.ts`, `link.ts`) | ✅ Done and verified on the **dev server** (16 people, 41 memberships) |
| Identity calls in Score, GameIT, PredictIt, TurfIT | ✅ On and tested on dev |
| Sponsor | Left out on dev (0 users). Code ready; runbook Phase 8 |
| Score OTP fix (`/api/auth/otp-verify` checks the code) | ✅ Tested. **Not merged**: it is inside `feat/cheerit-cheer` |
| **Score cheer card**: team pick, full-screen camera, photo/video, Retake, preview, consent, upload | ✅ Tested locally in headless Chrome (mobile 390×844 and desktop). **Not merged** |
| **Video compression** (mediabunny, ~2 MB, trims to 7 s) and **sound check** (too short / silent / too quiet) | ✅ Ported from CheerIT-COM; compression measured 1.3 s for a 12 s 1080p clip |
| **Score creates CheerIT events** (venue, competition, group, teams, one event per match) | ✅ Tested against CheerIT's own code on a local DB. Off by default (`CHEERIT_CREATE_EVENTS`) |
| **Logos and live scores** from Score to CheerIT | ✅ Logos (uploaded, else the Score website's default picture); scores verified equal on 5 matches |
| **SSO** Score → CheerIT (no OTP) | ✅ Works locally (identity service + CheerIT route). **CheerIT's team must deploy `d5f3b67`** |
| CheerIT-COM card: team name and score under the logo | Local edit only, uncommitted (`src/api/client.ts`, `src/components/MatchCard.tsx`) |
| Football, badminton | ❌ Not wired in (separate Score tables; sport mapping ready) |
| Real CheerIT / production | ❌ Never run against the real server |

## The rule about CheerIT changed

Earlier you said **"don't change CheerIT"**. Then you chose **SSO ("B")**, which needs one small additive change there: commit `d5f3b67`
on the CheerIT side branch `globaldb` (5 files, 0 deletions: `POST /api/auth/sso-login`, identity link, `identity_link.sql`).
Without SSO nothing in CheerIT changes and the card asks for a CheerIT OTP once. The rest (creating events, logos, scores, cheering) uses CheerIT's
**existing** routes only. Do **not** deploy the whole `globaldb` branch: it holds an unused match mirror and a merge that includes a committed `.env`.

## Branches (nothing here is merged yet)

| Repo | Branch | What |
|---|---|---|
| `Shriya2020/ScoreIT` | `feat/cheerit-cheer` (latest `070844e5`) | cheer card, OTP fix, event creation, logos, scores, video/sound logic, full-screen camera |
| `Shriya2020/pickleball` (GameIT) | `fix/identity-skip-data-avatar` | do not send base64 photos to identity |
| `Shriya2020/turfitweb` | `fix/identity-skip-data-avatar` | same |
| `Shriya2020/predictitapp` | `master` | already has the identity code |
| `kartikavencheer/cheeritidentity` | `main` | service, scripts, and these docs |
| `Shriya2020/CheerITWebAPI` | `globaldb` (only commit `d5f3b67` is wanted) | SSO route and identity link |

## Where things run locally (for testing)

CheerIT API copy on **4400** (`cheerit_new`), stand-in storage **4500**, stand-in Redis **6379**, identity **4100**, Score backend **3001**, Score frontend **3000**, CheerIT-COM **3004**.
Details and how they are started: `CHEERIT_PRODUCTION_GUIDE.md` §11. Tests and helpers: `dev-tools/cheerit-integration/`. Local helper processes were started by hand and are
not under pm2; stop them when done. Your own CheerIT dev server (port 3002, `npm run dev`) now points at the local `cheerit_new` database.

## Dev server (Linux, pm2, one box for all backends)

- Identity service under pm2 as `identity` on `127.0.0.1:4100`; database `cheeritidentity`; keys for `score`, `booking`, `predictit`, `turfit` (each in that app's `.env` only).
- Backups of the app databases from before the data move: `~/websites/cheeritidentity/backups/` there.
- Several repos on that server have **uncommitted hand-applied edits** (Score half-merged `scoring` commit; GameIT has a local `env` commit that must not be pushed). Do not `git stash` or `reset`.
- CheerIT's API is not on that server. None of the cheer feature is switched on there.

## Mac state

- Postgres on `localhost:5433`. DBs: `cheeritadmin` (Score), `pickle`, `predictit`, `turfit2`, `cheerit_sponsor`, `cheerit_identity`, plus `cheerit_new` (local CheerIT copy, seeded) and scratch DBs
  (`cheerit_api_scratch`, `cheeritidentity_test`, `cheeritidentity_com_scratch`: safe to drop).
- The Score working tree (`CheerIT-Score`) holds uncommitted work that is not mine (predict card, `.env` files); I copied my files in. The cheer branch lives in a worktree `CheerIT-Score-cheer`.
- The CheerIT API folder is on branch `globaldb` with a local merge that brought in a committed `.env`. **Do not push it.** `git checkout main` there when done.

## Open items (most urgent first)

1. **Security**: CheerIT's repo has a real `.env` committed on `main` (commit "env publish"); CheerIT's create routes have no login; its upload route trusts `user_id`.
   Rotate and untrack (see `CHEERIT_PRODUCTION_GUIDE.md` §6). The secrets pasted into a chat on 2026-10-31 count as exposed. Delete `/Volumes/MACDISK/kartik/.com-key.tmp`.
2. Merge the branches above; deploy the Score OTP fix first (today any code logs in to Score as any phone).
3. Untrack the other committed `.env` files (Score `backend/.env` via the `scoring` commit) and rotate their secrets. Sponsor `AUTH_SECRET`. Turn off OTP logging.
4. Hand `CHEERIT_PRODUCTION_GUIDE.md` §5 to CheerIT's team: SSO route, two settings, SQL, storage CORS, organization id, authentication on the create routes.
5. First real run (guide §12): SSO, storage CORS, event creation, one real cheer with a number you own.
6. Decide public or private events (public notifies every CheerIT user for every match).
7. Football and badminton; tilt correction on the camera; commit the CheerIT-COM name/score edit if you want to keep it.
8. Later: identity data visualisation page; login-once across apps.

## Lessons (do not repeat)

- Never write a secret value into chat, a file or a commit; name it. Test scripts read keys from `.env` themselves. (You told me this on 2026-10-31.)
- Never paste `<placeholders>` into a command or `.env`. Check `.env` for **duplicate** lines (the last wins: a stale `CHEERIT_API_URL` pointed at a dead address).
- Use only phone numbers you own: every real login sends an SMS. Never use seed numbers.
- `pkill -f` is too broad; kill by PID. Do not leave test events behind (a test that crashed after creating data and was re-run made duplicates).
- A login filter in a check query hides other apps. `prisma generate` after pulling a new Prisma field; never `db push` or `migrate` on production or for this feature.
- A stub test can pass while the real server refuses: always run once against the real code on a copy (this found four bugs: group, IST times, details user, video flag).
- Copy a changed file into your own working tree before testing the page there (the first screenshots showed old code for that reason).
- A disk at 100% breaks everything; keep caches on the big volume.
