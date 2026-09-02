/**
 * Rotas HTTP de chat.
 *
 *   GET  /chat/global?limit=50&before=<ts>
 *   POST /chat/global   { text }
 *
 *   GET  /chat/team/:teamId?limit=50&before=<ts>
 *   POST /chat/team/:teamId  { text }
 *
 *   GET  /chat/dm/:peerId?limit=50&before=<ts>
 *   POST /chat/dm/:peerId  { text }
 *
 * Clan chat virá em Task 3.5.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  ChatError,
  dmChannelId,
  listMessages,
  sendMessage,
} from './service.js';
import { ChatStoreError } from './store.js';
import { HISTORY_LIMIT_DEFAULT, HISTORY_LIMIT_MAX } from './types.js';

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

function chatErrorToHttp(err: ChatError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'rate_limited': return { status: 429, code: 'rate_limited' };
    case 'empty_text': return { status: 400, code: 'empty_text' };
    case 'text_too_long': return { status: 400, code: 'text_too_long' };
  }
}

function storeErrorToHttp(err: ChatStoreError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
  }
}

const sendSchema = z.object({
  text: z.string().min(1).max(2000), // server vai trim/limitar; validação grossa aqui
});

function parseListQuery(
  q: Record<string, unknown>,
): { limit: number; before: number | undefined } {
  const limitRaw = Number.parseInt(String(q['limit'] ?? HISTORY_LIMIT_DEFAULT), 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, HISTORY_LIMIT_MAX))
    : HISTORY_LIMIT_DEFAULT;
  const beforeRaw = q['before'];
  let before: number | undefined;
  if (typeof beforeRaw === 'string') {
    const n = Number.parseInt(beforeRaw, 10);
    if (Number.isFinite(n)) before = n;
  }
  return { limit, before };
}

export const chatRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  // -------- Global ----------

  app.get('/chat/global', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const { limit, before } = parseListQuery(req.query as Record<string, unknown>);
    try {
      const messages = await listMessages('global', null, limit, before);
      return { messages };
    } catch (err) {
      if (err instanceof ChatStoreError) {
        const { status, code } = storeErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post('/chat/global', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const msg = await sendMessage('global', null, auth.accountId, auth.username, parsed.data.text);
      return reply.code(201).send({ message: msg });
    } catch (err) {
      if (err instanceof ChatError) {
        const { status, code } = chatErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      if (err instanceof ChatStoreError) {
        const { status, code } = storeErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  // -------- Team ----------

  app.get<{ Params: { teamId: string } }>(
    '/chat/team/:teamId',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      const { limit, before } = parseListQuery(req.query as Record<string, unknown>);
      try {
        const messages = await listMessages('team', req.params.teamId, limit, before);
        return { messages };
      } catch (err) {
        if (err instanceof ChatStoreError) {
          const { status, code } = storeErrorToHttp(err);
          return reply.code(status).send({ error: code });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { teamId: string } }>(
    '/chat/team/:teamId',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      try {
        const msg = await sendMessage('team', req.params.teamId, auth.accountId, auth.username, parsed.data.text);
        return reply.code(201).send({ message: msg });
      } catch (err) {
        if (err instanceof ChatError) {
          const { status, code } = chatErrorToHttp(err);
          return reply.code(status).send({ error: code, message: err.message });
        }
        if (err instanceof ChatStoreError) {
          const { status, code } = storeErrorToHttp(err);
          return reply.code(status).send({ error: code });
        }
        throw err;
      }
    },
  );

  // -------- DM ----------

  app.get<{ Params: { peerId: string } }>(
    '/chat/dm/:peerId',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      const peer = Number.parseInt(req.params.peerId, 10);
      if (!Number.isFinite(peer)) {
        return reply.code(400).send({ error: 'invalid_peer' });
      }
      const { limit, before } = parseListQuery(req.query as Record<string, unknown>);
      try {
        const channel = dmChannelId(auth.accountId, peer);
        const messages = await listMessages('dm', channel, limit, before);
        return { messages };
      } catch (err) {
        if (err instanceof ChatStoreError) {
          const { status, code } = storeErrorToHttp(err);
          return reply.code(status).send({ error: code });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { peerId: string } }>(
    '/chat/dm/:peerId',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      const peer = Number.parseInt(req.params.peerId, 10);
      if (!Number.isFinite(peer)) {
        return reply.code(400).send({ error: 'invalid_peer' });
      }
      if (peer === auth.accountId) {
        return reply.code(400).send({ error: 'cannot_dm_self' });
      }
      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      try {
        const channel = dmChannelId(auth.accountId, peer);
        const msg = await sendMessage('dm', channel, auth.accountId, auth.username, parsed.data.text);
        return reply.code(201).send({ message: msg });
      } catch (err) {
        if (err instanceof ChatError) {
          const { status, code } = chatErrorToHttp(err);
          return reply.code(status).send({ error: code, message: err.message });
        }
        if (err instanceof ChatStoreError) {
          const { status, code } = storeErrorToHttp(err);
          return reply.code(status).send({ error: code });
        }
        throw err;
      }
    },
  );
};
