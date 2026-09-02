/**
 * Repositório de missões.
 *
 * Operações usam transações ACID do Postgres para garantir consistência
 * entre `quest_instances` e `quest_progress` ao aceitar/completar.
 */

import { getPool } from '../db/postgres.js';
import type {
  ObjectiveProgress,
  ObjectiveTemplate,
  ProgressEvent,
  QuestInstance,
  QuestReward,
  QuestStatus,
  QuestTemplate,
} from './types.js';

export class DbUnavailableError extends Error {
  constructor() {
    super('Database indisponível');
    this.name = 'DbUnavailableError';
  }
}

// ---------- Templates ----------

function parseObjectives(raw: unknown): ObjectiveTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw as ObjectiveTemplate[];
}

function parseReward(raw: unknown): QuestReward {
  if (raw && typeof raw === 'object') return raw as QuestReward;
  return {};
}

export async function upsertTemplate(t: QuestTemplate): Promise<void> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  await pool.query(
    `INSERT INTO quest_templates
       (id, title, description, recommended_level, objectives, reward, repeatable, prerequisites)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           description = EXCLUDED.description,
           recommended_level = EXCLUDED.recommended_level,
           objectives = EXCLUDED.objectives,
           reward = EXCLUDED.reward,
           repeatable = EXCLUDED.repeatable,
           prerequisites = EXCLUDED.prerequisites`,
    [
      t.id,
      t.title,
      t.description,
      t.recommendedLevel,
      JSON.stringify(t.objectives),
      JSON.stringify(t.reward),
      t.repeatable,
      JSON.stringify(t.prerequisites),
    ],
  );
}

export async function findTemplate(id: string): Promise<QuestTemplate | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<{
    id: string;
    title: string;
    description: string;
    recommended_level: string;
    objectives: unknown;
    reward: unknown;
    repeatable: boolean;
    prerequisites: unknown;
  }>(
    `SELECT id, title, description, recommended_level, objectives, reward, repeatable, prerequisites
     FROM quest_templates WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    recommendedLevel: Number.parseInt(row.recommended_level, 10),
    objectives: parseObjectives(row.objectives),
    reward: parseReward(row.reward),
    repeatable: row.repeatable,
    prerequisites: Array.isArray(row.prerequisites) ? (row.prerequisites as string[]) : [],
  };
}

export async function listTemplates(): Promise<QuestTemplate[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<{
    id: string;
    title: string;
    description: string;
    recommended_level: string;
    objectives: unknown;
    reward: unknown;
    repeatable: boolean;
    prerequisites: unknown;
  }>(
    `SELECT id, title, description, recommended_level, objectives, reward, repeatable, prerequisites
     FROM quest_templates ORDER BY recommended_level, id`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    recommendedLevel: Number.parseInt(row.recommended_level, 10),
    objectives: parseObjectives(row.objectives),
    reward: parseReward(row.reward),
    repeatable: row.repeatable,
    prerequisites: Array.isArray(row.prerequisites) ? (row.prerequisites as string[]) : [],
  }));
}

// ---------- Instances ----------

export class QuestNotFoundError extends Error {
  constructor(public readonly code: 'template_not_found' | 'instance_not_found', message: string) {
    super(message);
    this.name = 'QuestNotFoundError';
  }
}

export class QuestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestConflictError';
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStateError';
  }
}

/** Aceita um template de missão por uma conta. Retorna a nova instância. */
export async function acceptQuest(
  accountId: number,
  templateId: string,
): Promise<QuestInstance> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();

  const tpl = await findTemplate(templateId);
  if (!tpl) throw new QuestNotFoundError('template_not_found', 'template inexistente');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verifica pré-requisitos.
    if (tpl.prerequisites.length > 0) {
      const r = await client.query<{ template_id: string }>(
        `SELECT template_id FROM quest_instances
         WHERE account_id = $1 AND template_id = ANY($2) AND status = 'completed'`,
        [accountId, tpl.prerequisites],
      );
      const have = new Set(r.rows.map((x) => x.template_id));
      for (const req of tpl.prerequisites) {
        if (!have.has(req)) {
          await client.query('ROLLBACK');
          throw new InvalidStateError(`pré-requisito não satisfeito: ${req}`);
        }
      }
    }
    // Verifica duplicação (se não-repetível).
    if (!tpl.repeatable) {
      const dup = await client.query(
        `SELECT 1 FROM quest_instances WHERE account_id = $1 AND template_id = $2 LIMIT 1`,
        [accountId, templateId],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        await client.query('ROLLBACK');
        throw new QuestConflictError('missão já aceita');
      }
    }
    // Cria instância.
    const inst = await client.query<{
      id: string;
      account_id: string;
      template_id: string;
      status: string;
      accepted_at: Date;
      completed_at: Date | null;
    }>(
      `INSERT INTO quest_instances (account_id, template_id, status)
       VALUES ($1, $2, 'accepted')
       RETURNING id, account_id, template_id, status, accepted_at, completed_at`,
      [accountId, templateId],
    );
    const instRow = inst.rows[0]!;
    const instanceId = Number.parseInt(instRow.id, 10);
    // Cria linhas de progresso (uma por objetivo).
    for (const obj of tpl.objectives) {
      await client.query(
        `INSERT INTO quest_progress (instance_id, objective_id, current, required, completed)
         VALUES ($1, $2, 0, $3, FALSE)`,
        [instanceId, obj.id, obj.count],
      );
    }
    await client.query('COMMIT');
    return {
      id: instanceId,
      accountId: Number.parseInt(instRow.account_id, 10),
      templateId: instRow.template_id,
      status: instRow.status as QuestStatus,
      progress: tpl.objectives.map((o) => ({
        objectiveId: o.id,
        current: 0,
        required: o.count,
        completed: false,
      })),
      acceptedAt: instRow.accepted_at,
      completedAt: instRow.completed_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Lê uma instância com seu progresso. */
export async function getInstance(instanceId: number): Promise<QuestInstance | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const inst = await pool.query<{
    id: string;
    account_id: string;
    template_id: string;
    status: string;
    accepted_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT id, account_id, template_id, status, accepted_at, completed_at
     FROM quest_instances WHERE id = $1 LIMIT 1`,
    [instanceId],
  );
  const row = inst.rows[0];
  if (!row) return null;
  const prog = await pool.query<{
    objective_id: string;
    current: string;
    required: string;
    completed: boolean;
  }>(
    `SELECT objective_id, current, required, completed
     FROM quest_progress WHERE instance_id = $1`,
    [instanceId],
  );
  return {
    id: Number.parseInt(row.id, 10),
    accountId: Number.parseInt(row.account_id, 10),
    templateId: row.template_id,
    status: row.status as QuestStatus,
    progress: prog.rows.map((p) => ({
      objectiveId: p.objective_id,
      current: Number.parseInt(p.current, 10),
      required: Number.parseInt(p.required, 10),
      completed: p.completed,
    })),
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
  };
}

