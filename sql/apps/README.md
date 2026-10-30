# Per-app column (NOT RUN, for later approval)

Each file adds one nullable identity column to an app's existing user table, with a unique index.
Nothing in any app reads the column until that app is switched over, so adding it changes no
behaviour. Dropping it returns the app to exactly how it was.

Do not run these by hand. `src/link.ts --apply` runs each one inside the same transaction that fills
the column, and only after the dry-run report has been reviewed and the real migration approved.

## Prisma: add the field in the same change

`prisma db push` removes columns and indexes that are not in the schema, so add these lines to each
app's `schema.prisma` before or together with the run. The index names in the SQL files are Prisma's
defaults, so Prisma sees them as already in place.

| App | Model | Line to add |
|---|---|---|
| CheerIT-Score | `User` (`si_user`) | `identityId String? @unique @map("si_user_identityid") @db.Uuid` |
| Booking platform | user model on `users` | `identityId String? @unique @map("identity_id") @db.Uuid` |
| PredictIt | `User` (`users`) | `identityId String? @unique @map("identity_id") @db.Uuid` |
| Sponsor | `SponsorAuthUser` (`sp_sponsor_auth_users`) | `identityId String? @unique @map("identity_id") @db.Uuid` |
| TurfIT | `User` | `identityId String? @db.Uuid` and `@@unique([identityId, role])` |
| CheerIT web API | `User` | `identity_id String? @unique @db.Uuid` |

The booking platform's schema was not on the Windows machine, so check its model name there.
