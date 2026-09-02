/**
 * Repositório de accounts no Postgres.
 *
 * Quando o pool não está disponível (dev sem DATABASE_URL),
 * as funções retornam null e o serviço lida com isso
 * retornando 503 ao cliente.
 */

import { getPool } from '../db/postgres.js';
import type { Account } from './types.js';

export class DbUnavailableError extends Error {
  constructor() {
    super('Database indisponível');
    this.name = 'DbUnavailableError';
  }
}

export async function findAccountByEmail(
  email: string,
): Promise<Account | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Account>(
    `SELECT id, username, email, password_hash AS "passwordHash", role,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM accounts WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return r.rows[0] ?? null;
}

export async function findAccountById(
  id: number,
): Promise<Account | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Account>(
    `SELECT id, username, email, password_hash AS "passwordHash", role,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM accounts WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function findAccountByUsername(
  username: string,
): Promise<Account | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Account>(
    `SELECT id, username, email, password_hash AS "passwordHash", role,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM accounts WHERE lower(username) = lower($1) LIMIT 1`,
    [username],
  );
  return r.rows[0] ?? null;
}

export async function createAccount(
  username: string,
  email: string,
  passwordHash: string,
): Promise<Account> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Account>(
    `INSERT INTO accounts (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, password_hash AS "passwordHash", role,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [username, email, passwordHash],
  );
  const row = r.rows[0];
  if (!row) throw new Error('Falha ao criar account: nenhum row retornado');
  return row;
}

/** Erro de violação de unique constraint (Postgres code 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
