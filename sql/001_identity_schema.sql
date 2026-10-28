-- Common users database for the CheerIT ecosystem.
-- Run against a NEW, separate database (for example cheerit_identity), never against an app database.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164, for example +919876543210. The phone number is the person's primary identity.
  phone             text        NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  name              text,
  -- Not unique: two apps can hold the same email for different phones.
  email             text,
  avatar_url        text,
  gender            text,
  city              text,
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  first_app         text,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;

-- Which apps each person uses, and which row in that app's own user table is theirs.
CREATE TABLE IF NOT EXISTS user_apps (
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app_key       text        NOT NULL CHECK (app_key IN ('score', 'booking', 'predictit', 'turfit', 'sponsor', 'com')),
  -- The id in that app's table, stored as text because the apps use Int, cuid and uuid.
  app_user_id   text        NOT NULL,
  -- TurfIT: PLAYER, OWNER or ADMIN. Sponsor: sponsor. Empty where the app has no roles.
  app_role      text        NOT NULL DEFAULT '',
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  PRIMARY KEY (app_key, app_user_id)
);

CREATE INDEX IF NOT EXISTS user_apps_user_idx ON user_apps (user_id);

-- One row per migration run, so a run can be reviewed, repeated and compared.
CREATE TABLE IF NOT EXISTS migration_runs (
  run_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mode        text        NOT NULL CHECK (mode IN ('dry-run', 'apply')),
  summary     jsonb
);

-- Every merge decision and every skipped record, with the reason.
CREATE TABLE IF NOT EXISTS migration_log (
  id         bigserial   PRIMARY KEY,
  run_id     uuid        REFERENCES migration_runs (run_id) ON DELETE CASCADE,
  user_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
  app_key    text,
  action     text        NOT NULL,
  phone      text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_log_run_idx ON migration_log (run_id);
