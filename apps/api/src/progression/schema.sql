-- Schema do módulo de progressão (XP + skill tree).
--
-- Tabelas:
--   account_xp    : XP total e level por conta (1:1).
--   account_skills : skills gastas (chave composta account+branch+node).
--
-- Mesma convenção de nomenclatura dos outros módulos: snake_case,
-- BIGINT para ids externos, TIMESTAMPTZ para datas.

CREATE TABLE IF NOT EXISTS account_xp (
  account_id BIGINT PRIMARY KEY,
  total_xp   BIGINT NOT NULL DEFAULT 0,
  level      INT    NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_skills (
  account_id BIGINT NOT NULL,
  branch     TEXT   NOT NULL,
  node       TEXT   NOT NULL,
  level      INT    NOT NULL DEFAULT 1,
  spent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, branch, node)
);

CREATE INDEX IF NOT EXISTS idx_account_skills_account ON account_skills(account_id);
