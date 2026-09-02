/**
 * Cliente Redis singleton. Em dev/test, se REDIS_URL não estiver setada, fica inativo.
 */

import { Redis } from 'ioredis';
import { loadConfig } from '../config.js';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  const url = loadConfig().redisUrl;
  if (!url) return null;
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

export async function pingRedis(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    if (r.status === 'wait' || r.status === 'end') {
      await r.connect();
    }
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
