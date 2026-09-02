import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signToken } from '../src/auth/tokens.js';
import { getRedis, closeRedis } from '../src/db/redis.js';

describe('leaderboards pure helpers & routes', () => {
  let app: FastifyInstance;
  const token1 = signToken({ accountId: 1, username: 'player-1' });
  const token2 = signToken({ accountId: 2, username: 'player-2' });
  const token3 = signToken({ accountId: 3, username: 'player-3' });

  beforeEach(async () => {
    app = await buildServer({ testMode: true });
    await app.ready();
    const redis = getRedis();
    if (redis) {
      await redis.flushdb();
    }
  });

  afterEach(async () => {
    const redis = getRedis();
    if (redis) {
      await redis.flushdb();
    }
    if (app) await app.close();
  });

  describe('Leaderboards without Auth', () => {
    it('POST /leaderboards/global/score sem auth retorna 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/leaderboards/global/score',
        payload: { score: 100 },
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /leaderboards/global/me sem auth retorna 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/leaderboards/global/me' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Leaderboards with Auth & Redis mock/unavailable', () => {
    // If Redis is not available, we should handle it gracefully or return 503
    it('GET /leaderboards/global retorna 503 if redis is unavailable', async () => {
      // For this test, we assume if getRedis returns null or redis is not connected, it returns 503.
      // But in testMode, maybe we have a real redis or not. Let's just expect standard behavior.
      // We will rely on getRedis() check.
      const res = await app.inject({ method: 'GET', url: '/leaderboards/global' });
      const redis = getRedis();
      if (!redis) {
        expect(res.statusCode).toBe(503);
      }
    });
  });

  describe('Leaderboards with valid Redis', () => {
    it('should submit score and retrieve leaderboard', async () => {
      const redis = getRedis();
      if (!redis) {
        console.warn('Redis not configured, skipping test');
        return;
      }

      // Submit score for player 1
      let res = await app.inject({
        method: 'POST',
        url: '/leaderboards/global/score',
        headers: { authorization: `Bearer ${token1}` },
        payload: { score: 50 },
      });
      expect(res.statusCode).toBe(204);

      // Submit score for player 2
      res = await app.inject({
        method: 'POST',
        url: '/leaderboards/global/score',
        headers: { authorization: `Bearer ${token2}` },
        payload: { score: 100 },
      });
      expect(res.statusCode).toBe(204);

      // Submit score for player 3
      res = await app.inject({
        method: 'POST',
        url: '/leaderboards/global/score',
        headers: { authorization: `Bearer ${token3}` },
        payload: { score: 75 },
      });
      expect(res.statusCode).toBe(204);

      // Get leaderboard
      res = await app.inject({
        method: 'GET',
        url: '/leaderboards/global',
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.leaderboard).toHaveLength(3);
      // Sorted by score descending
      expect(data.leaderboard[0]).toMatchObject({ accountId: 2, score: 100 });
      expect(data.leaderboard[1]).toMatchObject({ accountId: 3, score: 75 });
      expect(data.leaderboard[2]).toMatchObject({ accountId: 1, score: 50 });

      // Get me for player 3
      res = await app.inject({
        method: 'GET',
        url: '/leaderboards/global/me',
        headers: { authorization: `Bearer ${token3}` },
      });
      expect(res.statusCode).toBe(200);
      const meData = res.json();
      expect(meData.rank).toBe(2); // 1-based index (2nd place)
      expect(meData.score).toBe(75);
    });
  });
});
