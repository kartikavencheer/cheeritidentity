-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved.
-- CheerIT-Sponsor (sp_sponsor_auth_users, uuid id)
ALTER TABLE sp_sponsor_auth_users ADD COLUMN IF NOT EXISTS identity_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sp_sponsor_auth_users_identity_id_key ON sp_sponsor_auth_users (identity_id) WHERE identity_id IS NOT NULL;
-- Rollback: DROP INDEX IF EXISTS sp_sponsor_auth_users_identity_id_key; ALTER TABLE sp_sponsor_auth_users DROP COLUMN IF EXISTS identity_id;
