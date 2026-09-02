/**
 * Repositório de progressão (XP + skills) no Postgres.
 *
 * Operações:
 *  - getProgression : leitura agregada de xp + skills.
 *  - addXp          : UPSERT atômico de xp + recálculo de level.
 *  - spendSkill     : UPSERT em account_skills (level+1) com
 *                     checagem de pontos disponíveis.
 *
 * Mesmo padrão dos outros módulos: `getPool()` retorna `null`
 * quando o DATABASE_URL não está setado; nesse caso os helpers
 * lançam `DbUnavailableError` (HTTP 503 via `wrap`).
 */

import { getPool } from '../db/postgres.js';
import {
  isValidBranch,
  levelFromXp,
  maxSpendablePoints,
  xpNextFor,
  type AccountProgression,
} from './types.js';

export class DbUnavailableError extends Error {
  constructor() {
    super('Database indisponível');
    this.name = 'DbUnavailableError';
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export class NotEnoughPointsError extends Error {
  constructor() {
    super('Sem pontos disponíveis');
    this.name = 'NotEnoughPointsError';
  }
}

interface AccountXpRow {
  total_xp: string;
  level: string;
}

interface AccountSkillRow {
  branch: string;
  node: string;
  level: string;
}

export async function getProgression(accountId: number): Promise<AccountProgression> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const xpRow = await pool.query<AccountXpRow>(
    `SELECT total_xp, level FROM account_xp WHERE account_id = $1`,
    [accountId],
  );
  const skillRows = await pool.query<AccountSkillRow>(
    `SELECT branch, node, level
     FROM account_skills
     WHERE account_id = $1
     ORDER BY branch, node`,
    [accountId],
  );
  const totalXp = xpRow.rows[0] ? Number.parseInt(xpRow.rows[0].total_xp, 10) : 0;
  const level = xpRow.rows[0] ? Number.parseInt(xpRow.rows[0].level, 10) : 1;
  const skills = skillRows.rows.map((r) => ({
    branch: r.branch,
    node: r.node,
    level: Number.parseInt(r.level, 10),
  }));
  const spentPoints = skills.length;
  const available = Math.max(0, maxSpendablePoints(level) - spentPoints);
  return {
    accountId,
    totalXp,
    level,
    spentPoints,
    availablePoints: available,
    skills,
  };
}

export interface AddXpResult {
  totalXp: number;
  level: number;
  leveledUp: boolean;
}

export async function addXp(accountId: number, amount: number): Promise<AddXpResult> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidInputError('amount deve ser inteiro > 0');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // UPSERT atômico: soma XP sem race entre SELECT e UPDATE.
    const r = await client.query<{ total_xp: string }>(
      `INSERT INTO account_xp (account_id, total_xp, level)
       VALUES ($1, $2, 1)
       ON CONFLICT (account_id) DO UPDATE
         SET total_xp = account_xp.total_xp + EXCLUDED.total_xp,
             updated_at = NOW()
       RETURNING total_xp`,
      [accountId, amount],
    );
    const totalXp = Number.parseInt(r.rows[0]?.total_xp ?? '0', 10);
    const newLevel = levelFromXp(totalXp);
    const prev = await client.query<{ level: string }>(
      `SELECT level FROM account_xp WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    const prevLevel = prev.rows[0] ? Number.parseInt(prev.rows[0].level, 10) : 1;
    if (newLevel !== prevLevel) {
      await client.query(
        `UPDATE account_xp SET level = $1, updated_at = NOW() WHERE account_id = $2`,
        [newLevel, accountId],
      );
    }
    await client.query('COMMIT');
    return {
      totalXp,
      level: newLevel,
      leveledUp: newLevel > prevLevel,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function spendSkill(
  accountId: number,
  branch: string,
  node: string,
): Promise<void> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  if (!isValidBranch(branch)) {
    throw new InvalidInputError(`branch inválido: ${branch}`);
  }
  if (typeof node !== 'string' || node.length === 0 || node.length > 80) {
    throw new InvalidInputError('node inválido');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock da linha de xp para checar pontos disponíveis atomicamente.
    const xpRow = await client.query<{ level: string }>(
      `SELECT level FROM account_xp WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    if (xpRow.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new NotEnoughPointsError();
    }
    const level = Number.parseInt(xpRow.rows[0]!.level, 10);
    const existing = await client.query<{ level: string }>(
      `SELECT level FROM account_skills
       WHERE account_id = $1 AND branch = $2 AND node = $3 FOR UPDATE`,
      [accountId, branch, node],
    );
    const spent = await client.query<{ c: string }>(
      `SELECT COUNT(*) AS c FROM account_skills WHERE account_id = $1`,
      [accountId],
    );
    const spentCount = Number.parseInt(spent.rows[0]?.c ?? '0', 10);
    const available = maxSpendablePoints(level) - spentCount;
    if (available < 1) {
      await client.query('ROLLBACK');
      throw new NotEnoughPointsError();
    }
    const newSkillLevel =
      existing.rowCount && existing.rowCount > 0
        ? Number.parseInt(existing.rows[0]!.level, 10) + 1
        : 1;
    await client.query(
      `INSERT INTO account_skills (account_id, branch, node, level, spent_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (account_id, branch, node) DO UPDATE
         SET level = account_skills.level + 1, spent_at = NOW()`,
      [accountId, branch, node, newSkillLevel],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Helper exportado para uso em testes (curva). */
export const _xpCurve = { xpNextFor, levelFromXp, maxSpendablePoints };
