-- Schema do módulo de missões.
--
-- Tabelas:
--   quest_templates : definição estática (data-driven, versionada).
--   quest_instances : missões aceitas por conta.
--   quest_progress  : progresso por objetivo (FK para instance + objective_id).
--
-- Convenção: mesmo padrão de nomenclatura dos outros módulos (snake_case,
-- BIGSERIAL para PKs de transação, timestamptz para datas).

CREATE TABLE IF NOT EXISTS quest_templates (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  recommended_level INTEGER NOT NULL DEFAULT 1 CHECK (recommended_level >= 1),
  objectives        JSONB NOT NULL,
  reward            JSONB NOT NULL,
  repeatable        BOOLEAN NOT NULL DEFAULT FALSE,
  prerequisites     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quest_instances (
  id            BIGSERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL,
  template_id   TEXT NOT NULL REFERENCES quest_templates(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('available','accepted','in_progress','completed','failed','abandoned')),
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS quest_instances_account_idx ON quest_instances(account_id);
CREATE INDEX IF NOT EXISTS quest_instances_status_idx ON quest_instances(status);

CREATE TABLE IF NOT EXISTS quest_progress (
  instance_id   BIGINT NOT NULL REFERENCES quest_instances(id) ON DELETE CASCADE,
  objective_id  TEXT NOT NULL,
  current       INTEGER NOT NULL DEFAULT 0 CHECK (current >= 0),
  required      INTEGER NOT NULL CHECK (required > 0),
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instance_id, objective_id)
);

CREATE INDEX IF NOT EXISTS quest_progress_instance_idx ON quest_progress(instance_id);
