/**
 * Rotas de Game Master (`/gm/*`).
 *
 * Tudo aqui exige `role = 'gm'` no token. O guard é fail-closed: sem
 * token, com token inválido ou com papel `player`, responde 403 e não
 * toca no banco.
 *
 * O escopo é "controle do jogo": contas, papéis, economia e progressão.
 * Toda concessão de moeda passa pelo mesmo ledger append-only das
 * compras, com `reason = 'gm_grant'` — assim uma auditoria consegue
 * distinguir crédito criado por GM de crédito ganho em jogo.
 *
 *   GET    /gm/overview                  visão geral do shard
 *   GET    /gm/accounts?limit=&q=        lista contas
 *   PATCH  /gm/accounts/:id/role         promove/rebaixa
 *   POST   /gm/accounts/:id/grant        credita moeda (ledger)
 *   POST   /gm/accounts/:id/items        concede item do catálogo
 *   POST   /gm/accounts/:id/xp           ajusta XP
 *   DELETE /gm/accounts/:id              remove conta e dependências
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import { isAccountRole } from '../auth/types.js';
import { getPool } from '../db/postgres.js';
import { addXp } from '../progression/repository.js';
import { isValidCurrency, type CurrencyCode } from '../economy/types.js';

interface GmContext {
  accountId: number;
  username: string;
}

/**
 * Guard de GM. Devolve `null` para qualquer requisição que não prove
 * ser de um Game Master — o chamador responde 403 sem revelar se o
 * token era inválido ou apenas sem privilégio.
 */
function requireGm(req: FastifyRequest): GmContext | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const payload = verifyToken(auth.slice('Bearer '.length).trim());
  if (!payload) return null;
  if (payload.role !== 'gm') return null;
  const id = Number.parseInt(payload.sub, 10);
  if (!Number.isFinite(id)) return null;
  return { accountId: id, username: payload.username };
}

const roleSchema = z.object({
  role: z.string().refine(isAccountRole, "role deve ser 'player' ou 'gm'"),
});

const grantSchema = z.object({
  currency: z.string().refine(isValidCurrency, 'currency inválida'),
  amount: z.number().int().positive().max(1_000_000_000),
  reason: z.string().max(80).optional(),
});

const itemSchema = z.object({
  itemCode: z.string().min(1).max(80),
  quantity: z.number().int().positive().max(9999).default(1),
});

const xpSchema = z.object({
  // `addXp` da progressão só aceita valores positivos (o level nunca
  // regride pela curva); manter o mesmo contrato evita erro 500.
  amount: z.number().int().positive().max(1_000_000_000),
});

