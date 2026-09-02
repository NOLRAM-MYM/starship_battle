-- Schema Postgres para clãs.

CREATE TABLE IF NOT EXISTS clans (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  tag             TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  leader_id       BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clans_tag_lower_idx ON clans (lower(tag));
CREATE INDEX IF NOT EXISTS clans_name_lower_idx ON clans (lower(name));

CREATE TABLE IF NOT EXISTS clan_members (
  clan_id         BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  account_id      BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clan_id, account_id)
);

CREATE INDEX IF NOT EXISTS clan_members_account_idx ON clan_members (account_id);

CREATE TABLE IF NOT EXISTS clan_invites (
  id              BIGSERIAL PRIMARY KEY,
  clan_id         BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  account_id      BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invited_by      BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  UNIQUE (clan_id, account_id)
);

CREATE INDEX IF NOT EXISTS clan_invites_account_idx ON clan_invites (account_id);
