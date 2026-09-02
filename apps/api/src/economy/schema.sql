-- Schema Postgres para economia.

CREATE TABLE IF NOT EXISTS wallets (
  account_id      BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  gold            BIGINT NOT NULL DEFAULT 0 CHECK (gold >= 0),
  credits         BIGINT NOT NULL DEFAULT 0 CHECK (credits >= 0),
  dark_matter     BIGINT NOT NULL DEFAULT 0 CHECK (dark_matter >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ledger append-only: toda movimentação registra uma linha.
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGSERIAL PRIMARY KEY,
  from_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id   BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  currency        TEXT NOT NULL CHECK (currency IN ('gold', 'credits', 'dark_matter')),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  reason          TEXT NOT NULL,
  ref_type        TEXT,
  ref_id          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_from_idx ON transactions (from_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_to_idx ON transactions (to_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS items (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  -- 'ship' e 'skill' entraram para a loja poder vender naves inteiras e
  -- habilidades ativas, não só peças e recursos.
  kind            TEXT NOT NULL CHECK (kind IN ('mod_part', 'consumable', 'rare', 'resource', 'ship', 'skill')),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  base_price      BIGINT NOT NULL CHECK (base_price >= 0),
  currency        TEXT NOT NULL DEFAULT 'credits' CHECK (currency IN ('gold', 'credits', 'dark_matter')),
  stackable       BOOLEAN NOT NULL DEFAULT TRUE,
  -- O que o item concede ao ser comprado. Para 'mod_part' guarda o
  -- `templateId` do catálogo do estaleiro; para 'skill', o id da skill
  -- ativa; para 'ship', o chassi e os slots iniciais. Fica em JSONB para
  -- que um item novo não exija migração de coluna.
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Migração idempotente para bancos criados antes destas colunas.
ALTER TABLE items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  ALTER TABLE items DROP CONSTRAINT IF EXISTS items_kind_check;
  ALTER TABLE items ADD CONSTRAINT items_kind_check
    CHECK (kind IN ('mod_part', 'consumable', 'rare', 'resource', 'ship', 'skill'));
END $$;

CREATE INDEX IF NOT EXISTS items_kind_idx ON items (kind);

CREATE TABLE IF NOT EXISTS shop_items (
  item_id         BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  price_mult      DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (price_mult > 0),
  stock           BIGINT  -- NULL = infinito
);

CREATE TABLE IF NOT EXISTS inventory (
  account_id      BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id         BIGINT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity        BIGINT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (account_id, item_id)
);

CREATE INDEX IF NOT EXISTS inventory_account_idx ON inventory (account_id);
