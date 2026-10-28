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

## Not built yet

The real run that writes `cheerit_identity` and fills `identity_id` in each app, the identity API, and SSO.
