-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved.
-- turfitweb ("User", cuid id). One person can have a PLAYER row and an OWNER row, so
-- uniqueness is (identity_id, role), not identity_id alone.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "identityId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS user_identity_role_key ON "User" ("identityId", role) WHERE "identityId" IS NOT NULL;
-- Rollback: DROP INDEX IF EXISTS user_identity_role_key; ALTER TABLE "User" DROP COLUMN IF EXISTS "identityId";