export async function listInstancesForAccount(
  accountId: number,
  status?: QuestStatus,
): Promise<QuestInstance[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const params: unknown[] = [accountId];
  let where = `account_id = $1`;
  if (status) {
    params.push(status);
    where += ` AND status = $2`;
  }
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM quest_instances WHERE ${where} ORDER BY id DESC LIMIT 100`,
    params,
  );
  const out: QuestInstance[] = [];
  for (const row of r.rows) {
    const inst = await getInstance(Number.parseInt(row.id, 10));
    if (inst) out.push(inst);
  }
  return out;
}

/**
 * Aplica um evento de progresso a uma instância.
 * Promove status in_progress e completed quando aplicável.
 */
export async function applyProgress(event: ProgressEvent): Promise<QuestInstance> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  if (event.amount <= 0) {
    throw new Error('amount deve ser > 0');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock da instance para serializar updates.
    const inst = await client.query<{
      id: string;
      account_id: string;
      template_id: string;
      status: string;
    }>(
      `SELECT id, account_id, template_id, status
       FROM quest_instances
       WHERE account_id = $1 AND template_id = $2
         AND status IN ('accepted','in_progress')
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`,
      [event.accountId, event.templateId],
    );
    if (inst.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new QuestNotFoundError('instance_not_found', 'nenhuma instância ativa');
    }
    const instanceId = Number.parseInt(inst.rows[0]!.id, 10);

    // Atualiza progresso.
    const upd = await client.query<{ current: string; required: string }>(
      `UPDATE quest_progress
       SET current = LEAST(current + $1, required),
           completed = (current + $1) >= required,
           updated_at = NOW()
       WHERE instance_id = $2 AND objective_id = $3
       RETURNING current, required`,
      [event.amount, instanceId, event.objectiveId],
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new QuestNotFoundError('instance_not_found', 'objetivo não existe na instância');
    }

    // Promove para in_progress se ainda 'accepted'.
    if (inst.rows[0]!.status === 'accepted') {
      await client.query(
        `UPDATE quest_instances SET status = 'in_progress' WHERE id = $1`,
        [instanceId],
      );
    }
    // Verifica conclusão: todos os objetivos completed.
    const allDone = await client.query<{ c: string }>(
      `SELECT COUNT(*) FILTER (WHERE NOT completed) AS c FROM quest_progress WHERE instance_id = $1`,
      [instanceId],
    );
    const pending = Number.parseInt(allDone.rows[0]?.c ?? '0', 10);
    if (pending === 0) {
      await client.query(
        `UPDATE quest_instances SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [instanceId],
      );
    }
    await client.query('COMMIT');
    const result = await getInstance(instanceId);
    if (!result) throw new Error('Falha ao recarregar instância');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Abandona uma missão aceita. */
export async function abandonQuest(accountId: number, instanceId: number): Promise<void> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query(
    `UPDATE quest_instances SET status = 'abandoned'
     WHERE id = $1 AND account_id = $2 AND status IN ('accepted','in_progress')`,
    [instanceId, accountId],
  );
  if (r.rowCount === 0) {
    throw new InvalidStateError('não é possível abandonar esta missão');
  }
}
