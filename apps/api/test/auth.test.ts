/**
 * Testes do módulo auth.
 *
 * Estratégia em dev (sem Postgres):
 *  - Validação de input (zod)         ✓ testável sem DB
 *  - Hashing de senha (bcrypt)        ✓ testável sem DB
 *  - JWT sign/verify roundtrip        ✓ testável sem DB
 *  - Endpoints de DB (signup/login)   ✗ esperado 503 quando DB indisponível
 *  - Token inválido em /auth/me       ✓ testável sem DB
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { signToken, verifyToken } from '../src/auth/tokens.js';

describe('passwords', () => {
  it('hashPassword produces a bcrypt hash and verifyPassword matches', async () => {
    const hash = await hashPassword('hunter22');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('hunter22', hash)).toBe(true);
    expect(await verifyPassword('hunter23', hash)).toBe(false);
  });
});

describe('tokens', () => {
  it('signToken and verifyToken roundtrip', () => {
    const tok = signToken({ accountId: 42, username: 'pilot-1' });
    expect(typeof tok).toBe('string');
    const payload = verifyToken(tok);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('42');
    expect(payload?.username).toBe('pilot-1');
  });

  it('verifyToken returns null for invalid token', () => {
    expect(verifyToken('not-a-jwt')).toBeNull();
  });
});

describe('auth routes (input validation, sem DB)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /auth/signup valida username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { username: 'ab', email: 'a@b.com', password: 'longenough' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toBe('invalid_input');
  });

  it('POST /auth/signup valida email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { username: 'pilot1', email: 'not-an-email', password: 'longenough' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/signup valida senha curta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { username: 'pilot1', email: 'a@b.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/signup retorna 503 quando DB indisponível', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { username: 'pilot1', email: 'a@b.com', password: 'longenough' },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string };
    expect(body.error).toBe('db_unavailable');
  });

  it('POST /auth/login valida input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'bad', password: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/login retorna 503 quando DB indisponível', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@b.com', password: 'longenough' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /auth/me sem Authorization header retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: string };
    expect(body.error).toBe('missing_token');
  });

  it('GET /auth/me com token malformado retorna 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer garbage' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me com token válido mas sem DB retorna 503', async () => {
    const tok = signToken({ accountId: 1, username: 'pilot' });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(503);
  });
});
