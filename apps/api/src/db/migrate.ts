/**
 * Aplicador de schema e seeds.
 *
 * Os `schema.sql` de cada módulo existiam mas nada os executava — quem
 * subia a API tinha que rodar cada arquivo à mão, e a loja simplesmente
 * não tinha catálogo. Este runner aplica tudo na ordem de dependência a
 * cada boot.
 *
 * Todos os arquivos são idempotentes (`CREATE TABLE IF NOT EXISTS`,
 * `INSERT ... ON CONFLICT`), então rodar de novo é seguro. Cada arquivo
 * roda dentro de uma transação: se um falhar, ele não deixa metade
 * aplicada nem impede os outros de rodar.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './postgres.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

/**
 * Ordem importa: `accounts` (auth) é referenciado por chave estrangeira
 * de quase todo o resto, então vem primeiro. Os seeds vêm depois de
 * todos os schemas.
 */
const SCHEMAS = [
  'auth/schema.sql',
  'clans/schema.sql',
  'economy/schema.sql',
  'loadouts/schema.sql',
  'progression/schema.sql',
  'quests/schema.sql',
];

const SEEDS = ['economy/seed.sql'];

export interface MigrationResult {
  applied: string[];
  failed: Array<{ file: string; error: string }>;
  /** `false` quando não há DATABASE_URL — dev sem banco. */
  ran: boolean;
}

async function applyFile(relative: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('sem pool');
  const sql = await readFile(join(SRC, relative), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      // Se o próprio ROLLBACK falhar a conexão já está perdida; o
      // `finally` devolve ao pool e o erro original é o que importa.
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Aplica schemas e seeds. Nunca lança: devolve o que falhou para o
 * chamador logar. Um seed quebrado não pode impedir a API de subir e
 * responder health check.
 */
export async function runMigrations(): Promise<MigrationResult> {
  const result: MigrationResult = { applied: [], failed: [], ran: false };
  if (!getPool()) return result;
  result.ran = true;

  for (const file of [...SCHEMAS, ...SEEDS]) {
    try {
      await applyFile(file);
      result.applied.push(file);
    } catch (err) {
      result.failed.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
