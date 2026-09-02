/**
 * Testes do módulo economy.
 *
 * Em dev sem Postgres:
 *  - emptyWallet (puro)                            ✓ testável
 *  - isValidCurrency (puro)                        ✓ testável
 *  - Endpoints sem auth                            ✓ testável
 *  - Endpoints com auth + DB indisponível          ✗ esperado 503
 *  - Validação de input (zod)                      ✓ testável
 *  - Currency inválida                             ✓ testável
 *  - Quantity > 1000                               ✓ testável
 *  - Amount <= 0                                   ✓ testável
 *  - Self-transfer (toAccountId == accountId)      ✓ testável (route zod passa, service valida)
 *  - Transações GET com/sem limit                  ✓ testável
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import { emptyWallet, isValidCurrency } from '../src/economy/types.js';

describe('economy pure helpers', () => {
  it('emptyWallet retorna zeros em todas as moedas', () => {
    expect(emptyWallet()).toEqual({ gold: 0, credits: 0, dark_matter: 0 });
  });

  it('isValidCurrency aceita moedas válidas', () => {
    expect(isValidCurrency('gold')).toBe(true);
    expect(isValidCurrency('credits')).toBe(true);
    expect(isValidCurrency('dark_matter')).toBe(true);
  });

  it('isValidCurrency rejeita moedas inválidas', () => {
    expect(isValidCurrency('silver')).toBe(false);
    expect(isValidCurrency('')).toBe(false);
    expect(isValidCurrency('GOLD')).toBe(false);
    expect(isValidCurrency('bitcoin')).toBe(false);
  });
});

describe('economy routes (sem Postgres)', () => {
  let app: FastifyInstance;
  const token = signToken({ accountId: 7, username: 'pilot-7' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ---------- Auth ----------

  it('GET /economy/wallet sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/economy/wallet' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /economy/transfer sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      payload: { toAccountId: 2, currency: 'gold', amount: 10 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /economy/transactions sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/economy/transactions' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /economy/items sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/economy/items' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /economy/shop sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/economy/shop' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /economy/shop/buy sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/shop/buy',
      payload: { itemId: 1, quantity: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /economy/inventory sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/economy/inventory' });
    expect(res.statusCode).toBe(401);
  });

  // ---------- DB indisponível (503) ----------

  it('GET /economy/wallet com auth retorna 503 (DB indisponível)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/economy/wallet',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string };
    expect(body.error).toBe('db_unavailable');
  });

  it('GET /economy/transactions com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/economy/transactions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /economy/transactions?limit=5 com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/economy/transactions?limit=5',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /economy/items com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/economy/items',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /economy/shop com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/economy/shop',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /economy/inventory com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/economy/inventory',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  // ---------- Validação de input (400) ----------

  it('POST /economy/transfer com currency inválida retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      headers: { authorization: `Bearer ${token}` },
      payload: { toAccountId: 2, currency: 'silver', amount: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/transfer com amount 0 retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      headers: { authorization: `Bearer ${token}` },
      payload: { toAccountId: 2, currency: 'gold', amount: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/transfer com amount negativo retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      headers: { authorization: `Bearer ${token}` },
      payload: { toAccountId: 2, currency: 'gold', amount: -50 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/transfer com toAccountId inválido retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      headers: { authorization: `Bearer ${token}` },
      payload: { toAccountId: 0, currency: 'gold', amount: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/transfer com toAccountId não-numérico retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      headers: { authorization: `Bearer ${token}` },
      payload: { toAccountId: 'abc', currency: 'gold', amount: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/transfer com payload vazio retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/transfer',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/shop/buy com itemId inválido retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/shop/buy',
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId: -1, quantity: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/shop/buy com quantity 0 retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/shop/buy',
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId: 1, quantity: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/shop/buy com quantity > 1000 retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/shop/buy',
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId: 1, quantity: 5000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /economy/shop/buy com quantity não-inteira retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/economy/shop/buy',
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId: 1, quantity: 1.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------- Service-level: self-transfer (sem DB) ----------

  it('transferService lança invalid_input para amount zero', async () => {
    const { transferService, EconomyError } = await import('../src/economy/service.js');
    await expect(
      transferService({
        fromAccountId: 1,
        toAccountId: 2,
        currency: 'gold',
        amount: 0,
        reason: 'transfer',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      transferService({
        fromAccountId: 1,
        toAccountId: 2,
        currency: 'gold',
        amount: -10,
        reason: 'transfer',
      }),
    ).rejects.toBeInstanceOf(EconomyError);
  });

  it('buyItemService lança invalid_input para quantity inválida', async () => {
    const { buyItemService, EconomyError } = await import('../src/economy/service.js');
    await expect(buyItemService(1, 1, 0)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(buyItemService(1, 1, 1001)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(buyItemService(1, 1, 1.5)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(buyItemService(1, 0, 1)).rejects.toBeInstanceOf(EconomyError);
    await expect(buyItemService(1, -5, 1)).rejects.toBeInstanceOf(EconomyError);
  });

  it('creditService lança invalid_input para currency inválida', async () => {
    const { creditService, EconomyError } = await import('../src/economy/service.js');
    await expect(
      creditService(1, 'silver' as never, 10, 'admin'),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      creditService(1, 'silver' as never, 10, 'admin'),
    ).rejects.toBeInstanceOf(EconomyError);
  });
});
