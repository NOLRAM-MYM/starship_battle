/**
 * Rotas HTTP de progressão.
 *
 *   GET  /progression/me
 *   POST /progression/xp             { amount, source? }
 *   POST /progression/skills/spend   { branch, node }
 *
 * Mesmo padrão de auth/error handling de `economy/routes.ts`.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  addXpService,
  getProgressionService,
  ProgressionError,
  spendSkillService,
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

function progressionErrorToHttp(err: ProgressionError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'invalid_input': return { status: 400, code: 'invalid_input' };
    case 'not_enough_points': return { status: 409, code: 'not_enough_points' };
  }
}

const xpSchema = z.object({
  amount: z.number().int().positive(),
  source: z.string().max(40).optional(),
});

const spendSchema = z.object({
  branch: z.string().min(1).max(40),
  node: z.string().min(1).max(80),
});

export const progressionRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  app.get('/progression/me', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const progression = await getProgressionService(auth.accountId);
      return { progression };
    } catch (err) {
      if (err instanceof ProgressionError) {
        const { status, code } = progressionErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post('/progression/xp', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = xpSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const result = await addXpService(auth.accountId, parsed.data.amount);
      return { result };
    } catch (err) {
      if (err instanceof ProgressionError) {
        const { status, code } = progressionErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.post('/progression/skills/spend', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = spendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      await spendSkillService(auth.accountId, parsed.data.branch, parsed.data.node);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ProgressionError) {
        const { status, code } = progressionErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });
};
