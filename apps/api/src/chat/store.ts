/**
 * Persistência de mensagens em Redis.
 *
 * Estratégia:
 *   - Cada canal é uma LIST `chat:{kind}:{id}`.
 *   - Append via RPUSH; leitura por LRANGE.
 *   - LTRIM mantém últimos N mensagens (200) para evitar unbounded growth.
 *   - TTL 24h aplicado na chave para mensagens expirarem automaticamente.
 *
 * Em dev sem Redis, todas as funções lançam ChatStoreError 'db_unavailable'.
 */

import { getRedis } from '../db/redis.js';
import type { ChatMessage } from './types.js';
import { HISTORY_LIMIT_MAX, MESSAGE_TTL_SEC } from './types.js';

export class ChatStoreError extends Error {
  constructor(
    public readonly code: 'db_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ChatStoreError';
  }
}

function key(kind: string, id: string): string {
  return `chat:${kind}:${id}`;
}

export async function appendMessage(msg: ChatMessage): Promise<void> {
  const r = getRedis();
  if (!r) throw new ChatStoreError('db_unavailable', 'redis indisponível');
  const k = key(msg.channelKind, msg.channelId);
  const payload = JSON.stringify(msg);
  const pipe = r.multi();
  pipe.rpush(k, payload);
  pipe.ltrim(k, -HISTORY_LIMIT_MAX, -1);
  pipe.expire(k, MESSAGE_TTL_SEC);
  await pipe.exec();
}

export async function readMessages(
  kind: string,
  id: string,
  limit: number,
  before?: number,
): Promise<ChatMessage[]> {
  const r = getRedis();
  if (!r) throw new ChatStoreError('db_unavailable', 'redis indisponível');
  const k = key(kind, id);
  // LRANGE 0..-1 e filtra no cliente. Para volumes pequenos (até 200) é OK.
  const raw = await r.lrange(k, 0, -1);
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    try {
      const parsed = JSON.parse(m) as ChatMessage;
      if (typeof before === 'number' && parsed.createdAt >= before) continue;
      messages.push(parsed);
    } catch {
      // ignora
    }
  }
  // Devolve os mais recentes primeiro; trunca por limit.
  messages.sort((a, b) => b.createdAt - a.createdAt);
  return messages.slice(0, Math.max(1, Math.min(limit, HISTORY_LIMIT_MAX)));
}
