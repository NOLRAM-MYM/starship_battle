/**
 * Lógica de chat: sanitização, rate limiting, persistência, publicação.
 *
 * Rate limit:
 *   - In-process: Map<accountId, lastSendTs>
 *   - Em prod, mover para Redis com TTL (Task 3.4.x).
 *
 * Sanitização:
 *   - Strip whitespace.
 *   - Limita a MAX_TEXT_LEN.
 *   - Rejeita empty.
 */

import { randomUUID } from 'node:crypto';
import { appendMessage, readMessages } from './store.js';
import { publishMessage } from './publish.js';
import type { ChatChannelKind, ChatMessage } from './types.js';
import { MAX_TEXT_LEN, MIN_TEXT_LEN } from './types.js';

export class ChatError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'rate_limited'
      | 'empty_text'
      | 'text_too_long',
    message: string,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

/** Janela de rate limit: 1 mensagem a cada 500ms por usuário. */
const RATE_LIMIT_MS = 500;
const rateLimitMap = new Map<number, number>();

export function sanitizeText(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function makeChannelId(kind: ChatChannelKind, id: string | null): string {
  if (kind === 'global') return 'global';
  if (id === null) throw new ChatError('empty_text', 'channelId obrigatório');
  return id;
}

export async function sendMessage(
  kind: ChatChannelKind,
  channelIdInput: string | null,
  accountId: number,
  username: string,
  text: string,
): Promise<ChatMessage> {
  const clean = sanitizeText(text);
  if (clean.length < MIN_TEXT_LEN) {
    throw new ChatError('empty_text', 'texto vazio');
  }
  if (clean.length > MAX_TEXT_LEN) {
    throw new ChatError('text_too_long', `texto > ${MAX_TEXT_LEN} chars`);
  }
  const last = rateLimitMap.get(accountId) ?? 0;
  const now = Date.now();
  if (now - last < RATE_LIMIT_MS) {
    throw new ChatError('rate_limited', 'aguarde antes de enviar outra mensagem');
  }
  rateLimitMap.set(accountId, now);

  const channelId = makeChannelId(kind, channelIdInput);
  const msg: ChatMessage = {
    id: randomUUID(),
    channelKind: kind,
    channelId,
    accountId,
    username,
    text: clean,
    createdAt: now,
  };
  await appendMessage(msg);
  await publishMessage(msg);
  return msg;
}

export async function listMessages(
  kind: ChatChannelKind,
  channelIdInput: string | null,
  limit: number,
  before?: number,
): Promise<ChatMessage[]> {
  const channelId = makeChannelId(kind, channelIdInput);
  return readMessages(kind, channelId, limit, before);
}

/** Constrói channelId determinístico para DM (ordem lexicográfica). */
export function dmChannelId(a: number, b: number): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${x}:${y}`;
}

/** Limpa estado in-process (rate limit). Apenas para testes. */
export function __resetChatStateForTests(): void {
  rateLimitMap.clear();
}
