-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved (src/link.ts runs it).
-- CheerIT web API ("User", uuid user_id). Same statements as identity_link.sql in that repo for the User table.
-- A plain unique index: Postgres allows many NULLs under it, and Prisma can express it as @unique.
-- The index name is Prisma's default, so `prisma db push` keeps it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS identity_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "User_identity_id_key" ON "User" (identity_id);
-- Rollback: DROP INDEX IF EXISTS "User_identity_id_key"; ALTER TABLE "User" DROP COLUMN IF EXISTS identity_id;
