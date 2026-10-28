-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved (src/link.ts runs it).
-- CheerIT-Sponsor (sp_sponsor_auth_users, uuid id)
-- A plain unique index: Postgres allows many NULLs under it, and Prisma can express it as @unique.
-- The index name is Prisma's default, so `prisma db push` keeps it.
ALTER TABLE sp_sponsor_auth_users ADD COLUMN IF NOT EXISTS identity_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sp_sponsor_auth_users_identity_id_key ON sp_sponsor_auth_users (identity_id);
-- Rollback: DROP INDEX IF EXISTS sp_sponsor_auth_users_identity_id_key; ALTER TABLE sp_sponsor_auth_users DROP COLUMN IF EXISTS identity_id;
