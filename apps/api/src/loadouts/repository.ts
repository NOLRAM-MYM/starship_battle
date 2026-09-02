/**
 * Repositório de loadouts no Postgres.
 */

import { getPool } from '../db/postgres.js';
import type { Loadout } from './types.js';

export class DbUnavailableError extends Error {
  constructor() {
    super('Database indisponível');
    this.name = 'DbUnavailableError';
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

export async function createLoadout(
  accountId: number,
  name: string,
  data: Record<string, any>
): Promise<Loadout> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();

  const r = await pool.query<Loadout>(
    `INSERT INTO loadouts (account_id, name, data)
     VALUES ($1, $2, $3)
     RETURNING id,
               account_id AS "accountId",
               name,
               data,
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [accountId, name, JSON.stringify(data)]
  );

  const row = r.rows[0];
  if (!row) throw new Error('Falha ao criar loadout');
  return row;
}

export async function findLoadoutById(id: number): Promise<Loadout | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();

  const r = await pool.query<Loadout>(
    `SELECT id,
            account_id AS "accountId",
            name,
            data,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM loadouts WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function listLoadoutsForAccount(accountId: number): Promise<Loadout[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();

  const r = await pool.query<Loadout>(
    `SELECT id,
            account_id AS "accountId",
            name,
            data,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM loadouts
     WHERE account_id = $1
     ORDER BY created_at DESC`,
    [accountId]
  );
  return r.rows;
}

export async function updateLoadout(
  id: number,
  fields: { name?: string; data?: Record<string, any> }
): Promise<Loadout | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (typeof fields.name === 'string') {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.data !== undefined) {
    sets.push(`data = $${i++}`);
    params.push(JSON.stringify(fields.data));
  }

  if (sets.length === 0) return findLoadoutById(id);

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const r = await pool.query<Loadout>(
    `UPDATE loadouts SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING id,
               account_id AS "accountId",
               name,
               data,
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    params
  );
  return r.rows[0] ?? null;
}

export async function deleteLoadout(id: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();

  const r = await pool.query(`DELETE FROM loadouts WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
