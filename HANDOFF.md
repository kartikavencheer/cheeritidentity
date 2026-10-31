# CheerIT identity: handoff notes

Last updated 2026-10-30 (Mac). Read this first. Deploying: `PRODUCTION_RUNBOOK.md` (everything, with reasons) and
`PRODUCTION_COMMANDS.md` (commands only). Full discussion: `CONVERSATION.md`.

## Goal and status

One account per person across the CheerIT apps, keyed by phone number, plus cheering for a match from the Score page.

| Piece | Status |
|---|---|
| Identity DB + service + data move (`apply.ts`, `link.ts`) | ✅ Done and verified on the **dev server** (16 people, 41 memberships) |
| Identity calls in Score, GameIT, PredictIt, TurfIT | ✅ Turned on and tested on dev (one login per app shows in `user_apps`) |
| Sponsor | Left out on dev (0 users there). Code is ready; see runbook Phase 8 |
| Score OTP fix (`/api/auth/otp-verify` now checks the OTP) | ✅ Tested, on dev. **Not merged on GitHub**: it is inside `feat/cheerit-cheer` |
| Score cheer card (team pick, live camera, upload) | ✅ Built and tested against a stand-in CheerIT. **Not merged**, not deployed |
| Real CheerIT | ❌ Never tested against the real server (no access) |
| Production | ❌ Not started |
| Identity data visualisation page, login-once across apps (SSO) | ❌ Not built |

## The rule: CheerIT is not changed

No code and no database change in CheerIT. The cheer card uses CheerIT's existing API only. A side branch `globaldb` in
`Shriya2020/CheerITWebAPI` has earlier changes (identity link, token login, match mirror). **They are not needed. Do not deploy
them.** `main` there is untouched. The identity repo still has a `com` source/link target for CheerIT's user table; it is unused
(leave `SRC_COM_URL`/`LINK_COM_URL` empty), and linking would add a column to CheerIT's database, so do not run it.

## Branches to merge (nothing below is merged yet)

| Repo | Branch | What |
|---|---|---|
| `Shriya2020/ScoreIT` | `feat/cheerit-cheer` | Cheer card, OTP fix, lookup route, optional token route |
| `Shriya2020/pickleball` (GameIT) | `fix/identity-skip-data-avatar` | Do not send base64 photos to identity (they made the call fail with HTTP 500) |
| `Shriya2020/turfitweb` | `fix/identity-skip-data-avatar` | Same |
| `Shriya2020/predictitapp` | `master` | Already has the identity code |
| `kartikavencheer/cheeritidentity` | `main` | The service and scripts (deploy from GitHub, not a local copy) |

## Dev server (Linux, pm2, one box for all backends)

- Identity service under pm2 as `identity` on `127.0.0.1:4100`; database `cheeritidentity`; keys issued for `score`, `booking`,
  `predictit`, `turfit`, each in that app's `.env` only (`IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY`).
- Backups of the app databases from before the data move are in `~/websites/cheeritidentity/backups/` there.
- Several repos on that server have **uncommitted hand-applied edits** (Score has a half-finished merge of the `scoring` commit,
  GameIT has a local `env` commit that is not on GitHub: do not push it, it may contain `.env`). Do not `git stash` or `reset`.
- Score on dev has the OTP fix applied by hand; GameIT has the avatar fix applied by hand.
- CheerIT's API is **not** on that server. The Score cheer feature has not been switched on there.

## Score cheer feature (branch `feat/cheerit-cheer`)

