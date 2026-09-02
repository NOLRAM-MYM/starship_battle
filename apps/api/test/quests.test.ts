/**
 * Testes do módulo quests.
 *
 * Em dev sem Postgres:
 *  - isValidObjectiveKind (puro)             ✓ testável
 *  - Endpoints sem auth                       ✓ testável
 *  - Endpoints com auth + DB indisponível     ✗ esperado 503
 *  - Validação de input (zod)                 ✓ testável
 *  - Service-level: invalid input             ✓ testável
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import { isValidObjectiveKind } from '../src/quests/types.js';

describe('quests pure helpers', () => {
  it('isValidObjectiveKind aceita kinds válidos', () => {
    expect(isValidObjectiveKind('kill')).toBe(true);
    expect(isValidObjectiveKind('collect')).toBe(true);
    expect(isValidObjectiveKind('explore')).toBe(true);
    expect(isValidObjectiveKind('destroy')).toBe(true);
    expect(isValidObjectiveKind('deliver')).toBe(true);
  });

  it('isValidObjectiveKind rejeita kinds inválidos', () => {
    expect(isValidObjectiveKind('craft')).toBe(false);
    expect(isValidObjectiveKind('')).toBe(false);
    expect(isValidObjectiveKind('KILL')).toBe(false);
  });
});

describe('quests routes (sem Postgres)', () => {
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

  it('GET /quests sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/quests' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /quests/:id sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/quests/q_intro' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /quests/:id/accept sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/quests/q_intro/accept' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /quests/instances sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/quests/instances' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /quests/instances/:id sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/quests/instances/1' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /quests/instances/:id/abandon sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/quests/instances/1/abandon' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /quests/instances/progress sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/instances/progress',
      payload: { templateId: 'q', objectiveId: 'o', amount: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------- DB indisponível (503) ----------

  it('GET /quests com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/quests',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /quests/:id com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/quests/q_intro',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /quests/:id/accept com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/q_intro/accept',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /quests/instances com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/quests/instances',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /quests/instances/:id com id não-numérico retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/quests/instances/abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /quests/instances/:id/abandon com id não-numérico retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/instances/abc/abandon',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------- Validação de input (400) ----------

  it('POST /quests/instances/progress com amount 0 retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/instances/progress',
      headers: { authorization: `Bearer ${token}` },
      payload: { templateId: 'q', objectiveId: 'o', amount: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /quests/instances/progress com amount negativo retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/instances/progress',
      headers: { authorization: `Bearer ${token}` },
      payload: { templateId: 'q', objectiveId: 'o', amount: -3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /quests/instances/progress sem templateId retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/instances/progress',
      headers: { authorization: `Bearer ${token}` },
      payload: { objectiveId: 'o', amount: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /quests/instances/progress com templateId vazio retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/quests/instances/progress',
      headers: { authorization: `Bearer ${token}` },
      payload: { templateId: '', objectiveId: 'o', amount: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------- Service-level ----------

  it('acceptQuestService lança invalid_input para templateId vazio', async () => {
    const { acceptQuestService, QuestError } = await import('../src/quests/service.js');
    await expect(acceptQuestService(1, '')).rejects.toBeInstanceOf(QuestError);
    await expect(acceptQuestService(1, '')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('applyProgressService lança invalid_input para amount zero', async () => {
    const { applyProgressService, QuestError } = await import('../src/quests/service.js');
    await expect(
      applyProgressService({ accountId: 1, templateId: 'q', objectiveId: 'o', amount: 0 }),
    ).rejects.toBeInstanceOf(QuestError);
  });

  it('applyProgressService lança invalid_input para amount não-inteiro', async () => {
    const { applyProgressService, QuestError } = await import('../src/quests/service.js');
    await expect(
      applyProgressService({ accountId: 1, templateId: 'q', objectiveId: 'o', amount: 1.5 }),
    ).rejects.toBeInstanceOf(QuestError);
  });

  it('abandonQuestService lança invalid_input para instanceId inválido', async () => {
    const { abandonQuestService, QuestError } = await import('../src/quests/service.js');
    await expect(abandonQuestService(1, 0)).rejects.toBeInstanceOf(QuestError);
    await expect(abandonQuestService(1, -5)).rejects.toBeInstanceOf(QuestError);
  });
});
