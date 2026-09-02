/**
 * Repositório de economia no Postgres.
 *
 * Operações de escrita usam transações ACID do Postgres:
 *   BEGIN; SELECT ... FOR UPDATE; UPDATE; INSERT INTO transactions; COMMIT;
 */

import { getPool } from '../db/postgres.js';
import type {
  CurrencyCode,
  InventoryEntry,
  Item,
  ShopItem,
  Transaction,
  Wallet,
} from './types.js';

export class DbUnavailableError extends Error {
  constructor() {
    super('Database indisponível');
    this.name = 'DbUnavailableError';
  }
}

export async function getWallet(accountId: number): Promise<Wallet> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<{ gold: string; credits: string; dark_matter: string }>(
    `SELECT gold, credits, dark_matter FROM wallets WHERE account_id = $1`,
    [accountId],
  );
  const row = r.rows[0];
  if (!row) {
    // Auto-cria wallet zerada.
    await pool.query(
      `INSERT INTO wallets (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`,
      [accountId],
    );
    return { gold: 0, credits: 0, dark_matter: 0 };
  }
  return {
    gold: Number.parseInt(row.gold, 10),
    credits: Number.parseInt(row.credits, 10),
    dark_matter: Number.parseInt(row.dark_matter, 10),
  };
}

function currencyColumn(c: CurrencyCode): 'gold' | 'credits' | 'dark_matter' {
  return c;
}

export interface TransferParams {
  fromAccountId: number;
  toAccountId: number;
  currency: CurrencyCode;
  amount: number;
  reason: string;
  refType?: string | undefined;
  refId?: string | undefined;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super('Saldo insuficiente');
    this.name = 'InsufficientFundsError';
  }
}

export class SelfTransferError extends Error {
  constructor() {
    super('Não pode transferir para si mesmo');
    this.name = 'SelfTransferError';
  }
}

