# cheerit-identity

Common users database for the CheerIT ecosystem. One person per phone number, with a record of
which apps they use. This folder holds the schema, the phone normalizer and a **read-only dry run**.
Nothing here writes to any app database.

## What is here

| Path | Purpose |
|---|---|
| `sql/001_identity_schema.sql` | Tables for the new `cheerit_identity` database: `users`, `user_apps`, `migration_runs`, `migration_log` |
| `sql/apps/*.sql` | The one `identity_id` column per app. **Not run.** Needs approval after the dry run |
| `src/phone.ts` | Phone normalizer to E.164, India by default. Rejects with a reason, never guesses |
| `src/sources.ts` | One read-only SELECT and mapper per app |
| `src/merge.ts` | Groups by phone. Most recently active app wins conflicts |
| `src/dry-run.ts` | Reads, merges, writes a report |
| `fixtures/demo/` | Invented data to try the report without any database |

## Try it with the demo data

```
npm install
npm test
npm run dry-run:demo
```

The report appears in `out/<timestamp>/`:

- `summary.md`: counts only, safe to share
- `report.json`: the same counts as data
- `issues.csv`: one line per problem record. **Contains phone numbers**, so `out/` is git-ignored

## Run it on real data

Copy `.env.example` to `.env`, fill in read-only connection strings for **dev data or a restored backup**,
load them into your shell, then `npm run dry-run`. A source with no connection string is skipped.

Safety, three layers: each query must be a single SELECT, it runs inside `BEGIN READ ONLY`, and it is
always rolled back. Use a database user that only has SELECT as well. The tool prints the host and
database it is reading (never the password) before it starts.

## Merge rules

- The phone number, normalized to E.164, is the identity.
- When apps disagree on name or email, the most recently active app wins. Activity is the last login
  or newest session where the app records it, otherwise the row's updated time. An app with an activity
  signal beats one without. An empty value never overrides a real one.
- Rejected phone numbers are listed, never merged.
- Sponsor: a mobile on the auth user counts as verified. A primary-contact mobile stays unverified.
  Made-up `@mobile.sponsor` emails are dropped.
- TurfIT: a PLAYER and an OWNER row with one phone become one person with two memberships.
- CheerIT-COM is not included yet. Its backend is separate.

## Identity service

A small HTTP API over the identity database. Only app backends call it, never browsers or mobile apps.

Put the connection string in a `.env` file in this folder (git-ignored), then from any shell:

```
# .env
IDENTITY_URL=postgresql://postgres:<password>@127.0.0.1:5432/cheeritidentity

npm start                        # http://127.0.0.1:4100
npm run issue-key -- score       # one key per app; reissuing revokes the old one
```

`HOST` defaults to `127.0.0.1`, so only backends on the same server can reach it. Every `/v1` call needs
`Authorization: Bearer <IDENTITY_API_KEY>`. The key decides which app is calling.

| Call | Use |
|---|---|
| `POST /v1/users/resolve` | After a successful OTP (signup or login). Body: `phone`, `appUserId` (required), `role`, `name`, `email`, `avatarUrl`, `gender`, `city`. Finds or creates the person and links your app row. Returns `201` for a new person, `200` otherwise, with `user.id` to store in your `identity_id` column |
| `GET /v1/users/:id` | A person and the apps they use |
| `GET /v1/users?phone=...` | Look a person up by phone |
| `GET /health` | No key needed |

Rules: profile fields only fill blanks, never overwrite. A user with `status: "blocked"` must be refused
by the app. `409 app_user_linked_elsewhere` means that app row is already linked to a different phone
(the user changed number); the login itself should carry on, and the link is fixed by hand. Each app sees
`appUserId` only for its own row.

```js
// In an app backend, right after OTP verification succeeds. Never block login if this call fails.
const res = await fetch(`${process.env.IDENTITY_SERVICE_URL}/v1/users/resolve`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.IDENTITY_API_KEY}` },
  body: JSON.stringify({ phone: user.phone, appUserId: user.id, name: user.name }),
});
if (res.ok) await saveIdentityId(user.id, (await res.json()).user.id);
```

Tests for the service need a throwaway database: `TEST_IDENTITY_URL=postgresql://.../cheeritidentity_test npm test`.
They empty every table in it.

## Not built yet

Calling the service from each app (step B), and SSO (step C).
