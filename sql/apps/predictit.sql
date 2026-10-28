-- NOT RUN. Additive and reversible. Run only after the dry-run report is approved.
-- predictitapp (users, uuid id)
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS users_identity_id_key ON users (identity_id) WHERE identity_id IS NOT NULL;
-- Rollback: DROP INDEX IF EXISTS users_identity_id_key; ALTER TABLE users DROP COLUMN IF EXISTS identity_id;
