/**
 * Testes do módulo matchmaking.
 *
 * Em dev sem Redis/NATS:
 *  - Algoritmo puro (skillWindow, findCompatible)   ✓ testável
 *  - Party helpers (PartyError, etc)               ✓ testável
 *  - Endpoints de fila                             ✗ esperado 503
 *  - Validação de input (zod)                      ✓ testável
 *  - Auth required                                 ✓ testável
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import {
  findCompatible,
  isValidMode,
  partyAverageSkill,
  skillWindow,
  TEAM_SIZES,
} from '../src/matchmaking/service.js';
import type { Party, QueueEntry } from '../src/matchmaking/types.js';

describe('matchmaking algorithm (pure)', () => {
  it('skillWindow relaxa com tempo de espera', () => {
    const w0 = skillWindow(1000, 0);
    expect(w0.min).toBeCloseTo(900);
    expect(w0.max).toBeCloseTo(1100);

    const w60s = skillWindow(1000, 60_000);
    // 1 minuto: 100 * 1.5 = 150
    expect(w60s.min).toBeCloseTo(850);
    expect(w60s.max).toBeCloseTo(1150);

    const w10m = skillWindow(1000, 600_000);
    // 10 min: 100 * 6 = 600
    expect(w10m.min).toBeCloseTo(400);
    expect(w10m.max).toBeCloseTo(1600);
  });

  it('findCompatible escolhe N entries compatíveis', () => {
    const t0 = 1_000_000;
    const pool: QueueEntry[] = [
      { id: 'a', accountIds: [1], mode: 'duel', skill: 1000, enqueuedAt: t0 },
      { id: 'b', accountIds: [2], mode: 'duel', skill: 1050, enqueuedAt: t0 + 1 },
      { id: 'c', accountIds: [3], mode: 'duel', skill: 1400, enqueuedAt: t0 + 2 },
    ];
    // Sem espera, skill±100. a (1000) e b (1050) compatíveis; c não.
    const { picked, remaining } = findCompatible(pool, 2, 0, t0 + 5);
    expect(picked).toHaveLength(2);
    expect(picked.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(remaining.map((e) => e.id)).toEqual(['c']);
  });

  it('findCompatible sem espera limita janela a ±100', () => {
    const t0 = 1_000_000;
    const pool: QueueEntry[] = [
      { id: 'a', accountIds: [1], mode: 'duel', skill: 1000, enqueuedAt: t0 },
      { id: 'b', accountIds: [2], mode: 'duel', skill: 1300, enqueuedAt: t0 + 1 },
    ];
    // 1300 está fora de 1000±100 (900..1100), portanto b não casa.
    // Mas 'a' (a primeira, anchor) é sempre aceita.
    const { picked, remaining } = findCompatible(pool, 2, 0, t0 + 2);
    expect(picked.map((e) => e.id)).toEqual(['a']);
    expect(remaining.map((e) => e.id)).toEqual(['b']);
  });

  it('findCompatible com tempo longo aceita ranges maiores', () => {
    const t0 = 1_000_000;
    const pool: QueueEntry[] = [
      { id: 'a', accountIds: [1], mode: 'duel', skill: 1000, enqueuedAt: t0 },
      { id: 'b', accountIds: [2], mode: 'duel', skill: 1300, enqueuedAt: t0 + 1 },
    ];
    // 10 min de espera: 1000±600 vs 1300 — compatível.
    const { picked } = findCompatible(pool, 2, 600_000, t0 + 600_000 + 2);
    expect(picked).toHaveLength(2);
  });

  it('isValidMode aceita apenas modos conhecidos', () => {
    expect(isValidMode('duel')).toBe(true);
    expect(isValidMode('team_5v5')).toBe(true);
    expect(isValidMode('unknown')).toBe(false);
  });

  it('TEAM_SIZES tem tamanho para cada mode', () => {
    expect(TEAM_SIZES.duel).toBe(2);
    expect(TEAM_SIZES.team_2v2).toBe(4);
    expect(TEAM_SIZES.team_5v5).toBe(10);
    expect(TEAM_SIZES.free_for_all).toBe(8);
  });

  it('partyAverageSkill calcula média', () => {
    const party: Party = {
      id: 'p1',
      leaderAccountId: 1,
      members: [
        { accountId: 1, username: 'a', ready: true, joinedAt: 0 },
        { accountId: 2, username: 'b', ready: true, joinedAt: 0 },
      ],
      createdAt: 0,
      allReady: true,
    };
    const skills = new Map<number, number>([[1, 800], [2, 1200]]);
    expect(partyAverageSkill(party, skills)).toBe(1000);
  });

  it('partyAverageSkill usa default 1000 se skills ausentes', () => {
    const party: Party = {
      id: 'p1',
      leaderAccountId: 1,
      members: [{ accountId: 1, username: 'a', ready: true, joinedAt: 0 }],
      createdAt: 0,
      allReady: true,
    };
    expect(partyAverageSkill(party, new Map())).toBe(1000);
  });
});

describe('matchmaking routes (sem Redis)', () => {
  let app: FastifyInstance;
  const token = signToken({ accountId: 1, username: 'pilot-1' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /parties sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/parties' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /parties com auth retorna 503 (Redis indisponível)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /matchmaking/queue sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/matchmaking/queue',
      payload: { mode: 'duel' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /matchmaking/queue com mode inválido retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/matchmaking/queue',
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: 'unknown' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /matchmaking/queue com auth retorna 503 (Redis indisponível)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/matchmaking/queue',
      headers: { authorization: `Bearer ${token}` },
      payload: { mode: 'duel' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /matchmaking/queue?mode=duel sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/matchmaking/queue?mode=duel' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /matchmaking/queue?mode=ruim retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/matchmaking/queue?mode=ruim',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /matchmaking/queue sem mode retorna 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/matchmaking/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
