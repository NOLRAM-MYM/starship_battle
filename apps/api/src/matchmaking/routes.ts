/**
 * Rotas HTTP de matchmaking.
 *
 *   POST   /matchmaking/queue        { mode, partyId? }    -> enqueue
 *   DELETE /matchmaking/queue        ?mode=duel            -> dequeue
 *   GET    /matchmaking/queue?mode=duel                    -> status
 *
 * Party:
 *   POST   /parties                  { }                   -> create
 *   GET    /parties/:id                                   -> get
 *   POST   /parties/:id/join         { username }          -> join
 *   POST   /parties/:id/leave                             -> leave
 *   POST   /parties/:id/ready        { ready }             -> toggle ready
 *   DELETE /parties/:id                                   -> dissolve
 *
 * Auth: todas requerem Bearer token (helper `requireAuth`).
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  createParty,
  deleteParty,
  getParty,
  joinParty,
  leaveParty,
  PartyError,
  setReady,
} from './party.js';
import {
  dequeuePlayer,
  enqueuePlayer,
  isValidMode,
  MatchmakingError,
  TEAM_SIZES,
} from './service.js';
import { getQueueStatus, QueueError } from './queue.js';
import type { GameMode } from './types.js';

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

function partyErrorToHttp(err: PartyError): { status: number; code: string } {
  switch (err.code) {
    case 'not_found': return { status: 404, code: 'party_not_found' };
    case 'full': return { status: 409, code: 'party_full' };
    case 'already_member': return { status: 409, code: 'already_member' };
    case 'not_member': return { status: 403, code: 'not_member' };
    case 'leader_cannot_leave': return { status: 400, code: 'leader_cannot_leave' };
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'not_ready': return { status: 412, code: 'not_ready' };
  }
}

function matchErrorToHttp(err: MatchmakingError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'invalid_mode': return { status: 400, code: 'invalid_mode' };
    case 'party_not_ready': return { status: 412, code: 'party_not_ready' };
    case 'not_found': return { status: 404, code: 'not_found' };
    case 'not_in_queue': return { status: 404, code: 'not_in_queue' };
  }
}

function queueErrorToHttp(err: QueueError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'already_queued': return { status: 409, code: 'already_queued' };
    case 'not_queued': return { status: 404, code: 'not_queued' };
  }
}

export const matchmakingRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  // -------- Party ----------

  app.post('/parties', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const party = await createParty(auth.accountId, auth.username);
      return reply.code(201).send({ party });
    } catch (err) {
      if (err instanceof PartyError) {
        const { status, code } = partyErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/parties/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const party = await getParty(req.params.id);
      if (!party) return reply.code(404).send({ error: 'party_not_found' });
      return { party };
    } catch (err) {
      if (err instanceof PartyError) {
        const { status, code } = partyErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>(
    '/parties/:id/join',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      try {
        const party = await joinParty(req.params.id, auth.accountId, auth.username);
        return { party };
      } catch (err) {
        if (err instanceof PartyError) {
          const { status, code } = partyErrorToHttp(err);
          return reply.code(status).send({ error: code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/parties/:id/leave',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      try {
        const party = await leaveParty(req.params.id, auth.accountId);
        return { party };
      } catch (err) {
        if (err instanceof PartyError) {
          const { status, code } = partyErrorToHttp(err);
          return reply.code(status).send({ error: code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/parties/:id/ready',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      const schema = z.object({ ready: z.boolean() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input' });
      }
      try {
        const party = await setReady(req.params.id, auth.accountId, parsed.data.ready);
        return { party };
      } catch (err) {
        if (err instanceof PartyError) {
          const { status, code } = partyErrorToHttp(err);
          return reply.code(status).send({ error: code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/parties/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      try {
        const party = await getParty(req.params.id);
        if (!party) return reply.code(404).send({ error: 'party_not_found' });
        if (party.leaderAccountId !== auth.accountId) {
          return reply.code(403).send({ error: 'only_leader_can_dissolve' });
        }
        await deleteParty(req.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof PartyError) {
          const { status, code } = partyErrorToHttp(err);
          return reply.code(status).send({ error: code, message: err.message });
        }
        throw err;
      }
    },
  );

  // -------- Queue ----------

  app.post('/matchmaking/queue', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const schema = z.object({
      mode: z.string().refine(isValidMode, 'mode inválido'),
      partyId: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const entry = await enqueuePlayer(
        auth.accountId,
        auth.username,
        parsed.data.mode as GameMode,
        parsed.data.partyId ?? null,
        new Map([[auth.accountId, 1000]]),
      );
      return reply.code(202).send({ entry, teamSize: TEAM_SIZES[parsed.data.mode as GameMode] });
    } catch (err) {
      if (err instanceof MatchmakingError) {
        const { status, code } = matchErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      if (err instanceof QueueError) {
        const { status, code } = queueErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.delete('/matchmaking/queue', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const modeRaw = (req.query as { mode?: string }).mode;
    if (!modeRaw || !isValidMode(modeRaw)) {
      return reply.code(400).send({ error: 'invalid_mode' });
    }
    try {
      const removed = await dequeuePlayer(auth.accountId, modeRaw as GameMode);
      return { removed };
    } catch (err) {
      if (err instanceof MatchmakingError) {
        const { status, code } = matchErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      if (err instanceof QueueError) {
        const { status, code } = queueErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/matchmaking/queue', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const modeRaw = (req.query as { mode?: string }).mode;
    if (!modeRaw || !isValidMode(modeRaw)) {
      return reply.code(400).send({ error: 'invalid_mode' });
    }
    try {
      const status = await getQueueStatus(auth.accountId, modeRaw as GameMode);
      if (!status) return reply.code(404).send({ error: 'not_in_queue' });
      return { status };
    } catch (err) {
      if (err instanceof QueueError) {
        const { status, code } = queueErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });
};
