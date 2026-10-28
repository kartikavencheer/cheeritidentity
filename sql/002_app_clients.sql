-- API keys for the identity service. One active key per app backend; the key itself is never stored,
-- only its SHA-256. Safe to run more than once.

CREATE TABLE IF NOT EXISTS app_clients (
  id         bigserial   PRIMARY KEY,
  app_key    text        NOT NULL CHECK (app_key IN ('score', 'booking', 'predictit', 'turfit', 'sponsor', 'com')),
  key_hash   text        NOT NULL UNIQUE,
  -- First characters of the key, so a leaked key can be recognized in logs without storing it.
  key_prefix text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_clients_one_active_key ON app_clients (app_key) WHERE revoked_at IS NULL;