/** Transfere `amount` de `currency` de uma conta para outra (ACID). */
export async function transfer(params: TransferParams): Promise<Transaction> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  if (params.fromAccountId === params.toAccountId) {
    throw new SelfTransferError();
  }
  if (params.amount <= 0) {
    throw new Error('amount deve ser > 0');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ordena locks para evitar deadlock.
    const [lowId, highId] =
      params.fromAccountId < params.toAccountId
        ? [params.fromAccountId, params.toAccountId]
        : [params.toAccountId, params.fromAccountId];
    await client.query(`SELECT account_id FROM wallets WHERE account_id IN ($1, $2) FOR UPDATE`, [
      lowId,
      highId,
    ]);

    const col = currencyColumn(params.currency);
    // Garante que ambas wallets existam.
    await client.query(
      `INSERT INTO wallets (account_id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`,
      [params.fromAccountId, params.toAccountId],
    );
    // Debita.
    const deb = await client.query<{ [k: string]: string }>(
      `UPDATE wallets SET ${col} = ${col} - $1, updated_at = NOW()
       WHERE account_id = $2 AND ${col} >= $1
       RETURNING ${col} AS bal`,
      [params.amount, params.fromAccountId],
    );
    if (deb.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new InsufficientFundsError();
    }
    // Credita.
    await client.query(
      `UPDATE wallets SET ${col} = ${col} + $1, updated_at = NOW()
       WHERE account_id = $2`,
      [params.amount, params.toAccountId],
    );
    // Ledger.
    const tx = await client.query<Transaction>(
      `INSERT INTO transactions (from_account_id, to_account_id, currency, amount, reason, ref_type, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id,
                 from_account_id AS "fromAccountId",
                 to_account_id AS "toAccountId",
                 currency,
                 amount,
                 reason,
                 ref_type AS "refType",
                 ref_id AS "refId",
                 created_at AS "createdAt"`,
      [
        params.fromAccountId,
        params.toAccountId,
        params.currency,
        params.amount,
        params.reason,
        params.refType ?? null,
        params.refId ?? null,
      ],
    );
    await client.query('COMMIT');
    const row = tx.rows[0];
    if (!row) throw new Error('Falha ao registrar transaction');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Credita amount em uma conta (mission reward, kill, etc.). */
export async function credit(
  toAccountId: number,
  currency: CurrencyCode,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): Promise<Transaction> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  if (amount <= 0) throw new Error('amount deve ser > 0');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO wallets (account_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [toAccountId],
    );
    const col = currencyColumn(currency);
    await client.query(
      `UPDATE wallets SET ${col} = ${col} + $1, updated_at = NOW() WHERE account_id = $2`,
      [amount, toAccountId],
    );
    const tx = await client.query<Transaction>(
      `INSERT INTO transactions (to_account_id, currency, amount, reason, ref_type, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id,
                 from_account_id AS "fromAccountId",
                 to_account_id AS "toAccountId",
                 currency,
                 amount,
                 reason,
                 ref_type AS "refType",
                 ref_id AS "refId",
                 created_at AS "createdAt"`,
      [toAccountId, currency, amount, reason, refType ?? null, refId ?? null],
    );
    await client.query('COMMIT');
    const row = tx.rows[0];
    if (!row) throw new Error('Falha ao creditar');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Items / Shop ----------

export async function listItems(): Promise<Item[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Item>(
    `SELECT id, code, kind, name, description,
            base_price AS "basePrice",
            currency,
            stackable,
            metadata
     FROM items ORDER BY id`,
  );
  return r.rows;
}

export async function findItemById(id: number): Promise<Item | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Item>(
    `SELECT id, code, kind, name, description,
            base_price AS "basePrice",
            currency,
            stackable,
            metadata
     FROM items WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function findItemByCode(code: string): Promise<Item | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Item>(
    `SELECT id, code, kind, name, description,
            base_price AS "basePrice",
            currency,
            stackable,
            metadata
     FROM items WHERE code = $1 LIMIT 1`,
    [code],
  );
  return r.rows[0] ?? null;
}

export interface ShopView {
  item: Item;
  shop: ShopItem | null;
  finalPrice: number;
}

export async function listShop(): Promise<ShopView[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<{
    id: string;
    code: string;
    kind: string;
    name: string;
    description: string;
    base_price: string;
    currency: string;
    stackable: boolean;
    metadata: Item['metadata'] | null;
    price_mult: string | null;
    stock: string | null;
  }>(
    `SELECT i.id, i.code, i.kind, i.name, i.description, i.base_price, i.currency, i.stackable,
            i.metadata,
            s.price_mult, s.stock
     FROM items i
     LEFT JOIN shop_items s ON s.item_id = i.id
     ORDER BY i.id`,
  );
  return r.rows.map((row) => {
    const priceMult = row.price_mult ? Number.parseFloat(row.price_mult) : 1.0;
    const basePrice = Number.parseInt(row.base_price, 10);
    return {
      item: {
        id: Number.parseInt(row.id, 10),
        code: row.code,
        kind: row.kind as Item['kind'],
        name: row.name,
        description: row.description,
        basePrice,
        currency: row.currency as Item['currency'],
        stackable: row.stackable,
        // Linhas gravadas antes da coluna existir voltam NULL.
        metadata: row.metadata ?? {},
      },
      shop: row.price_mult
        ? {
            itemId: Number.parseInt(row.id, 10),
            priceMultiplier: priceMult,
            stock: row.stock === null ? null : Number.parseInt(row.stock, 10),
          }
        : null,
      finalPrice: Math.max(1, Math.round(basePrice * priceMult)),
    };
  });
}

export class ItemNotInShopError extends Error {
  constructor() {
    super('Item não está na loja');
    this.name = 'ItemNotInShopError';
  }
}

export class OutOfStockError extends Error {
  constructor() {
    super('Sem estoque');
    this.name = 'OutOfStockError';
  }
}

export async function buyItem(
  accountId: number,
  itemId: number,
  quantity: number,
): Promise<Transaction> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  if (quantity <= 0) throw new Error('quantity deve ser > 0');
  const item = await findItemById(itemId);
  if (!item) throw new Error('item não existe');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock shop_items.
    const shop = await client.query<{ price_mult: string; stock: string | null }>(
      `SELECT price_mult, stock FROM shop_items WHERE item_id = $1 FOR UPDATE`,
      [itemId],
    );
    if (shop.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new ItemNotInShopError();
    }
    const priceMult = Number.parseFloat(shop.rows[0]!.price_mult);
    const stock = shop.rows[0]!.stock;
    if (stock !== null && Number.parseInt(stock, 10) < quantity) {
      await client.query('ROLLBACK');
      throw new OutOfStockError();
    }
    const totalPrice = Math.max(1, Math.round(item.basePrice * priceMult) * quantity);
    // Lock wallet.
    await client.query(
      `INSERT INTO wallets (account_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [accountId],
    );
    await client.query(
      `SELECT account_id FROM wallets WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    const col = currencyColumn(item.currency);
    const deb = await client.query(
      `UPDATE wallets SET ${col} = ${col} - $1, updated_at = NOW()
       WHERE account_id = $2 AND ${col} >= $1`,
      [totalPrice, accountId],
    );
    if (deb.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new InsufficientFundsError();
    }
    // Decrementa estoque.
    if (stock !== null) {
      await client.query(
        `UPDATE shop_items SET stock = stock - $1 WHERE item_id = $2`,
        [quantity, itemId],
      );
    }
    // Adiciona ao inventário.
    await client.query(
      `INSERT INTO inventory (account_id, item_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, item_id) DO UPDATE SET quantity = inventory.quantity + $3`,
      [accountId, itemId, quantity],
    );
    // Ledger.
    const tx = await client.query<Transaction>(
      `INSERT INTO transactions (from_account_id, to_account_id, currency, amount, reason, ref_type, ref_id)
       VALUES ($1, NULL, $2, $3, 'shop_buy', 'item', $4)
       RETURNING id,
                 from_account_id AS "fromAccountId",
                 to_account_id AS "toAccountId",
                 currency,
                 amount,
                 reason,
                 ref_type AS "refType",
                 ref_id AS "refId",
                 created_at AS "createdAt"`,
      [accountId, item.currency, totalPrice, String(itemId)],
    );
    await client.query('COMMIT');
    const row = tx.rows[0];
    if (!row) throw new Error('Falha ao registrar buy');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listInventory(accountId: number): Promise<InventoryEntry[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<{ account_id: string; item_id: string; quantity: string }>(
    `SELECT account_id, item_id, quantity FROM inventory WHERE account_id = $1 AND quantity > 0`,
    [accountId],
  );
  return r.rows.map((row) => ({
    accountId: Number.parseInt(row.account_id, 10),
    itemId: Number.parseInt(row.item_id, 10),
    quantity: Number.parseInt(row.quantity, 10),
  }));
}

export async function listTransactions(
  accountId: number,
  limit: number,
): Promise<Transaction[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const lim = Math.max(1, Math.min(limit, 100));
  const r = await pool.query<Transaction>(
    `SELECT id,
            from_account_id AS "fromAccountId",
            to_account_id AS "toAccountId",
            currency,
            amount,
            reason,
            ref_type AS "refType",
            ref_id AS "refId",
            created_at AS "createdAt"
     FROM transactions
     WHERE from_account_id = $1 OR to_account_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [accountId, lim],
  );
  return r.rows;
}
