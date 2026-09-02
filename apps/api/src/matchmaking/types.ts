/**
 * Tipos compartilhados do módulo de matchmaking.
 */

export type GameMode = 'duel' | 'team_2v2' | 'team_5v5' | 'free_for_all';

export interface Party {
  id: string;
  leaderAccountId: number;
  members: PartyMember[];
  createdAt: number;
  /** Quando todos os membros estão ready, party pode entrar na fila. */
  allReady: boolean;
}

export interface PartyMember {
  accountId: number;
  username: string;
  /** True se o membro confirmou ready. */
  ready: boolean;
  /** Timestamp de quando entrou. */
  joinedAt: number;
}

export interface QueueEntry {
  /** Identificador único (partyId ou soloAccountId). */
  id: string;
  /** Account IDs que serão alocados juntos. */
  accountIds: number[];
  mode: GameMode;
  /** Skill rating (média do party). */
  skill: number;
  /** Epoch ms quando entrou na fila. */
  enqueuedAt: number;
}

export interface MatchResult {
  matchId: string;
  mode: GameMode;
  /** Account IDs alocados. */
  accountIds: number[];
  /** URL do game server alocado (WebSocket). */
  gameServerUrl: string;
  /** Token de match para o cliente conectar. */
  matchToken: string;
}
