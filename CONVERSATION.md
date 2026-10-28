# CheerIT identity: full conversation record

Date of session: 2026-10-28. This is a turn-by-turn record of the whole discussion, condensed but complete in
substance, so it can be read on another device. For the short version, see `HANDOFF.md`.

---

## 1. The question

**You:** You have separate projects (CheerIT-Score, CheerIT-Sponsor, CheerIT-COM, scoreit-sports-booking-match-platform,
predictitapp, turfitweb). Can they share a common login? A separate project and DB would record which apps each user
has, every app's backend user table would be fed from it, and later one ecosystem with SSO.

**What I checked:** the stack and user table of each app.

| App | Backend | User table | Id type | Login |
|---|---|---|---|---|
| CheerIT-Score | Express + Prisma + Postgres | `si_user` | Int | Phone OTP, JWT |
| Booking platform | Express + Prisma + Postgres | `users` | cuid | Phone OTP, JWT |
| PredictIt | Express + Prisma + Postgres | `users` | uuid | Phone OTP, sessions |
| TurfIT | Express 5 + Prisma 7 + Postgres | `User`, one row per (phone, role) | cuid | Phone OTP, JWT |
| Sponsor | Express + Prisma + Postgres | `sp_sponsor_auth_users` | uuid | Email + password, plus phone OTP |
| CheerIT-COM | Frontend plus a small server for OG tags | none here | n/a | Phone OTP, SSO from Android app |

**My answer:** yes. Four apps already use phone + OTP, all use Postgres and JWT, so phone number is the natural common key.
User ids differ in type (Int, cuid, uuid), so nothing is shareable by id today.

**First design:**
1. A new Identity service with its own Postgres DB: `identities` (global uuid, phone, email, name, avatar, verified flags),
   OTP requests, sessions, and `app_memberships` (which person uses which app).
2. Do **not** copy user tables into each app. Each app keeps its local user table and gets one new column, `identity_id`.
   Apps verify a token signed by Identity and find or create their local row.
3. One-time migration: group existing users by normalized phone number into one identity each, write `identity_id` back.
4. SSO via a central login page, with caveats for mobile.
5. Build a small custom service rather than adopt Keycloak, Ory or Auth0, since OTP code already exists.

**Questions I asked:** domains, clients, identity key, TurfIT roles, roles and permissions, OTP provider, rollout.

---

## 2. Your answers

- Domains are different for every project.
- Right now: web, and mobile apps that wrap the web.
- Phone number is the primary key.
- TurfIT roles: yes, fine.
- "Do everything, but don't code now, just give me a proper working explanation."

**My explanation covered:** the two kinds of data (identity data shared, app data private), why different domains need a
central login page, the full login flow, the identity DB tables, token model, how each app's local user links, the migration
with conflict handling, TurfIT roles, Sponsor and COM, mobile-wrapped-web caveats (each wrapper has its own WebView storage),
logout and phone-change and recycled-number edge cases, and a six-phase rollout. I assumed OTP moves into the Identity
service and that a pilot app comes first.

---

## 3. "Why is a common login page needed?"

**You:** Why is a common login page needed? I think you are going off topic.

**Answer:** It is needed only for true SSO across different domains. A shared identity can work without it: each app keeps
its own login screen and calls the Identity API in the background. Users get one account per phone, but have to enter the OTP
again in each app. I suggested starting there and adding the common page later without changing the design.

You answered: **you need SSO login.**

---

## 4. "If I have a common users DB, why is SSO not possible?"

**Answer:** SSO is possible, but the DB and the login session are separate problems. The DB says who a person is. SSO needs
to know whether *this browser* is already logged in, and that lives in a cookie or token in the browser. The browser keeps
cookies per domain and never sends one site's cookie to another. So turfitplay.com's login is invisible to predictitplay.com.
The fix is one central place (the common login page) that all apps can ask. So the common DB is the first half, and the
central login is the second half.

---

## 5. "What if we develop all projects SSO-compatible?"

**Answer:** That is exactly the plan, but "compatible" still needs one central place to log in. Options:
1. Central login page: works on any domain. Standard approach.
2. Put all apps under one parent domain (for example `*.cheerit.com`), where cookie sharing works. Needs domain changes.
3. Hidden tricks (iframes, third-party cookies): unreliable, and browsers are blocking them. Avoid.

---

## 6. Your domains

**Production:** scoreitplay.com, gameitplay.com, cheerit.com, predictitplay.com, turfitplay.com, sponsoritplay.com.
**Dev:** devgameit, devscoreit, devturfit, devpredictit, devsponsorit, devcheerit, all under `.avenengage.com`.

**Mapping I assumed (needs confirming):** cheerit.com is CheerIT-COM, scoreitplay.com is Score, gameitplay.com is the booking
platform, predictitplay.com is PredictIt, turfitplay.com is TurfIT, sponsoritplay.com is Sponsor.

