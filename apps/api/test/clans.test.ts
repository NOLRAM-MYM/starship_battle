/**
 * Testes do módulo clãs.
 *
 * Em dev sem Postgres:
 *  - Validação de input (zod)         ✓ testável
 *  - Auth required                    ✓ testável
 *  - Endpoints com auth + DB indisponível  ✗ esperado 503
 *  - Lógica pura (TAG_RE, isRoleAtLeast)  ✓ testável
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import { isRoleAtLeast, ROLE_RANK } from '../src/clans/types.js';

describe('clans pure helpers', () => {
  it('isRoleAtLeast respeita hierarquia', () => {
    expect(isRoleAtLeast('leader', 'officer')).toBe(true);
    expect(isRoleAtLeast('leader', 'member')).toBe(true);
    expect(isRoleAtLeast('officer', 'member')).toBe(true);
    expect(isRoleAtLeast('member', 'officer')).toBe(false);
    expect(isRoleAtLeast('officer', 'leader')).toBe(false);
  });

  it('ROLE_RANK ordena por hierarquia', () => {
    expect(ROLE_RANK.leader).toBeGreaterThan(ROLE_RANK.officer);
    expect(ROLE_RANK.officer).toBeGreaterThan(ROLE_RANK.member);
  });
});

describe('clan routes (sem Postgres)', () => {
  let app: FastifyInstance;
  const token = signToken({ accountId: 1, username: 'pilot-1' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /clans sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans',
      payload: { name: 'Test', tag: 'TST' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /clans com tag inválida retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test', tag: 'lowercase' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /clans com name curto retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'ab', tag: 'TST' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /clans com auth retorna 503 (Postgres indisponível)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test Clan', tag: 'TST' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /clans sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clans' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /clans com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /clans/:id com id inválido retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clans/abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /clans/:id com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clans/1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('PATCH /clans/:id sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clans/1',
      payload: { name: 'New' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('DELETE /clans/:id com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/clans/1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /clans/:id/invites sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans/1/invites',
      payload: { accountId: 2 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /clans/:id/invites com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans/1/invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { accountId: 2 },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /clans/:id/join sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/clans/1/join' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /clans/:id/leave sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/clans/1/leave' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /clans/:id/kick sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans/1/kick',
      payload: { accountId: 2 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /clans/:id/promote com role inválida retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clans/1/promote',
      headers: { authorization: `Bearer ${token}` },
      payload: { accountId: 2, role: 'leader' },
    });
    // role 'leader' não é aceita no schema (apenas 'officer' ou 'member').
    expect(res.statusCode).toBe(400);
  });

  it('GET /clans/me/invites com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clans/me/invites',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });
});
