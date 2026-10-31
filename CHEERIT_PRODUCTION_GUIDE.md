# ScoreIT ↔ CheerIT: cheering, SSO, events, scores. Production guide

Written 2026-10-31 from the working local setup. **No secret values are in this file or in any file in this repo; settings are named, never
valued.** Read `HANDOFF.md` first for status; this file is "how to make production the same as what works locally".

Related files: `PRODUCTION_RUNBOOK.md` (identity service + data move for Score, GameIT, PredictIt, TurfIT: Phases 0 to 8),
`PRODUCTION_COMMANDS.md` (commands only), `CONVERSATION.md` (the whole story), `dev-tools/cheerit-integration/` (tests and helpers).

---

## 1. What exists now

A viewer on a ScoreIT match page can **cheer** (photo or video) and the cheer is saved in **CheerIT** as a normal submission under
their CheerIT account, with no second login.

```
 ScoreIT match page ──(1) which CheerIT event?──▶ ScoreIT backend ──▶ CheerIT API (events, teams, scorecards)
        │                                              │  every 15 s: creates the event, teams, logos, sends the score
        │(2) log in once (SSO)                         ▼
        ├────────────────▶ ScoreIT backend ──▶ Identity service ──▶ CheerIT /api/auth/sso-login ──▶ CheerIT session
        │(3) camera, sound check, compression (in the browser)
        └──(4) upload slot + file ──────────────────────────────▶ CheerIT API ──▶ storage (S3)
```

| Piece | Where it lives | State |
|---|---|---|
| Identity service + one person per phone across apps | `cheerit-identity` repo (`main`) | Done, on the dev server. Production: `PRODUCTION_RUNBOOK.md` |
| ScoreIT cheer card, event creation, logos, scores, video/sound logic | Score repo, branch `feat/cheerit-cheer` (latest `070844e5`) | Built and tested locally; **not merged** |
| SSO route in CheerIT (`POST /api/auth/sso-login`) + identity link | CheerIT repo, branch **`sso-login`** (commit `7f782fd`, only this on top of `main`; same change as `d5f3b67` on `globaldb`) | Built and tested locally; **needs CheerIT's team to deploy** |
| Name, logo and score under each logo on CheerIT-COM's card | CheerIT-COM branch `feat/card-team-name-and-score` (`3b4be2e`) | Pushed, not merged |
| Football, badminton | not wired in | They live in separate Score tables; the sport mapping is ready |

## 2. Decisions you must make before production

| # | Decision | Recommendation | If you choose differently |
|---|---|---|---|
| 1 | **SSO (no OTP for the viewer) or CheerIT OTP once?** | SSO (your choice "B") | OTP once: no CheerIT change needed. Set `VITE_CHEERIT_TOKEN_LOGIN` off. |
| 2 | Events **PUBLIC or PRIVATE**? | PRIVATE at first | PUBLIC lists the events in CheerIT's own live list **and pushes a "live now" notification to every CheerIT user with a push token, for every match** |
| 3 | Let Score **create** the CheerIT events/teams/competition? | Yes, but test with fake team names first | Otherwise CheerIT admins create an event per match by hand; the card links by team names |
| 4 | SSO **creates a CheerIT account** for a ScoreIT user who has none | Confirm with the CheerIT team (see §5) | Without it, such users cannot cheer until they sign up on CheerIT |
| 5 | One event per **match** (current) | keep | (an older design shared one event per pair of teams and made 5 live matches look like 2) |

## 3. Every setting, by place

### 3.1 Identity service (already described in `PRODUCTION_RUNBOOK.md`)
`IDENTITY_URL` (its database), `PORT` (4100). Issue **one key per app** with `npm run issue-key -- <app>` where `<app>` is one of
`score booking predictit turfit sponsor com`. A new key revokes the app's previous key. The key is printed once and never stored:
copy it straight into that app's `.env`, never into chat or Git.

