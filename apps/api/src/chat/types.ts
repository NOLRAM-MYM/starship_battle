/**
 * Tipos do módulo de chat.
 */

export type ChatChannelKind = 'global' | 'team' | 'clan' | 'dm';

export interface ChatMessage {
  /** ID único (snowflake-style ou UUID). */
  id: string;
  channelKind: ChatChannelKind;
  /** ID do canal concreto (teamId, clanId, "global", ou "dm:{a}:{b}"). */
  channelId: string;
  accountId: number;
  username: string;
  /** Texto da mensagem (1..500 chars após sanitização). */
  text: string;
  /** Epoch ms. */
  createdAt: number;
}

export const MAX_TEXT_LEN = 500;
export const MIN_TEXT_LEN = 1;
export const HISTORY_LIMIT_DEFAULT = 50;
export const HISTORY_LIMIT_MAX = 200;
/** TTL em segundos (24h). */
export const MESSAGE_TTL_SEC = 24 * 60 * 60;
