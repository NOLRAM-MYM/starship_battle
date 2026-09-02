/**
 * Rotas HTTP de loadouts.
 *
 *   POST   /loadouts            { name, data }
 *   GET    /loadouts
 *   GET    /loadouts/:id
 *   PATCH  /loadouts/:id        { name?, data? }
 *   DELETE /loadouts/:id
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  LoadoutError,
  createLoadoutService,
  deleteLoadoutService,
  getLoadoutService,
  isUniqueViolation,
  listLoadoutsService,
  updateLoadoutService,
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

function loadoutErrorToHttp(err: LoadoutError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'not_found': return { status: 404, code: 'not_found' };
    case 'forbidden': return { status: 403, code: 'forbidden' };
    default: return { status: 400, code: err.code };
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(64),
  data: z.record(z.any()).default({}),
});

const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  data: z.record(z.any()).optional(),
});

export const loadoutRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/loadouts', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }

    try {
      const loadout = await createLoadoutService(
        auth.accountId,
        parsed.data.name,
        parsed.data.data
      );
      return reply.code(201).send({ loadout });
    } catch (err) {
      if (err instanceof LoadoutError) {
        const { status, code } = loadoutErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'name_taken' });
      }
      throw err;
    }
  });

  app.get('/loadouts', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    try {
      const loadouts = await listLoadoutsService(auth.accountId);
      return { loadouts };
    } catch (err) {
      if (err instanceof LoadoutError) {
        const { status, code } = loadoutErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/loadouts/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }

    try {
      const loadout = await getLoadoutService(id, auth.accountId);
      return { loadout };
    } catch (err) {
      if (err instanceof LoadoutError) {
        const { status, code } = loadoutErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/loadouts/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });

    try {
      // `exactOptionalPropertyTypes`: montamos o patch só com as chaves
      // realmente enviadas, em vez de passar `{ name: undefined }`.
      const patch: { name?: string; data?: Record<string, unknown> } = {};
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.data !== undefined) patch.data = parsed.data.data;
      const loadout = await updateLoadoutService(id, auth.accountId, patch);
      return { loadout };
    } catch (err) {
      if (err instanceof LoadoutError) {
        const { status, code } = loadoutErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'name_taken' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/loadouts/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }

    try {
      await deleteLoadoutService(id, auth.accountId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof LoadoutError) {
        const { status, code } = loadoutErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });
};