- `GET /api/public/matches/:id/cheerit` finds the live CheerIT event by team names (exactly one event must name both teams).
- The card reads the event settings and teams from CheerIT (`/api/events/mobile/:id/details`), then uploads like the CheerIT web app.
- Login: one-time token if CheerIT ever supports it; today a one-time CheerIT OTP inside the card.
- **Auto-create (off by default):** with `CHEERIT_CREATE_EVENTS=on`, every `CHEERIT_SYNC_SECONDS` (default 30) and on page open, a live cricket match with no CheerIT event gets one made through CheerIT's
  existing API (`backend/server/cheeritEventCreate.ts`): finds or creates the "ScoreIT" venue, competition and (empty) event group (creating the competition needs
  `CHEERIT_ORG_ID`; a private event must have a group), finds or creates both teams, adds them to the competition, creates a PRIVATE event (4 hours, 7 s video, 5 cheers).
  `CHEERIT_EVENT_ACCESS=public` makes events public (listed in CheerIT's live list, but pushes "live now" to every CheerIT user for every match); default private.
  Optional `CHEERIT_VENUE_ID`, `CHEERIT_COMPETITION_ID`, `CHEERIT_EVENTTYPE_ID` (default 1 = Cricket, a sports type). Tested against a stub AND against CheerIT's own code on a local
  database (`cheerit_new`, port 4400; not the production server). Real CheerIT (`https://api.avenengage.com`) has no login on these create routes: tell its team.
  The lookup uses `?access_scope=all` because PRIVATE events are hidden from the public live list.
- **Logos and scores:** team logos are copied to the CheerIT team (the uploaded logo, else the default picture the Score website shows, from `backend/assets/team-badges`;
  `SCORE_PUBLIC_URL` says where Score serves uploads from). The CheerIT COM web card shows logos but does NOT read scores from CheerIT. Cricket scores go to CheerIT's scorecard API (`backend/server/cheeritScoreSync.ts`): scorecard, innings, balls, edits and undos, and
  "complete" when the match ends. One scorecard per event, so the newest live match feeds an event shared by several. Loop default is 15 s
  (`CHEERIT_SYNC_SECONDS`). Players are not sent. Football/badminton are not wired in (separate Score tables).
- Needs `CHEERIT_API_URL` (Score backend) and `VITE_CHEERIT_API_URL` (Score frontend build). Hidden without them.
- Ask the CheerIT team: a live sports-type event naming both teams; storage CORS (POST) for Score's websites.
- Local demo: `FAKE_MATCH_IDS=12 PORT=4300 node backend/dev/fake-cheerit-api.mjs` in the Score repo (CheerIT login code `123456`).
- Known: cheers are approved at once unless the event has the AI check on; CheerIT trusts `user_id` in the upload request.

## Mac (local) state

- Postgres on `localhost:5433` (user `avenpc`). DBs: `cheeritadmin` (Score), `pickle` (GameIT), `predictit`, `turfit2`,
  `cheerit_sponsor`, `cheerit_identity` (31 people). Scratch DBs for tests (safe to drop): `cheerit_api_scratch`,
  `cheeritidentity_test`, `cheeritidentity_com_scratch`.
- The Score working tree has uncommitted work that is not from this notes' author (predict card, `.env` files). Tracked `.env`
  files hold secrets.
- Local Score runs from `CheerIT-Score`; my cheer branch lives in a separate worktree `CheerIT-Score-cheer`
  (`git worktree remove` when done).

## Open items (most urgent first)

1. Merge the branches above; deploy the Score OTP fix first (today any code logs in to Score as any phone).
2. Untrack the `.env` files committed in the app repos (the `scoring` commit pushed Score's `backend/.env`) and rotate secrets.
3. Sponsor `AUTH_SECRET` must be set in production (else it falls back to `cheerit-demo-secret`).
4. Turn off OTP logging and dev OTP mode in production.
5. Real-CheerIT check of the cheer card: `GET /api/events/mobile/live` shape, one real cheer, storage CORS.
6. Tell the CheerIT team about the `user_id` trust issue in their upload endpoint.
7. Production rollout, one app at a time, with backups (runbook).
8. Later: visualisation page for the identity data, login-once across apps.

## Lessons (do not repeat)

- Never paste `<placeholders>` into a command or a `.env` (a literal `<predictit key>` was written twice). Have scripts write keys
  straight into the file.
- Test with a number you own: every real login sends an SMS. Never use seed numbers (`+919000000001` was a real user).
- A login filter in a check query hides the other apps (`where app_key='booking'`).
- `pkill -f` patterns are too broad: one stopped a stand-in server that was not mine.
- `prisma generate` after pulling code with a new Prisma field; never `db push` or `migrate deploy` for this.
- A disk at 100% breaks everything (npm, the shell). Keep caches on the big volume.
