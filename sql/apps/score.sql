-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved (src/link.ts runs it).
-- CheerIT-Score (si_user, Int id)
-- A plain unique index: Postgres allows many NULLs under it, and Prisma can express it as @unique.
-- The index name is Prisma's default, so `prisma db push` keeps it.
ALTER TABLE si_user ADD COLUMN IF NOT EXISTS si_user_identityid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS si_user_si_user_identityid_key ON si_user (si_user_identityid);
-- Rollback: DROP INDEX IF EXISTS si_user_si_user_identityid_key; ALTER TABLE si_user DROP COLUMN IF EXISTS si_user_identityid;
