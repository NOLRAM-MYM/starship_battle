/**
 * Publicação de mensagens via NATS.
 *
 * Subjects:
 *   chat.global
 *   chat.team.{teamId}
 *   chat.clan.{clanId}
 *   chat.dm.{accountA}:{accountB}   (ordem lexicográfica)
 *
 * Cada instância da API subscribe e re-emite via SSE/WebSocket para
 * clientes conectados. Aqui só publicamos.
 */

import { getNats } from './nats.js';
import type { ChatMessage } from './types.js';

export function subjectFor(msg: ChatMessage): string {
  switch (msg.channelKind) {
    case 'global':
      return 'chat.global';
    case 'team':
      return `chat.team.${msg.channelId}`;
    case 'clan':
      return `chat.clan.${msg.channelId}`;
    case 'dm': {
      const [a, b] = msg.channelId.split(':');
      return `chat.dm.${a}:${b}`;
    }
  }
}

export async function publishMessage(msg: ChatMessage): Promise<boolean> {
  const nc = await getNats();
  if (!nc) return false;
  const subject = subjectFor(msg);
  await nc.publish(subject, JSON.stringify(msg));
  return true;
}