### 3.2 CheerIT API (`CheerITWebAPIV4/.env`), **new**, only for SSO
| Setting | Value | Notes |
|---|---|---|
| `IDENTITY_SERVICE_URL` | address of the identity service, e.g. `http://<identity-host>:4100` | CheerIT's server must reach it |
| `IDENTITY_API_KEY` | the **`com`** key | Without these two, `/api/auth/sso-login` answers 503 and the card falls back to OTP |
| (database) | run `identity_link.sql` with `psql` | adds nullable `User.identity_id` (+ unique index) and `Event.external_source/external_id`; safe to repeat. **Never** `prisma migrate` or `db push` on production |
| (code) | `npx prisma generate` after pulling | the schema gained fields |
| Leave unset | `SCOREIT_API_URL`, `SCOREIT_MIRROR_*` | the old mirror is not used; it stays off when unset |

With those two settings CheerIT's normal OTP login also links the user to the identity (like the other apps).

### 3.3 Score backend `.env`
| Setting | Value | Notes |
|---|---|---|
| `IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY` | (already set for Score) | needed by `/api/auth/cheerit-sso` too |
| `CHEERIT_API_URL` | `https://api.avenengage.com` | no trailing `/api`. This address answered 200 from the Mac; **ask the CheerIT team to confirm it is production**. (`api.cheerit.com` did not resolve) |
| `CHEERIT_CREATE_EVENTS` | `on` | turns on event creation, logos and score sending. **Off by default.** |
| `CHEERIT_ORG_ID` | an organization id from CheerIT | only needed the first time, to create the "ScoreIT" competitions. Not needed if you create them by hand (below) |
| `CHEERIT_EVENT_ACCESS` | `private` (default) or `public` | see decision 2 |
| `CHEERIT_EVENT_TAG` | default `ScoreIT`; use e.g. `ScoreIT-dev` on a dev Score | events are named "A vs B (ScoreIT #12)". **If dev and production Score ever feed the same CheerIT, give them different tags**, or their match numbers collide |
| `CHEERIT_SYNC_SECONDS` | default `15` | how often events and scores are synced |
| `CHEERIT_VENUE_ID`, `CHEERIT_COMPETITION_ID`, `CHEERIT_GROUP_ID`, `CHEERIT_EVENTTYPE_ID` | optional | skip the find-or-create by name. `CHEERIT_COMPETITION_ID` is for cricket only |
| `CHEERIT_VIDEO_SECONDS` | default `7` | longest cheer video |
| `SCORE_PUBLIC_URL` | where Score serves uploaded files, e.g. `https://<score-api-host>` | used to copy **uploaded** team logos to CheerIT |
| Production only | `LOG_OTP_TO_CONSOLE` off, no dev OTP mode | security |

### 3.4 Score frontend build environment (rebuild after changing; Vite bakes these in)
| Setting | Value |
|---|---|
| `VITE_CHEERIT_API_URL` | `https://api.avenengage.com` (the card is hidden without it) |
| `VITE_CHEERIT_TOKEN_LOGIN` | `on` for SSO. Unset: the card goes straight to the CheerIT OTP login |
| `VITE_CHEERIT_WEB_URL` | optional, the "On CheerIT" link (default `https://cheerit.com`) |
| `VITE_PREDICT_API_URL`, `VITE_PREDICT_WEB_URL` | for the predict card (unchanged) |

After pulling the Score branch run **`npm install` in `frontend/`**: it now depends on `mediabunny` (tested version 1.55.2).

