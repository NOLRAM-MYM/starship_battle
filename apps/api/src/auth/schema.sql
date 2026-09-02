-- Schema Postgres para accounts.
-- Aplicado por `pnpm migrate` (Task 3.2.x — script de migração).

CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- 'gm' = Game Master: acesso às rotas /gm/* (controle do jogo).
  -- 'player' = conta normal. Toda conta nasce player; promover é ato
  -- explícito de outro GM ou do script de provisionamento.
  role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'gm')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migração idempotente para bancos criados antes da coluna existir.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';
DO $$
BEGIN
  ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check;
  ALTER TABLE accounts ADD CONSTRAINT accounts_role_check
    CHECK (role IN ('player', 'gm'));
END $$;

CREATE INDEX IF NOT EXISTS accounts_email_idx ON accounts (lower(email));
CREATE INDEX IF NOT EXISTS accounts_username_idx ON accounts (lower(username));
-- Poucos GMs entre muitos jogadores: índice parcial mantém a listagem barata.
CREATE INDEX IF NOT EXISTS accounts_gm_idx ON accounts (id) WHERE role = 'gm';
