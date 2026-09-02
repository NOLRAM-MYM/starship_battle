/**
 * Health check tests.
 *
 * Garante que:
 *  - `/healthz` sempre retorna 200 (liveness)
 *  - `/readyz` retorna 503 quando DB/Redis/NATS não estão configurados
 *  - o servidor sobe e desce corretamente
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

describe('health endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // testMode desativa request logging para output mais limpo.
    app = await buildServer({ testMode: true });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /healthz returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /readyz returns 503 when DB/Redis/NATS are not configured', async () => {
    // Em dev/test sem DATABASE_URL/REDIS_URL/NATS_URL, todos os pings falham.
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as {
      status: string;
      db: boolean;
      redis: boolean;
      nats: boolean;
    };
    expect(body.status).toBe('not-ready');
    expect(body.db).toBe(false);
    expect(body.redis).toBe(false);
    expect(body.nats).toBe(false);
  });
});
