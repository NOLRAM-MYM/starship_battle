/**
 * Fila de matchmaking em Redis.
 *
 * Estratégia:
 *   - ZSET `mm:queue:{mode}` indexado por skill (float).
 *   - Member = JSON serializado de QueueEntry (id + accountIds + enqueuedAt).
 *   - Worker faz ZRANGEBYSCORE dentro de uma janela de skill crescente
 *     conforme o tempo passa (relaxamento).
 *
 * Decisões de design:
 *   - Separação por mode: filas independentes evitam misturar duels com 5v5.
 *   - JSON member: pequeno overhead mas mantém atomicidade (não há race
 *     entre HSET e ZADD).
 */

import { getRedis } from '../db/redis.js';
import type { GameMode, QueueEntry } from './types.js';

export class QueueError extends Error {
  constructor(
    public readonly code: 'db_unavailable' | 'already_queued' | 'not_queued',
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

function key(mode: GameMode): string {
  return `mm:queue:${mode}`;
}

export async function enqueue(entry: QueueEntry): Promise<void> {
  const r = getRedis();
  if (!r) throw new QueueError('db_unavailable', 'redis indisponível');
  // Garante que a entry não está duplicada (id == partyId ou accountId).
  const member = JSON.stringify(entry);
  const existing = await r.zscore(key(entry.mode), member);
  if (existing !== null) {
    throw new QueueError('already_queued', 'já está na fila');
  }
  await r.zadd(key(entry.mode), entry.skill, member);
}

export async function dequeue(entry: QueueEntry): Promise<boolean> {
  const r = getRedis();
  if (!r) throw new QueueError('db_unavailable', 'redis indisponível');
  const removed = await r.zrem(key(entry.mode), JSON.stringify(entry));
  return removed === 1;
}

/**
 * Remove todas as entries que contenham este accountId.
 * Usado quando o cliente desconecta sem chamar DELETE /matchmaking/queue.
 */
export async function removeByAccountId(
  accountId: number,
): Promise<number> {
  const r = getRedis();
  if (!r) throw new QueueError('db_unavailable', 'redis indisponível');
  const modes: GameMode[] = ['duel', 'team_2v2', 'team_5v5', 'free_for_all'];
  let removed = 0;
  for (const mode of modes) {
    const members = await r.zrange(key(mode), 0, -1);
    for (const m of members) {
      try {
        const e = JSON.parse(m) as QueueEntry;
        if (e.accountIds.includes(accountId)) {
          await r.zrem(key(mode), m);
          removed++;
        }
      } catch {
        // member malformado — ignora
      }
    }
  }
  return removed;
}

export interface QueueStatus {
  mode: GameMode;
  size: number;
  position: number;
  enqueuedAt: number;
  skill: number;
}

export async function getQueueStatus(
  accountId: number,
  mode: GameMode,
): Promise<QueueStatus | null> {
  const r = getRedis();
  if (!r) throw new QueueError('db_unavailable', 'redis indisponível');
  const members = await r.zrange(key(mode), 0, -1, 'WITHSCORES');
  for (let i = 0; i < members.length; i += 2) {
    const m = members[i];
    if (m === undefined) continue;
    try {
      const e = JSON.parse(m) as QueueEntry;
      if (e.accountIds.includes(accountId)) {
        const size = members.length / 2;
        return {
          mode,
          size,
          position: i / 2,
          enqueuedAt: e.enqueuedAt,
          skill: e.skill,
        };
      }
    } catch {
      // ignora
    }
  }
  return null;
}

/**
 * Snapshot da fila (para worker de match).
 */
export async function snapshotQueue(mode: GameMode): Promise<QueueEntry[]> {
  const r = getRedis();
  if (!r) throw new QueueError('db_unavailable', 'redis indisponível');
  const members = await r.zrange(key(mode), 0, -1);
  const out: QueueEntry[] = [];
  for (const m of members) {
    try {
      out.push(JSON.parse(m) as QueueEntry);
    } catch {
      // ignora
    }
  }
  return out;
}
