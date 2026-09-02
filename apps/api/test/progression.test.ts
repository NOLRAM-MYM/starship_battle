/**
 * Testes do módulo progression.
 *
 * Em dev sem Postgres:
 *  - Helpers puros (xpNextFor, levelFromXp, maxSpendablePoints, isValidBranch)
 *  - Endpoints sem auth (401)
 *  - Endpoints com auth + DB indisponível (503)
 *  - Service-level: validação de branch inválido
 *  - addXpService com pool mockado: confirma curva de level
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import {
  isValidBranch,
  levelFromXp,
  maxSpendablePoints,
  xpNextFor,
} from '../src/progression/types.js';

describe('progression pure helpers', () => {
  it('isValidBranch aceita branches conhecidos', () => {
    expect(isValidBranch('combat')).toBe(true);
    expect(isValidBranch('industry')).toBe(true);
    expect(isValidBranch('exploration')).toBe(true);
  });

  it('isValidBranch rejeita branches inválidos', () => {
    expect(isValidBranch('crafting')).toBe(false);
    expect(isValidBranch('')).toBe(false);
    expect(isValidBranch('COMBAT')).toBe(false);
  });

  it('xpNextFor segue a curva 100 * 1.4^level', () => {
    expect(xpNextFor(0)).toBe(100);
    expect(xpNextFor(1)).toBe(140);
    expect(xpNextFor(2)).toBe(196);
    expect(xpNextFor(3)).toBe(274);
  });

  it('levelFromXp: xp=0 → 1, xp=150 → 2, xp=240 → 2, xp=250 → 3', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(150)).toBe(2);
    expect(levelFromXp(239)).toBe(2);
    expect(levelFromXp(240)).toBe(3);
  });

  it('maxSpendablePoints = max(0, level - 1)', () => {
    expect(maxSpendablePoints(1)).toBe(0);
    expect(maxSpendablePoints(2)).toBe(1);
    expect(maxSpendablePoints(10)).toBe(9);
    expect(maxSpendablePoints(0)).toBe(0);
    expect(maxSpendablePoints(-1)).toBe(0);
  });
});

describe('progression routes (sem Postgres)', () => {
  let app: FastifyInstance;
  const token = signToken({ accountId: 7, username: 'pilot-7' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ---------- Auth (401) ----------

  it('GET /progression/me sem auth retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/progression/me' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /progression/xp sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/progression/xp',
      payload: { amount: 50 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /progression/skills/spend sem auth retorna 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/progression/skills/spend',
      payload: { branch: 'combat', node: 'combat_t1' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------- DB indisponível (503) ----------

  it('GET /progression/me com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/progression/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string };
    expect(body.error).toBe('db_unavailable');
  });

  it('POST /progression/xp com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/progression/xp',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 50 },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /progression/skills/spend com auth retorna 503', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/progression/skills/spend',
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: 'combat', node: 'combat_t1' },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('progression service (com Postgres mockado)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unmock('../src/db/postgres.js');
    vi.unmock('../src/db/redis.js');
    vi.unmock('../src/auth/repository.js');
    vi.resetModules();
  });

  it('addXpService computes level from curve (xp=150 → level 2) and syncs to Redis', async () => {
    // Limpa cache para que o mock seja aplicado.
    vi.resetModules();
    // Mock pool que responde BEGIN, INSERT ON CONFLICT, SELECT FOR UPDATE,
    // UPDATE, COMMIT. account_xp está vazia no início.
    const queries: string[] = [];
    const fakeClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (/^BEGIN/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/^COMMIT/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/^ROLLBACK/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO account_xp/i.test(sql)) {
          // UPSERT com EXCLUDED.total_xp — simulamos que total_xp agora é 150.
          return { rows: [{ total_xp: '150' }], rowCount: 1 };
        }
        if (/SELECT level FROM account_xp.*FOR UPDATE/i.test(sql)) {
          // Linha ainda não existe (account_xp vazia) → rowCount=0.
          // Mas o INSERT...ON CONFLICT acabou de criar a linha; retornamos
          // level=1 (prev) para que o serviço calcule a transição.
          return { rows: [{ level: '1' }], rowCount: 1 };
        }
        if (/UPDATE account_xp SET level/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        // SELECT genérico — não esperado neste teste.
        void params;
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const fakePool = {
      connect: vi.fn(async () => fakeClient),
      query: vi.fn(),
    };

    vi.doMock('../src/db/postgres.js', () => ({
      getPool: () => fakePool,
      closePool: async () => undefined,
      pingDatabase: async () => true,
    }));

    const fakeRedis = {
      zincrby: vi.fn().mockResolvedValue('150'),
    };

    vi.doMock('../src/db/redis.js', () => ({
      getRedis: () => fakeRedis,
    }));

    vi.doMock('../src/auth/repository.js', () => ({
      findAccountById: vi.fn(async (id: number) => {
        if (id === 42) return { id: 42, username: 'player42' };
        return null;
      }),
    }));

    // Importação dinâmica DEPOIS do mock estar configurado.
    const { addXpService } = await import('../src/progression/service.js');
    const result = await addXpService(42, 150);
    expect(result.totalXp).toBe(150);
    expect(result.level).toBe(2);
    expect(result.leveledUp).toBe(true);
    
    // Verifica se sincronizou com o Redis
    expect(fakeRedis.zincrby).toHaveBeenCalledWith('leaderboard:xp', 150, 'player42');
  });

  it('spendSkillService valida branch inválido (400/ProgressionError)', async () => {
    // Pool irrelevante: a validação acontece antes do repo.
    const { spendSkillService, ProgressionError } = await import('../src/progression/service.js');

    await expect(spendSkillService(1, 'crafting', 'node_x')).rejects.toBeInstanceOf(
      ProgressionError,
    );
    await expect(spendSkillService(1, 'crafting', 'node_x')).rejects.toMatchObject({
      code: 'invalid_input',
    });

    await expect(spendSkillService(1, 'combat', '')).rejects.toBeInstanceOf(ProgressionError);
    await expect(spendSkillService(1, 'combat', '')).rejects.toMatchObject({
      code: 'invalid_input',
    });

    // Branch vazia também é inválida.
    await expect(spendSkillService(1, '', 'node_x')).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
