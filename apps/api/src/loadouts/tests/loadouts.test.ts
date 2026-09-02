/**
 * Testes do módulo de loadouts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { signToken } from '../../auth/tokens.js';

describe('loadouts routes (sem Postgres)', () => {
  let app: FastifyInstance;
  const token = signToken({ accountId: 10, username: 'player-10' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ---------- Auth ----------

  it('GET /loadouts sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/loadouts' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /loadouts sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/loadouts', payload: { name: 'Assault' } });
    expect(res.statusCode).toBe(401);
  });

  // ---------- DB indisponível (503) ----------

  it('GET /loadouts com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/loadouts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /loadouts com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/loadouts',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sniper' },
    });
    expect(res.statusCode).toBe(503);
  });

  // ---------- Validação de input (400) ----------

  it('POST /loadouts sem nome retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/loadouts',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /loadouts com nome vazio retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/loadouts',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /loadouts/:id com id não-numérico retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/loadouts/abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
