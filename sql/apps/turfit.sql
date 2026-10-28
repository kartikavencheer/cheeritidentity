-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved (src/link.ts runs it).
-- turfitweb ("User", cuid id). One person can have a PLAYER row and an OWNER row, so
-- uniqueness is (identityId, role), not identityId alone. Rows with a NULL identityId never clash.
-- The index name is Prisma's default for @@unique([identityId, role]), so `prisma db push` keeps it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "identityId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "User_identityId_role_key" ON "User" ("identityId", role);
-- Rollback: DROP INDEX IF EXISTS "User_identityId_role_key"; ALTER TABLE "User" DROP COLUMN IF EXISTS "identityId";