/** Coluna da carteira para a moeda. Lista fechada — nada interpolado. */
function walletColumn(c: CurrencyCode): 'gold' | 'credits' | 'dark_matter' {
  switch (c) {
    case 'gold': return 'gold';
    case 'credits': return 'credits';
    case 'dark_matter': return 'dark_matter';
  }
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const gmRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Autorização apenas. A disponibilidade do banco é checada DEPOIS da
   * validação de entrada (`db()`), senão um payload inválido responderia
   * 503 em vez de 400 — foi o que os testes pegaram.
   */
  const guard = (req: FastifyRequest, reply: FastifyReply): GmContext | null => {
    const gm = requireGm(req);
    if (!gm) {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return gm;
  };

  /** Pool do Postgres, ou 503 já respondido. */
  const db = (reply: FastifyReply): Pool | null => {
    const pool = getPool();
    if (!pool) {
      reply.code(503).send({ error: 'db_unavailable' });
      return null;
    }
    return pool;
  };

  // ---------------------------------------------------------- overview
  app.get('/gm/overview', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const pool = db(reply);
    if (!pool) return;
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM accounts)                        AS accounts,
         (SELECT count(*) FROM accounts WHERE role = 'gm')      AS gms,
         (SELECT count(*) FROM items)                           AS items,
         (SELECT count(*) FROM shop_items)                      AS shop_items,
         (SELECT count(*) FROM transactions)                    AS transactions,
         (SELECT coalesce(sum(credits), 0) FROM wallets)        AS total_credits,
         (SELECT count(*) FROM loadouts)                        AS loadouts`,
    );
    const r = rows[0] ?? {};
    // `count()`/`sum()` voltam como string em BIGINT; normalizamos.
    const num = (v: unknown): number => Number.parseInt(String(v ?? 0), 10) || 0;
    return {
      overview: {
        accounts: num(r.accounts),
        gms: num(r.gms),
        items: num(r.items),
        shopItems: num(r.shop_items),
        transactions: num(r.transactions),
        totalCredits: num(r.total_credits),
        loadouts: num(r.loadouts),
      },
    };
  });

  // ---------------------------------------------------------- accounts
  app.get('/gm/accounts', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const pool = db(reply);
    if (!pool) return;
    const q = req.query as { limit?: string; q?: string };
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '50', 10) || 50, 1), 200);
    const search = (q.q ?? '').trim();

    const { rows } = await pool.query(
      `SELECT a.id, a.username, a.email, a.role, a.created_at AS "createdAt",
              coalesce(w.credits, 0)     AS credits,
              coalesce(w.gold, 0)        AS gold,
              coalesce(w.dark_matter, 0) AS "darkMatter",
              (SELECT count(*) FROM inventory i WHERE i.account_id = a.id) AS items
       FROM accounts a
       LEFT JOIN wallets w ON w.account_id = a.id
       WHERE ($1 = '' OR a.username ILIKE '%' || $1 || '%' OR a.email ILIKE '%' || $1 || '%')
       ORDER BY a.id
       LIMIT $2`,
      [search, limit],
    );
    return { accounts: rows };
  });

  app.patch('/gm/accounts/:id/role', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });

    // Um GM não pode se rebaixar: se for o último, o shard fica sem
    // ninguém capaz de promover outro — estado irrecuperável pela API.
    if (id === gm.accountId && parsed.data.role !== 'gm') {
      return reply.code(409).send({ error: 'cannot_demote_self' });
    }

    const pool = db(reply);
    if (!pool) return;

    const { rows } = await pool.query(
      `UPDATE accounts SET role = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, username, email, role`,
      [parsed.data.role, id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'account_not_found' });
    req.log.warn({ gm: gm.username, target: id, role: parsed.data.role }, 'gm alterou papel');
    return { account: rows[0] };
  });

  app.delete('/gm/accounts/:id', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    if (id === gm.accountId) {
      return reply.code(409).send({ error: 'cannot_delete_self' });
    }

    const pool = db(reply);
    if (!pool) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // O ledger tem FK ON DELETE SET NULL: sem isto sobrariam linhas
      // órfãs referenciando uma conta que não existe mais.
      await client.query(
        `DELETE FROM transactions WHERE from_account_id = $1 OR to_account_id = $1`,
        [id],
      );
      const r = await client.query(`DELETE FROM accounts WHERE id = $1 RETURNING id`, [id]);
      await client.query('COMMIT');
      if (r.rowCount === 0) return reply.code(404).send({ error: 'account_not_found' });
      req.log.warn({ gm: gm.username, target: id }, 'gm removeu conta');
      return { deleted: id };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // ----------------------------------------------------------- economia
  app.post('/gm/accounts/:id/grant', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const parsed = grantSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const col = walletColumn(parsed.data.currency as CurrencyCode);

    const pool = db(reply);
    if (!pool) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query(`SELECT id FROM accounts WHERE id = $1`, [id]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'account_not_found' });
      }
      await client.query(
        `INSERT INTO wallets (account_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [id],
      );
      const w = await client.query(
        `UPDATE wallets SET ${col} = ${col} + $1, updated_at = NOW()
         WHERE account_id = $2 RETURNING gold, credits, dark_matter AS "darkMatter"`,
        [parsed.data.amount, id],
      );
      // Moeda criada por GM entra no ledger com `to_account_id` e
      // origem nula: a auditoria vê que não veio de outro jogador.
      await client.query(
        `INSERT INTO transactions (from_account_id, to_account_id, currency, amount, reason, ref_type, ref_id)
         VALUES (NULL, $1, $2, $3, 'gm_grant', 'gm', $4)`,
        [id, parsed.data.currency, parsed.data.amount, String(gm.accountId)],
      );
      await client.query('COMMIT');
      req.log.warn(
        { gm: gm.username, target: id, ...parsed.data },
        'gm concedeu moeda',
      );
      return { wallet: w.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/gm/accounts/:id/items', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });

    const pool = db(reply);
    if (!pool) return;

    const item = await pool.query<{ id: string }>(
      `SELECT id FROM items WHERE code = $1 LIMIT 1`,
      [parsed.data.itemCode],
    );
    const itemId = item.rows[0]?.id;
    if (!itemId) return reply.code(404).send({ error: 'item_not_found' });

    const r = await pool.query(
      `INSERT INTO inventory (account_id, item_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, item_id)
         DO UPDATE SET quantity = inventory.quantity + $3
       RETURNING account_id AS "accountId", item_id AS "itemId", quantity`,
      [id, itemId, parsed.data.quantity],
    );
    req.log.warn({ gm: gm.username, target: id, ...parsed.data }, 'gm concedeu item');
    return { inventory: r.rows[0] };
  });

  // --------------------------------------------------------- progressão
  app.post('/gm/accounts/:id/xp', async (req, reply) => {
    const gm = guard(req, reply);
    if (!gm) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });

    const parsed = xpSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });

    const pool = db(reply);
    if (!pool) return;

    const exists = await pool.query(`SELECT id FROM accounts WHERE id = $1`, [id]);
    if (exists.rowCount === 0) return reply.code(404).send({ error: 'account_not_found' });

    // Reusa `addXp` da progressão em vez de escrever na tabela direto:
    // ele já recalcula o `level` pela curva oficial dentro da mesma
    // transação. Duplicar a curva aqui seria mais um lugar para ela
    // divergir.
    const result = await addXp(id, parsed.data.amount);
    req.log.warn({ gm: gm.username, target: id, ...parsed.data }, 'gm ajustou xp');
    return { progression: result };
  });
};
