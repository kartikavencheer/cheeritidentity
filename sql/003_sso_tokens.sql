-- One-time sign-in tokens for single sign-on between apps. The token itself is never stored, only its SHA-256.
-- A token is issued by one app's backend for one person and one target app, lives 60 seconds and can be redeemed once.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS sso_tokens (
  token_hash text        PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_app   text        NOT NULL,
  to_app     text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sso_tokens_expires_idx ON sso_tokens (expires_at);
