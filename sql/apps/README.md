# Per-app column (NOT RUN, for later approval)

Each file adds one nullable `identity_id` column to an app's existing user table.
Nothing in any app reads the column until that app is switched over, so adding it
changes no behaviour. Dropping it returns the app to exactly how it was.

Do not run these yet. They run only after the dry-run report has been reviewed and
you have approved the real migration.

Prisma note: add the same field to that app's `schema.prisma` at the same time.
`prisma db push` removes columns that are not in the schema, so a column added only
in SQL can be dropped by the next push.
