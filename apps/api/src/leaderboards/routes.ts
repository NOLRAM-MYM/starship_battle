import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  submitScore,
  getLeaderboard,
  getPlayerRank,
  LeaderboardError,
} from './service.js';

interface AuthContext {
  accountId: number;
  username: string;
}

function requireAuth(req: FastifyRequest): AuthContext | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload) return null;
  const id = Number.parseInt(payload.sub, 10);
  if (!Number.isFinite(id)) return null;
  return { accountId: id, username: payload.username };
}

function leaderboardErrorToHttp(err: LeaderboardError): { status: number; code: string } {
  switch (err.code) {
    case 'redis_unavailable': return { status: 503, code: 'redis_unavailable' };
    case 'invalid_input': return { status: 400, code: 'invalid_input' };
    default: return { status: 500, code: 'internal_error' };
  }
}

const scoreSchema = z.object({
  score: z.number().nonnegative(),
});

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const leaderboardRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Params: { boardId: string } }>('/leaderboards/:boardId/score', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }

    try {
      await submitScore(req.params.boardId, auth.accountId, parsed.data.score);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LeaderboardError) {
        const { status, code } = leaderboardErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { boardId: string }; Querystring: { limit?: number } }>('/leaderboards/:boardId', async (req, reply) => {
    const parsedQuery = limitSchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }

    try {
      const leaderboard = await getLeaderboard(req.params.boardId, parsedQuery.data.limit);
      return { leaderboard };
    } catch (err) {
      if (err instanceof LeaderboardError) {
        const { status, code } = leaderboardErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { boardId: string } }>('/leaderboards/:boardId/me', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    try {
      const data = await getPlayerRank(req.params.boardId, auth.accountId);
      return data;
    } catch (err) {
      if (err instanceof LeaderboardError) {
        const { status, code } = leaderboardErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });
};