### 3.5 CheerIT storage (ask the CheerIT team)
The bucket that takes cheer uploads (`S3_BUCKET` in CheerIT's `.env`) needs a CORS rule allowing **POST** from Score's website
origins (every production and dev address). Without it the browser blocks the upload.

## 4. Order of work for production

1. **Backups** of every database you will touch (`PRODUCTION_RUNBOOK.md` Phase 0).
2. **Security items first** (§6): rotate secrets, untrack committed `.env` files.
3. **Identity + the four apps**: `PRODUCTION_RUNBOOK.md` Phases 1 to 8 (Score, GameIT, PredictIt, TurfIT). Merge and deploy the Score branch first
   because it carries the OTP fix: today any code logs in to Score as any phone.
4. **CheerIT, hand this to their team** (§5): the SSO route, the two settings, the SQL, the storage rule.
5. **Score settings**: §3.3 and §3.4, restart the backend with `--update-env`, rebuild the frontend.
6. **Test with fake teams**: start a cricket match named e.g. "Test Alpha" vs "Test Beta"; within 15 seconds an event "Test Alpha vs Test Beta (ScoreIT #n)" must exist in CheerIT.
   Cheer once with **a phone number you own**. Delete the test rows in CheerIT's admin panel.
7. **Decide public/private** and switch `CHEERIT_EVENT_ACCESS` only after the CheerIT team knows about the notifications.

Optional, to load **existing CheerIT users into the identity in bulk** (otherwise each is linked at their first login): set `SRC_COM_URL`
(read-only) and `LINK_COM_URL` (owner) in the identity `.env`, then follow Phases 4 and 5 of the runbook for the `com` app. Do this only after a backup of CheerIT's database.

## 5. Note for CheerIT's team (copy this)

> **What we need deployed** (small, additive, no existing behaviour changed):
> 1. Use branch **`sso-login`** of `Shriya2020/CheerITWebAPI` (one commit on top of `main`: 5 files, 181 insertions, 0 deletions)
>    (`identityClient.js`, `POST /api/auth/sso-login`, the login linking, `identity_link.sql`, 6 lines in `schema.prisma`).
>    Do **not** merge the whole branch: it also holds an unused match mirror and a merge that includes a committed `.env`.
>    (To rebuild it yourself: `git checkout -b sso-login origin/main && git cherry-pick d5f3b67`.)
> 2. Run `identity_link.sql` with psql (nullable columns and indexes only). Then `npx prisma generate` and restart.
> 3. Add two settings to CheerIT's `.env`: `IDENTITY_SERVICE_URL` and `IDENTITY_API_KEY` (a key for the app `com`, given to you privately).
> 4. Storage: allow `POST` from ScoreIT's website origins (list to follow) on the cheer-upload bucket.
> 5. Give us an organization id for a "ScoreIT" competition (or create competitions "ScoreIT", "ScoreIT Football", "ScoreIT Badminton" with event types Cricket, Football, Badminton).
>
> **What SSO does:** ScoreIT proves who the viewer is (phone verified by ScoreIT's own OTP); the identity service issues a 5-minute one-time token;
> CheerIT swaps it for a normal web session. If the person has no CheerIT user (found by identity link, then by phone), **one is created**
> (`full_name` from the identity, `gender: OTHER`). Blocked users are refused (403). Please confirm account creation is acceptable.
>
> **What ScoreIT will do in CheerIT** (using existing routes, no login): find or create the venue "ScoreIT", the competition, an empty event group "ScoreIT" (a private event
> must have a group), the two teams (with a logo), add the teams to the competition, create one event per live match, and post ball-by-ball to
> `/api/scorecards`. **These create routes have no authentication today, so anyone on the internet can call them.** Please add authentication; tell us when you do, because
> ScoreIT would then need a credential (not built yet).
>
> **Two other issues we found:** the upload route trusts `user_id` from the request body instead of the login; and CheerIT's repository has a commit "env publish" that
> **added a real `.env` file to Git** (it is on `main`). Treat everything in it as exposed: rotate the secrets and untrack the file.

## 6. Security checklist

- [ ] **CheerIT repo has `.env` tracked** (commit "env publish" on `main`). Untrack (`git rm --cached`), add to `.gitignore`, rotate the database password, AWS keys, SMS key, JWT secrets, Firebase and Google keys it holds. Do not merge `globaldb` as it is.
- [ ] CheerIT create routes (`/api/events`, `/api/team`, `/api/event-teams`, `/api/competition-team`, `/api/venues`, `/api/competition`, `/api/event-groups`, `/api/scorecards`) have no login check. Add one.
- [ ] CheerIT upload route trusts `user_id` in the body.
- [ ] Other repos had `.env` committed (for example Score `backend/.env` via the `scoring` commit): untrack and rotate.
- [ ] You pasted a full CheerIT `.env` into a chat on 2026-10-31. Treat its database password, AWS key, SMS key and JWT secrets as exposed and rotate them.
- [ ] Delete `/Volumes/MACDISK/kartik/.com-key.tmp` (a `com` identity key used for local testing; it only works against the local identity database, but delete it anyway).
- [ ] Sponsor `AUTH_SECRET` must be set in production. OTP logging off.
- [ ] Do not push your local `globaldb` merge: it contains the `.env` commit and your local database address.

## 7. How it behaves (reference)

**Event per match.** Every live match (status `live`) of a supported sport gets its own CheerIT event, named `A vs B (ScoreIT #<match id>)`.
Linking uses the `#id` marker; a hand-made CheerIT event that names both teams (no marker) is also reused. A team missing in Score data shows as **"Unknown"**,
as on Score's own pages. Cricket (type 1) is built in; football (2) and badminton (8) are mapped but their matches are not read yet (separate tables).
Pickleball has no CheerIT event type.

**Teams, logos.** Teams are found by name (case and punctuation ignored) or created (type CLUB). A team gets its uploaded Score logo, or else the **same default picture the
Score website shows** (ten images in `backend/assets/team-badges`, chosen with the same name hash; verified identical on 508 names). Teams made earlier get a logo once per server run.
CheerIT-COM's card turns `http://` picture links into `https://`, so CheerIT's `BASE_URL` must be an https address in production.

**Scores.** Every 15 seconds, for each live match: scorecard and innings created if missing, then CheerIT's balls are compared with Score's and only the **difference** is
sent (add, fix, delete), so edits and undos in Score are copied and a restart never doubles balls. When the match ends the scorecard is marked complete.
Totals were verified equal (balls, runs, wickets, legal balls) on all five test matches. Players are not sent.

**Cheer card.** Team pick → full-screen camera (Photo/Video pills, countdown, up to 7 s, switch camera, gallery, "Use camera app" fallback) → preview with
**Retake** (reopens the camera) → consent → upload with progress. **Sound check** (same thresholds as the CheerIT website): refused if under 2 s, silent, or too quiet; live MIC bar.
**Video compression** (mediabunny, as the CheerIT website): over 2 MB or longer than the limit is re-encoded to about 2 MB MP4, first 7 seconds, max 1280 px; a 12 s 1080p clip took 1.3 s.
Photos are resized to under 2 MB. Limits from CheerIT: video 10 MB, photo 2 MB, 5 cheers per user per event, only inside the event's cheer window.
Not copied from the website: tilt correction (sideways phones) and the brightness filter.

**Login.** With `VITE_CHEERIT_TOKEN_LOGIN=on`: Score `POST /api/auth/cheerit-sso` → identity `/v1/sso/issue` → CheerIT `/api/auth/sso-login`. On any failure the card falls back to the
CheerIT OTP login (number shown masked, "Use a different number"), saved on that device afterwards.

**Where PUBLIC vs PRIVATE shows.** CheerIT's live list hides PRIVATE events; ScoreIT's lookup asks with `?access_scope=all`, so the card still finds them.

## 8. Checks (replace the placeholders)

```bash
# CheerIT answers, lists the live events (add ?access_scope=all to include PRIVATE ones)
curl -s "https://<cheerit-api>/api/events/mobile/live?access_scope=all" | head -c 400

# Score links a match to its event
curl -s http://127.0.0.1:<score-port>/api/public/matches/<match-id>/cheerit        # {"linked":true,"eventId":...}

# SSO route is deployed AND connected to the identity service, using a deliberately wrong token:
#   401 "Invalid or expired" = working;  503 = IDENTITY_SERVICE_URL / IDENTITY_API_KEY not set on CheerIT;  404 = route not deployed
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<cheerit-api>/api/auth/sso-login -H 'content-type: application/json' -d '{"token":"wrong"}'

# Score log after restart must say:
#   [cheerit-event] creating CheerIT events and sending scores for live matches every 15s
# and must not repeat "background check failed"
```
Database check on CheerIT (read-only): `select event_name, access_type from "Event" order by created_at desc limit 10;`

## 9. Rollback

- **Stop creating events and sending scores:** remove `CHEERIT_CREATE_EVENTS` (or set it to anything but `on`), restart Score. Existing events stay.
- **Back to OTP login:** unset `VITE_CHEERIT_TOKEN_LOGIN`, rebuild the frontend. CheerIT's SSO route can stay.
- **Hide the card:** unset `VITE_CHEERIT_API_URL`, rebuild.
- **Delete test data in CheerIT:** admin panel. An event with a scorecard or cheers needs those removed first.

## 10. Problems seen, and the cause

| Seen | Cause | Fix |
|---|---|---|
| OTP request 500 "SMS settings not configured" (local) | empty database has no `SMSSetting` row | insert a row; production already has one |
| OTP accepted by the provider but no SMS | the `LOGIN_OTP` template text must match the registered text (Score's code holds it: "Your OTP is … Do not share it with anyone. AvenCheer") | use the registered wording |
| Card showed only photo buttons | event created without `allow_video_with_audio` | fixed in creation (`ae336098`); for old events set it true |
| 5 live matches became 2 events | events were per pair of teams | now per match (`867ef9ae`) |
| Logos broken in COM (local) | COM upgrades `http://` to `https://`; local CheerIT has no https | local: empty `BASE_URL`; production is https already |
| `POST /api/auth/cheerit-sso` 502 | identity service not running, or `IDENTITY_*` missing | start it; card falls back to OTP anyway |
| `sso-login` 503 | CheerIT has no `IDENTITY_*` settings | add them |
| CheerIT API stuck at start | it waits for Redis even with `REDIS_ENABLED=false` | local only: stand-in Redis (`dev-tools/.../fake-redis.mjs`) |
| Private event creation 400 "At least one group is required" | CheerIT rule | the empty group "ScoreIT" is created |
| Event time crash "Invalid Date" | CheerIT reads times as IST text `2026-10-31 18:00:00`, not ISO with Z | fixed |
| Details route failed without a user | CheerIT looks a user up even for a visitor | the card sends a nil UUID |
| "event type must match the competition" | CheerIT rule | one competition per sport |
| `npm run issue-key` for `com` revoked nothing else | only that app's key is replaced | fine |
| Earlier mistakes | duplicate `CHEERIT_API_URL` line in `.env` (last wins); broad `pkill`; running tests twice created duplicate test events | check `.env` for duplicates; kill by PID; clean test data |

## 11. Local setup used for testing (all stand-ins, no production)

Local ports: CheerIT API copy **4400** (database `cheerit_new`, created with `prisma db push`, then seeded: event statuses 1 to 4, category Sport, type Cricket, one organization, an SMS
settings row and the `LOGIN_OTP` template), stand-in storage **4500** (`fake-s3.mjs`, with `AWS_ENDPOINT_URL_S3` and fake AWS keys so nothing reaches AWS), stand-in Redis **6379**,
identity service **4100**, Score backend **3001**, Score frontend **3000**, CheerIT-COM **3004**. Test login number: the one owner number already in the local CheerIT user table.
Start CheerIT with settings overridden on the command line (never edit its `.env`): `DATABASE_URL`, `PORT`, `BASE_URL=""`, `AWS_*`, `AWS_ENDPOINT_URL_S3`, `IDENTITY_SERVICE_URL`, `IDENTITY_API_KEY`.
Tests are in `dev-tools/cheerit-integration/`: event creation (`score-cheerit-create-test.mts`, stub CheerIT, runs 5 times stable), ball diff (`diff-test.mts`), badge hash vs the website (`badge-test.mts`),
sound rules vs the website (`audio-test.mts`), video compression in Chrome (`video-test/`), full SSO cheer (`sso-cheer.mjs`), real-data loop (`loop-real.mts`, needs `DATABASE_URL`), and `drive.mjs` which drives the real card
in headless Chrome with a fake camera and saves screenshots (mobile 390×844 and desktop).

## 12. Not verified yet (do on the first real run)

Real CheerIT: SSO end to end; storage CORS; the live-list shape of the real server beyond the fields used; one real cheer from a phone you own; event creation on the real server (only run locally, against CheerIT's own code and a copy database);
a real phone's portrait camera and sideways handling; Safari's behaviour for video compression (it falls back to sending the file if it cannot convert).