**Design consequences:**
- Six unrelated prod domains means the redirect flow is required.
- Suggested Identity addresses: `accounts.cheerit.com` (prod) and `devaccounts.avenengage.com` (dev).
- Dev shares a parent domain, so cookie SSO would technically work there, but **dev must not use it**. Otherwise dev tests one
  system and prod ships another. Dev gets its own Identity service, DB and signing keys, and exact-host cookies.
- Each environment has an exact-match allow-list of redirect URLs per app.

---

## 7. "I don't understand what the issue is with different domains"

**Analogy given:** each domain is a separate building with its own guard. The badge from one building means nothing to the
other. The common DB is head office with everyone's records, but guards only check the badge you carry, and the browser only
lets a building see badges issued by that building. The fix is an extra "accounts" building: you show ID there once, and it
hands you a note ("this is user X, verified") to carry to the other buildings. That note-passing is the SSO.

---

## 8. "But in cheerit.com I implemented SSO from Android app to web. How were session and cookies transferred?"

**What I found in the code (CheerIT-COM):**
- The Android app, already logged in, opens `cheerit.com/sso/login?token=…&redirect=…`.
- `src/pages/SsoLogin.tsx` reads the token, and `ssoLogin()` in `src/context/AuthContext.tsx` calls the backend
  `/sso/login?token=…` (with a direct-URL fallback), receives an access token, and stores it in **localStorage**.
- No cookie was transferred. A one-time token was passed in the URL.

**Also found in Score:** `POST /api/auth/handoff` (`backend/server.ts`) accepts a signed token from the booking app. It
lives 2 minutes, and each token id can be used once (`usedHandoffIds`), configured by `SCORE_HANDOFF_SECRET`.

**Clarification of my earlier claim:** browsers never share logins automatically, but a site can pass a login on purpose by
putting a one-time token in the URL. That is the same idea as the central login page, which generalizes it. I flagged that I had
not checked whether the cheerit.com SSO token is single-use, since tokens in URLs can leak into logs and history.

---

## 9. "Then can't we implement the same logic?"

**Answer:** yes.
- **Click from App A to App B:** works with exactly your existing logic and needs no login page. App A's backend mints a signed
  one-time token and sends the user to App B's `/sso/login?token=…`.
- **User opens App B directly:** the token logic alone cannot cover this, because nobody has minted a token. Something central
  must answer "who is this browser?".
- Pairwise secrets between six apps means 15 pairs, so a single issuer scales better.

**Recommendation:** common users DB and an Identity service as the single issuer, reuse your handoff token logic, link hops ask
Identity for a token, and direct opens redirect to Identity, which uses its own cookie.

---

## 10. Decision: common DB first, SSO later

**You:** OK, SSO works, we will discuss after. Let's work on the common users DB first, for users only.

**My plan for the common DB** (new Postgres database `cheerit_identity`, people only for now):
- `users`: global uuid, phone (E.164, unique, required), `phone_verified_at`, name, email (not unique), avatar, gender, city,
  status, first app, last login, timestamps.
- `user_apps`: person, `app_key`, the id in that app's table as text, `app_role`, first and last seen.
- `migration_log`: every merge and skip.
- Each app gets one nullable `identity_id`; apps never read the common DB directly.
- Phase A: one-time backfill apps to common DB with a read-only dry run first. Phase B: new signups find or create the person
  centrally.
- I found that **Sponsor has no phone in its auth table in the original schema** (email + password, one auth user per company),
  so I asked how to handle it.

---

## 11. Your five answers

1. **Conflicts:** the most recently active app wins.
2. **Sponsor phone:** "not acceptable, but I have implemented OTP in Sponsor, please check thoroughly."
3. **CheerIT backend:** developed and hosted separately, you don't have access, but someone can provide it.
4. **Hosting:** same server is fine.
5. **Trial run:** nothing should get damaged or breached.

**Sponsor OTP review** (`otpService.ts`, `authService.ts`, `023_otp_and_mobile_login.sql`):
- Phone OTP login exists. The phone is on `sp_sponsor_auth_users.mobile_number`, unique, stored as 10 digits without `+91`.
- A stored mobile was set by a real OTP (OTP registration or first OTP login), so it counts as verified.
- Older email and password accounts have it empty. Login OTP matches them through the sponsor contact's mobile and saves the
  number on first use. A contact mobile alone is not proof of ownership.
- OTP: 6 digits, 5 minute expiry, 5 wrong attempts, 30 second resend gap, 5 requests per 15 minutes. SMS through the
  webtechsolution gateway via env vars.
- One auth user per sponsor company; the identity is that user's phone.
- OTP signups may get a fake login email like `<mobile>@mobile.sponsor`, which must never be imported.
- Superadmin is an env-var login with no DB row, so it is not migrated.
- **Security flag:** `middleware/auth.ts` falls back to the secret `"cheerit-demo-secret"` if `AUTH_SECRET` is unset, and the OTP
  hash does too. If production does not set it, tokens can be forged.

**Safety design for the trial:** read-only DB user, report only, run on copies, the real run is a separate approved step that
writes only to the new DB plus one nullable column per app, repeatable, backups first.

---

