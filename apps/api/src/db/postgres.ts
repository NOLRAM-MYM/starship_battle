/**
 * Pool de conexões Postgres. Singleton inicializado lazy.
 * Em dev/test, se DATABASE_URL não estiver setada, fica inativo.
 */

import pg from 'pg';
import { loadConfig } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  if (pool) return pool;
  const url = loadConfig().databaseUrl;
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function pingDatabase(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try {
    const r = await p.query('SELECT 1 AS ok');
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
