/**
 * Provisionamento das contas de operação: Game Master + jogador de teste.
 *
 * Rodar com:
 *   pnpm --filter @batle/api provision
 *   node --import tsx --env-file=.env src/gm/provision.ts
 *
 * Idempotente: rodar de novo não duplica conta nem troca a senha de uma
 * conta que já existe (só garante o papel). Para forçar uma senha nova,
 * passe `GM_PASSWORD` / `PLAYER_PASSWORD` no ambiente.
 *
 * As senhas são geradas com `crypto.randomBytes` e impressas UMA vez.
 * Não ficam em arquivo nem no repositório — se você perder, rode com
 * `GM_PASSWORD=...` para definir outra.
 */

import { randomBytes } from 'node:crypto';
import { getPool, closePool } from '../db/postgres.js';
import { hashPassword } from '../auth/passwords.js';
import { runMigrations } from '../db/migrate.js';
import type { AccountRole } from '../auth/types.js';

/** Senha aleatória legível: 24 chars base64url, ~144 bits de entropia. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

interface ProvisionSpec {
  username: string;
  email: string;
  role: AccountRole;
  /** Senha explícita via env; ausente = gerar. */
  password: string | undefined;
  /** Saldo inicial por moeda (só aplicado na criação). */
  credits: number;
  gold: number;
  darkMatter: number;
}

export interface ProvisionedAccount {
  id: number;
  username: string;
  email: string;
  role: AccountRole;
  /** Presente só quando a conta foi criada agora. */
  password?: string;
  created: boolean;
}

/**
 * Cria a conta se não existir; se existir, apenas garante o papel.
 * Nunca sobrescreve senha de conta existente — isso trancaria alguém
 * fora sem aviso.
 */
async function provision(spec: ProvisionSpec): Promise<ProvisionedAccount> {
  const pool = getPool();
  if (!pool) throw new Error('DATABASE_URL ausente: não há banco para provisionar');

  const existing = await pool.query<{ id: string; role: string }>(
    `SELECT id, role FROM accounts WHERE lower(email) = lower($1) OR lower(username) = lower($2) LIMIT 1`,
    [spec.email, spec.username],
  );

  if (existing.rowCount && existing.rows[0]) {
    const id = Number.parseInt(existing.rows[0].id, 10);
    if (existing.rows[0].role !== spec.role) {
      await pool.query(`UPDATE accounts SET role = $1, updated_at = NOW() WHERE id = $2`, [
        spec.role,
        id,
      ]);
    }
    return {
      id,
      username: spec.username,
      email: spec.email,
      role: spec.role,
      created: false,
    };
  }

  const password = spec.password ?? generatePassword();
  const hash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: string }>(
      `INSERT INTO accounts (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [spec.username, spec.email, hash, spec.role],
    );
    const id = Number.parseInt(r.rows[0]!.id, 10);

    await client.query(
      `INSERT INTO wallets (account_id, credits, gold, dark_matter)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE
         SET credits = EXCLUDED.credits,
             gold = EXCLUDED.gold,
             dark_matter = EXCLUDED.dark_matter`,
      [id, spec.credits, spec.gold, spec.darkMatter],
    );
    // Saldo inicial também entra no ledger: nenhuma moeda aparece no
    // shard sem uma linha explicando de onde veio.
    for (const [moeda, valor] of [
      ['credits', spec.credits],
      ['gold', spec.gold],
      ['dark_matter', spec.darkMatter],
    ] as const) {
      if (valor > 0) {
        await client.query(
          `INSERT INTO transactions (from_account_id, to_account_id, currency, amount, reason, ref_type, ref_id)
           VALUES (NULL, $1, $2, $3, 'provision', 'bootstrap', $4)`,
          [id, moeda, valor, spec.username],
        );
      }
    }
    await client.query('COMMIT');
    return {
      id,
      username: spec.username,
      email: spec.email,
      role: spec.role,
      password,
      created: true,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function provisionOperationalAccounts(): Promise<ProvisionedAccount[]> {
  const specs: ProvisionSpec[] = [
    {
      username: process.env.GM_USERNAME ?? 'gamemaster',
      email: process.env.GM_EMAIL ?? 'gm@batle.local',
      role: 'gm',
      password: process.env.GM_PASSWORD,
      // GM não precisa de saldo: ele credita quem quiser via /gm/grant.
      credits: 0,
      gold: 0,
      darkMatter: 0,
    },
    {
      username: process.env.PLAYER_USERNAME ?? 'piloto_teste',
      email: process.env.PLAYER_EMAIL ?? 'piloto@batle.local',
      role: 'player',
      password: process.env.PLAYER_PASSWORD,
      // Saldo de TESTE, folgado de propósito.
      //
      // O catálogo inteiro custa ~93.6k em créditos e ~22.8k em matéria
      // escura; 999.999 de cada deixa comprar tudo várias vezes sem a
      // economia atrapalhar quem está testando. Não é saldo de jogador
      // real — para isso existe `PLAYER_CREDITS` no ambiente.
      credits: Number.parseInt(process.env.PLAYER_CREDITS ?? '999999', 10) || 999999,
      gold: Number.parseInt(process.env.PLAYER_GOLD ?? '999999', 10) || 999999,
      darkMatter: Number.parseInt(process.env.PLAYER_DARK_MATTER ?? '999999', 10) || 999999,
    },
  ];

  const out: ProvisionedAccount[] = [];
  for (const spec of specs) out.push(await provision(spec));
  return out;
}

// Execução direta pela CLI.
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /provision\.ts$/.test(process.argv[1]);

if (isMain) {
  const migrations = await runMigrations();
  if (!migrations.ran) {
    console.error('DATABASE_URL ausente — configure o .env antes de provisionar.');
    process.exit(1);
  }
  for (const f of migrations.failed) {
    console.error(`migração falhou: ${f.file}: ${f.error}`);
  }

  const accounts = await provisionOperationalAccounts();

  console.log('\n=== contas de operação ===\n');
  for (const a of accounts) {
    const tag = a.role === 'gm' ? 'GAME MASTER' : 'JOGADOR DE TESTE';
    console.log(`${tag}`);
    console.log(`  id       : ${a.id}`);
    console.log(`  usuário  : ${a.username}`);
    console.log(`  e-mail   : ${a.email}`);
    if (a.created) {
      console.log(`  senha    : ${a.password}   <-- anote agora, não é exibida de novo`);
    } else {
      console.log('  senha    : (conta já existia — senha inalterada)');
    }
    if (a.role === 'player') {
      console.log('  saldo    : 999.999 de cada moeda (conta de teste)');
    }
    console.log('');
  }
  console.log('Para definir senhas próprias, rode com GM_PASSWORD=... PLAYER_PASSWORD=...\n');

  await closePool();
}
