-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved.
-- CheerIT-Score (si_user, Int id)
ALTER TABLE si_user ADD COLUMN IF NOT EXISTS si_user_identityid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS si_user_identityid_key ON si_user (si_user_identityid) WHERE si_user_identityid IS NOT NULL;
-- Rollback: DROP INDEX IF EXISTS si_user_identityid_key; ALTER TABLE si_user DROP COLUMN IF EXISTS si_user_identityid;
