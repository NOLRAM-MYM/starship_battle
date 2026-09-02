/**
 * Cliente NATS singleton. Em dev/test, se NATS_URL não estiver setada, fica inativo.
 */

import { connect } from 'nats';
import type { NatsConnection } from 'nats';
import { loadConfig } from '../config.js';

let nc: NatsConnection | null = null;

export async function getNats(): Promise<NatsConnection | null> {
  if (nc) return nc;
  const url = loadConfig().natsUrl;
  if (!url) return null;
  nc = await connect({ servers: url });
  return nc;
}

export async function closeNats(): Promise<void> {
  if (nc) {
    await nc.close();
    nc = null;
  }
}

export async function pingNats(): Promise<boolean> {
  try {
    const c = await getNats();
    return c !== null && !c.isClosed();
  } catch {
    return false;
  }
}
