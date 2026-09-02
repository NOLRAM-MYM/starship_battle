/**
 * Rotas HTTP de missões.
 *
 *   GET    /quests                  - lista templates disponíveis
 *   GET    /quests/:id              - detalhes de um template
 *   POST   /quests/:id/accept       - aceita uma missão
 *   GET    /quests/instances        - missões aceitas pelo jogador
 *   GET    /quests/instances/:id    - detalhes de uma instância
 *   POST   /quests/instances/:id/abandon
 *   POST   /quests/instances/progress   { templateId, objectiveId, amount } - interno/admin
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  abandonQuestService,
  acceptQuestService,
  applyProgressService,
  findTemplateService,
  getInstanceService,
  listInstancesService,
  listTemplatesService,
  QuestError,
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

function questErrorToHttp(err: QuestError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'template_not_found': return { status: 404, code: 'template_not_found' };
    case 'instance_not_found': return { status: 404, code: 'instance_not_found' };
    case 'invalid_state': return { status: 409, code: 'invalid_state' };
    case 'conflict': return { status: 409, code: 'conflict' };
    case 'invalid_input': return { status: 400, code: 'invalid_input' };
  }
}

const progressSchema = z.object({
  templateId: z.string().min(1).max(80),
  objectiveId: z.string().min(1).max(80),
  amount: z.number().int().positive(),
});

export const questRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/quests', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const templates = await listTemplatesService();
      return { templates };
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/quests/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const tpl = await findTemplateService(req.params.id);
      if (!tpl) return reply.code(404).send({ error: 'template_not_found' });
      return { template: tpl };
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/quests/:id/accept', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const inst = await acceptQuestService(auth.accountId, req.params.id);
      return reply.code(201).send({ instance: inst });
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/quests/instances', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const q = req.query as { status?: string };
    try {
      const instances = await listInstancesService(
        auth.accountId,
        (q.status as never) ?? undefined,
      );
      return { instances };
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/quests/instances/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const inst = await getInstanceService(id);
      if (!inst) return reply.code(404).send({ error: 'instance_not_found' });
      if (inst.accountId !== auth.accountId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return { instance: inst };
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/quests/instances/:id/abandon', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      await abandonQuestService(auth.accountId, id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  // Endpoint de progress: espera-se que venha de um sistema confiável
  // (game-server ou webhook interno). Mantido com auth por simplicidade;
  // pode-se proteger com role-based no futuro.
  app.post('/quests/instances/progress', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const inst = await applyProgressService({
        accountId: auth.accountId,
        templateId: parsed.data.templateId,
        objectiveId: parsed.data.objectiveId,
        amount: parsed.data.amount,
      });
      return { instance: inst };
    } catch (err) {
      if (err instanceof QuestError) {
        const { status, code } = questErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });
};
