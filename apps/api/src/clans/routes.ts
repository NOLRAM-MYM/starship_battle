/**
 * Rotas HTTP de clãs.
 *
 *   POST   /clans                 { name, tag, description? }
 *   GET    /clans?query=&limit=
 *   GET    /clans/:id
 *   PATCH  /clans/:id             { name?, description? }
 *   DELETE /clans/:id
 *
 *   POST   /clans/:id/invites     { accountId }
 *   DELETE /clans/:id/invites/:accountId
 *   POST   /clans/:id/join                       (aceita invite)
 *   POST   /clans/:id/leave
 *   POST   /clans/:id/kick        { accountId }
 *   POST   /clans/:id/promote     { accountId, role }
 *
 *   GET    /clans/me/invites
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  acceptInviteService,
  cancelInviteService,
  ClanError,
  createClanService,
  dissolveClanService,
  getClanService,
  inviteMemberService,
  isUniqueViolation,
  kickMemberService,
  leaveClanService,
  listClansService,
  listMyInvitesService,
  promoteMemberService,
  updateClanService,
} from './service.js';
import type { ClanRole } from './types.js';

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

function clanErrorToHttp(err: ClanError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'invalid_input': return { status: 400, code: 'invalid_input' };
    case 'not_found': return { status: 404, code: 'not_found' };
    case 'already_member': return { status: 409, code: 'already_member' };
    case 'not_member': return { status: 403, code: 'not_member' };
    case 'no_invite': return { status: 404, code: 'no_invite' };
    case 'invite_expired': return { status: 410, code: 'invite_expired' };
    case 'name_taken':
    case 'tag_taken': return { status: 409, code: err.code };
    case 'forbidden': return { status: 403, code: 'forbidden' };
    case 'leader_cannot_leave': return { status: 400, code: 'leader_cannot_leave' };
    case 'cannot_kick_leader': return { status: 400, code: 'cannot_kick_leader' };
    case 'cannot_demote_leader': return { status: 400, code: 'cannot_demote_leader' };
    case 'cannot_change_leader_role': return { status: 400, code: 'cannot_change_leader_role' };
  }
}

const createSchema = z.object({
  name: z.string().min(3).max(32),
  tag: z.string().regex(/^[A-Z0-9]{2,6}$/, 'tag: 2-6 chars A-Z0-9'),
  description: z.string().max(280).optional().default(''),
});

const updateSchema = z.object({
  name: z.string().min(3).max(32).optional(),
  description: z.string().max(280).optional(),
});

const promoteSchema = z.object({
  accountId: z.number().int().positive(),
  role: z.enum(['officer', 'member']),
});

const inviteSchema = z.object({
  accountId: z.number().int().positive(),
});

const kickSchema = z.object({
  accountId: z.number().int().positive(),
});

export const clanRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  app.post('/clans', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const result = await createClanService(
        parsed.data.name,
        parsed.data.tag.toUpperCase(),
        parsed.data.description,
        auth.accountId,
      );
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'name_or_tag_taken' });
      }
      throw err;
    }
  });

  app.get('/clans', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const q = req.query as { query?: string; limit?: string };
    const limit = q.limit ? Number.parseInt(q.limit, 10) : 50;
    const query = typeof q.query === 'string' ? q.query : null;
    try {
      const clans = await listClansService(query, Number.isFinite(limit) ? limit : 50);
      return { clans };
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/clans/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    try {
      return await getClanService(id);
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/clans/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const clan = await updateClanService(id, auth.accountId, parsed.data);
      return { clan };
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/clans/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    try {
      await dissolveClanService(id, auth.accountId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  // -------- Members ----------

  app.post<{ Params: { id: string } }>('/clans/:id/invites', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const result = await inviteMemberService(
        id,
        auth.accountId,
        parsed.data.accountId,
      );
      return reply.code(201).send({ invite: result });
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string; accountId: string } }>(
    '/clans/:id/invites/:accountId',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });
      const id = Number.parseInt(req.params.id, 10);
      const accountId = Number.parseInt(req.params.accountId, 10);
      if (!Number.isFinite(id) || !Number.isFinite(accountId)) {
        return reply.code(400).send({ error: 'invalid_id' });
      }
      try {
        await cancelInviteService(id, auth.accountId, accountId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ClanError) {
          const { status, code } = clanErrorToHttp(err);
          return reply.code(status).send({ error: code });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>('/clans/:id/join', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    try {
      return await acceptInviteService(id, auth.accountId);
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/clans/:id/leave', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    try {
      await leaveClanService(id, auth.accountId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/clans/:id/kick', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const parsed = kickSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await kickMemberService(id, auth.accountId, parsed.data.accountId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/clans/:id/promote', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const result = await promoteMemberService(
        id,
        auth.accountId,
        parsed.data.accountId,
        parsed.data.role as ClanRole,
      );
      return result;
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get('/clans/me/invites', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const invites = await listMyInvitesService(auth.accountId);
      return { invites };
    } catch (err) {
      if (err instanceof ClanError) {
        const { status, code } = clanErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });
};
