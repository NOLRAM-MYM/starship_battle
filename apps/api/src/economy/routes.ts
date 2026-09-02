/**
 * Rotas HTTP de economia.
 *
 *   GET  /economy/wallet
 *   POST /economy/transfer  { toAccountId, currency, amount, refType?, refId? }
 *   GET  /economy/transactions?limit=20
 *   GET  /economy/items
 *   GET  /economy/shop
 *   POST /economy/shop/buy  { itemId, quantity }
 *   GET  /economy/inventory
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyToken } from '../auth/tokens.js';
import {
  buyItemService,
  EconomyError,
  getWalletService,
  listInventoryService,
  listItemsService,
  listShopService,
  listTransactionsService,
  transferService,
} from './service.js';
import { isValidCurrency } from './types.js';

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

function economyErrorToHttp(err: EconomyError): { status: number; code: string } {
  switch (err.code) {
    case 'db_unavailable': return { status: 503, code: 'db_unavailable' };
    case 'insufficient_funds': return { status: 402, code: 'insufficient_funds' };
    case 'invalid_input': return { status: 400, code: 'invalid_input' };
    case 'item_not_found': return { status: 404, code: 'item_not_found' };
    case 'item_not_in_shop': return { status: 404, code: 'item_not_in_shop' };
    case 'out_of_stock': return { status: 409, code: 'out_of_stock' };
    case 'self_transfer': return { status: 400, code: 'self_transfer' };
  }
}

const transferSchema = z.object({
  toAccountId: z.number().int().positive(),
  currency: z.string().refine(isValidCurrency, 'currency inválida'),
  amount: z.number().int().positive(),
  refType: z.string().max(40).optional(),
  refId: z.string().max(80).optional(),
});

const buySchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

export const economyRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  app.get('/economy/wallet', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const wallet = await getWalletService(auth.accountId);
      return { wallet };
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post('/economy/transfer', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const tx = await transferService({
        fromAccountId: auth.accountId,
        toAccountId: parsed.data.toAccountId,
        currency: parsed.data.currency,
        amount: parsed.data.amount,
        reason: 'transfer',
        refType: parsed.data.refType,
        refId: parsed.data.refId,
      });
      return reply.code(201).send({ transaction: tx });
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/economy/transactions', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number.parseInt(q.limit, 10) : 20;
    try {
      const transactions = await listTransactionsService(
        auth.accountId,
        Number.isFinite(limit) ? limit : 20,
      );
      return { transactions };
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get('/economy/items', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const items = await listItemsService();
      return { items };
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.get('/economy/shop', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const shop = await listShopService();
      return { shop };
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });

  app.post('/economy/shop/buy', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = buySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const tx = await buyItemService(
        auth.accountId,
        parsed.data.itemId,
        parsed.data.quantity,
      );
      return reply.code(201).send({ transaction: tx });
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/economy/inventory', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const inventory = await listInventoryService(auth.accountId);
      return { inventory };
    } catch (err) {
      if (err instanceof EconomyError) {
        const { status, code } = economyErrorToHttp(err);
        return reply.code(status).send({ error: code });
      }
      throw err;
    }
  });
};
