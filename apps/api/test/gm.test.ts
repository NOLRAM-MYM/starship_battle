/**
 * Testes do módulo Game Master.
 *
 * O que importa aqui é o CONTROLE DE ACESSO, e isso é testável sem
 * Postgres: o guard roda antes de qualquer toque no banco. Um jogador
 * que recebesse 503 em vez de 403 já seria um vazamento de informação —
 * revelaria que o endpoint existe e que ele passou pela autorização.
 *
 * As operações em si (grant/items/xp) exigem DB e são cobertas pelo
 * caminho manual documentado em docs/architecture/0003-game-master.md.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken, verifyToken } from '../src/auth/tokens.js';
import { isAccountRole } from '../src/auth/types.js';

describe('papel da conta', () => {
  it('isAccountRole aceita só player e gm', () => {
    expect(isAccountRole('player')).toBe(true);
    expect(isAccountRole('gm')).toBe(true);
    expect(isAccountRole('admin')).toBe(false);
    expect(isAccountRole('')).toBe(false);
    expect(isAccountRole(undefined)).toBe(false);
    expect(isAccountRole(null)).toBe(false);
  });

  it('o token carrega o papel no roundtrip', () => {
    const tok = signToken({ accountId: 1, username: 'gm', role: 'gm' });
    expect(verifyToken(tok)?.role).toBe('gm');
  });

  it('token sem papel explícito vira player (fail-closed)', () => {
    // Assinar sem `role` simula um token emitido antes da mudança.
    const tok = signToken({ accountId: 2, username: 'antigo' });
    expect(verifyToken(tok)?.role).toBe('player');
  });
});

describe('guard das rotas /gm', () => {
  let app: FastifyInstance;

  const gmToken = signToken({ accountId: 1, username: 'gamemaster', role: 'gm' });
  const playerToken = signToken({ accountId: 2, username: 'piloto', role: 'player' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  const rotas: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }> = [
    { method: 'GET', url: '/gm/overview' },
    { method: 'GET', url: '/gm/accounts' },
    { method: 'PATCH', url: '/gm/accounts/2/role', payload: { role: 'gm' } },
    { method: 'POST', url: '/gm/accounts/2/grant', payload: { currency: 'credits', amount: 100 } },
    { method: 'POST', url: '/gm/accounts/2/items', payload: { itemCode: 'engine_mk1', quantity: 1 } },
    { method: 'POST', url: '/gm/accounts/2/xp', payload: { amount: 100 } },
    { method: 'DELETE', url: '/gm/accounts/2' },
  ];

  it.each(rotas)('$method $url sem token retorna 403', async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, payload: payload as never });
    expect(res.statusCode).toBe(403);
  });

  it.each(rotas)('$method $url com token de jogador retorna 403', async ({ method, url, payload }) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: payload as never,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it.each(rotas)('$method $url com token de GM passa do guard', async ({ method, url, payload }) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${gmToken}` },
      payload: payload as never,
    });
    // Sem Postgres o guard passa e o handler responde 503. O que NÃO
    // pode acontecer é 403: isso significaria o GM sendo barrado.
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(503);
  });

  it('token malformado é tratado como anônimo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/gm/overview',
      headers: { authorization: 'Bearer nao-e-um-jwt' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('esquema diferente de Bearer é recusado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/gm/overview',
      headers: { authorization: `Basic ${gmToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('um GM não pode rebaixar a si mesmo', async () => {
    // O guard resolve accountId=1 do token; alvo 1 é ele mesmo.
    const res = await app.inject({
      method: 'PATCH',
      url: '/gm/accounts/1/role',
      headers: { authorization: `Bearer ${gmToken}` },
      payload: { role: 'player' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'cannot_demote_self' });
  });

  it('um GM não pode apagar a própria conta', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/gm/accounts/1',
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'cannot_delete_self' });
  });

  it('valida a entrada antes de tocar no banco', async () => {
    const casos = [
      { url: '/gm/accounts/1/role', payload: { role: 'superadmin' } },
      { url: '/gm/accounts/2/grant', payload: { currency: 'bitcoin', amount: 10 } },
      { url: '/gm/accounts/2/grant', payload: { currency: 'credits', amount: -5 } },
      { url: '/gm/accounts/2/xp', payload: { amount: 0 } },
    ];
    for (const c of casos) {
      const res = await app.inject({
        method: c.url.endsWith('/role') ? 'PATCH' : 'POST',
        url: c.url,
        headers: { authorization: `Bearer ${gmToken}` },
        payload: c.payload,
      });
      expect(res.statusCode, `${c.url} ${JSON.stringify(c.payload)}`).toBe(400);
    }
  });

  it('id inválido na rota retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/gm/accounts/abc/grant',
      headers: { authorization: `Bearer ${gmToken}` },
      payload: { currency: 'credits', amount: 10 },
    });
    expect(res.statusCode).toBe(400);
  });
});