## 12. Saving the plan as an artifact

**You:** Add this whole discussion in an artifact.

**Done:** published a private page, "CheerIT Identity Plan": https://claude.ai/artifact/YR4jNKegTPLKBUfoeZuoR4
(goal, current state, why logins do not carry over, SSO design, DB tables, per-app changes, data flow, special cases, Sponsor
review, safe trial run, decisions, next steps). I did not preview it visually. I listed three open items: confirm the Score vs
booking domain mapping, choose the trial-run data source, and confirm `AUTH_SECRET` in Sponsor prod.

---

## 13. "Yes do it, I am okay, continue" and the build

I created `cheerit-identity/` and built:
- `sql/001_identity_schema.sql` and `sql/apps/*.sql` (not run).
- `src/phone.ts`: E.164 normalizer, India default, rejects with a reason.
- `src/sources.ts`, `src/merge.ts`, `src/report.ts`, `src/db.ts`, `src/dry-run.ts`.
- 17 tests and invented demo fixtures.

**Bug caught by a test:** the order of a person's apps depended on the order rows were read, so two runs could differ. Fixed by
sorting apps and people deterministically.

I then explained next steps: try the demo, get data for a real dry run, check the two production items, contact the CheerIT-COM
developer.

---

## 14. "Can we migrate all users of all apps to the identity DB?"

**Answer:** yes, that is the goal. The reader, merge and report were ready, but the writer was not. Three pieces needed: the
writer, writing `identity_id` back into each app, and a verification check. Users with invalid or missing phones are listed and
left out; they keep working in their own app. Rollout: dry run on dev, real run on a dev copy, then production one app at a time
with a backup. Nothing changes for end users because no app reads `identity_id` until switched over.

---

## 15. "You can try on the dev domains"

**What I found:** every backend's `.env` points to `localhost:5433` with user `avenpc`; passwords were masked and never printed.
The listener on port 5433 is a Postgres process on your own Mac, not a tunnel, so I could not reach the dev servers
(devturfit, devgameit, and the others) from here. I used the local databases instead:
`cheeritadmin` (Score), `pickle` (booking), `predictit`, `turfit2` (TurfIT), `cheerit_sponsor`.

**Real dry-run result (read-only, nothing written):**
- 43 records read, 42 usable phones, **31 people**, 6 people in more than one app (one in all five).
- 3 name conflicts, 1 email conflict, 1 TurfIT phone with two roles, 2 non-Indian numbers accepted.
- 1 rejected phone: a Sponsor record with no phone at all.
- 2 Sponsor accounts have only a contact mobile, so they stay unverified.
- Score admins returned 0 rows.
- All six queries ran first time, so the column names matched the real tables.

---

## 16. "So what do you need?" and "OK"

I asked for a yes on stage 1: build the writer and verification, create a new empty local database `cheerit_identity`, write
the 31 people, touch no app database. You said OK.

**Built:** `src/collect.ts`, `src/apply.ts` (plan by default, `--apply` to write, `--verify-only`), `src/verify.ts`.
Guards: refuses a non-local host without `--allow-remote`, refuses to write into the same database it reads, fills blanks only
and never overwrites, wraps the write in a transaction.

**Run:**
- Created `cheerit_identity` on `localhost:5433` (it did not exist before).
- Plan: 43 records, 31 people, 42 memberships, 8 issues to log.
- **Apply:** 31 people and 42 memberships written. All six verification checks passed: every planned person exists, every
  usable app record is linked, none linked to the wrong person, memberships equal usable source records, no orphans, every phone
  valid E.164.
- **Second run:** 0 new people, 0 new memberships, so it is repeatable.
- **App databases unchanged:** no `identity` columns in any app's public tables. (A first check showed 8 per database; that
  was Postgres's own `information_schema` columns, and the corrected check showed 0.)

**People in several apps:** Kartik Poojary (booking, PredictIt, Score, Sponsor, TurfIT as Player and Owner), "tester"
(PredictIt, Score, Sponsor), ROHIT YADAV (Score, Sponsor), and kalpesh, Riya Rumde and Dinesh (booking and Score).

**Other local databases not read:** `cheerit`, `scoreit`, `sponsorit`, `sponsor_db`, `turfit_dev`, `turfit_preview`.

**Undo:** `DROP DATABASE cheerit_identity;`

---

## 17. Saving context

**You:** Save this in an md, because I want to continue on another device. Then: save this whole conversation in the
cheerit-identity folder.

**Done:** `HANDOFF.md` (short working notes and next steps) and this file, both in `cheerit-identity/`.

---

## Where things stand

- Stage 1 is complete locally. Stage 2 (add `identity_id` to the five app databases and write the links back) is **waiting for
  your approval**, and its writer is not built yet.
- Not started: running against the real dev servers, CheerIT-COM data, the production migration, and the SSO build.
- Open items: confirm the Score vs booking domain mapping, confirm `AUTH_SECRET` is set in Sponsor production, confirm the
  Identity domain names, and get the CheerIT-COM schema and export from its developer.
