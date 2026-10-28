-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved (src/link.ts runs it).
-- scoreit-sports-booking-match-platform (users, cuid id)
-- A plain unique index: Postgres allows many NULLs under it, and Prisma can express it as @unique.
-- The index name is Prisma's default, so `prisma db push` keeps it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS users_identity_id_key ON users (identity_id);
-- Rollback: DROP INDEX IF EXISTS users_identity_id_key; ALTER TABLE users DROP COLUMN IF EXISTS identity_id;
