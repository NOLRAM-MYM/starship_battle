/**
 * Matchmaking service: combina entries da fila em matches.
 *
 * Algoritmo (skill-based com relaxamento por tempo):
 *   1. Snapshot da fila.
 *   2. Para cada entry, calcula janela de skill aceitável:
 *      ±100 rating * (1 + 0.5 * minutos_em_espera)
 *   3. Procura combinação de N entries compatíveis (N depende do mode).
 *   4. Quando acha, gera matchId, aloca game server (round-robin em prod),
 *      publica evento em NATS para o game server aceitar a conexão.
 *
 * Em dev sem NATS/Redis, este módulo expõe apenas a lógica de scoring
 * pura (pura função, testável).
 */

import { randomUUID } from 'node:crypto';
import { enqueue, dequeue, snapshotQueue, removeByAccountId } from './queue.js';
import { getParty } from './party.js';
import { getNats } from '../chat/nats.js';
import { loadConfig } from '../config.js';
import type {
  GameMode,
  MatchResult,
  Party,
  QueueEntry,
} from './types.js';

export class MatchmakingError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'invalid_mode'
      | 'party_not_ready'
      | 'not_found'
      | 'not_in_queue',
    message: string,
  ) {
    super(message);
    this.name = 'MatchmakingError';
  }
}

export const TEAM_SIZES: Record<GameMode, number> = {
  duel: 2,
  team_2v2: 4,
  team_5v5: 10,
  free_for_all: 8,
};

export function isValidMode(s: string): s is GameMode {
  return s in TEAM_SIZES;
}

/** Calcula janela de skill em torno do anchor com relaxamento. */
export function skillWindow(
  anchor: number,
  waitMs: number,
): { min: number; max: number } {
  const minutes = waitMs / 60_000;
  const radius = 100 * (1 + 0.5 * minutes);
  return { min: anchor - radius, max: anchor + radius };
}

/** Calcula skill média de um party. */
export function partyAverageSkill(party: Party, accountSkills: Map<number, number>): number {
  if (party.members.length === 0) return 1000;
  let sum = 0;
  let n = 0;
  for (const m of party.members) {
    const s = accountSkills.get(m.accountId);
    if (typeof s === 'number') {
      sum += s;
      n++;
    }
  }
  return n > 0 ? sum / n : 1000;
}

/** Tenta encontrar N entries compatíveis (skill dentro da janela). */
export function findCompatible(
  pool: readonly QueueEntry[],
  teamSize: number,
  waitMs: number,
  now: number,
): { picked: QueueEntry[]; remaining: QueueEntry[] } {
  const picked: QueueEntry[] = [];
  const remaining: QueueEntry[] = [];
  // Ordena por tempo de espera (mais antigos primeiro — FIFO com relaxamento).
  const sorted = [...pool].sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  for (const entry of sorted) {
    if (picked.length >= teamSize) {
      remaining.push(entry);
      continue;
    }
    const wait = now - entry.enqueuedAt;
    const w = skillWindow(entry.skill, wait);
    // Verifica compatibilidade com todos os já escolhidos.
    const compatible = picked.every(
      (p) => p.skill >= w.min && p.skill <= w.max,
    );
    if (compatible && picked.length + 1 <= teamSize) {
      picked.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  return { picked, remaining };
}

/** Constrói a MatchResult a partir de entries escolhidas. */
export function buildMatchResult(
  picked: QueueEntry[],
  mode: GameMode,
): MatchResult {
  const config = loadConfig();
  const matchId = randomUUID();
  const accountIds: number[] = [];
  for (const e of picked) {
    for (const id of e.accountIds) accountIds.push(id);
  }
  return {
    matchId,
    mode,
    accountIds,
    gameServerUrl: config.gameServerUrl,
    matchToken: matchId, // em prod: JWT específico do match
  };
}

/** Publica match via NATS para o game server aceitar. */
export async function publishMatch(result: MatchResult): Promise<boolean> {
  const nc = await getNats();
  if (!nc) return false;
  const subject = `match.found.${result.mode}`;
  await nc.publish(subject, JSON.stringify(result));
  return true;
}

/** API de alto nível: enfileira player (solo ou party). */
export async function enqueuePlayer(
  accountId: number,
  username: string,
  mode: GameMode,
  partyId: string | null,
  accountSkills: Map<number, number>,
): Promise<QueueEntry> {
  let entry: QueueEntry;
  if (partyId) {
    const party = await getParty(partyId);
    if (!party) throw new MatchmakingError('not_found', 'party não encontrada');
    if (!party.allReady) {
      throw new MatchmakingError('party_not_ready', 'party não está ready');
    }
    if (!party.members.some((m) => m.accountId === accountId)) {
      throw new MatchmakingError('not_found', 'conta não pertence à party');
    }
    const skill = partyAverageSkill(party, accountSkills);
    entry = {
      id: party.id,
      accountIds: party.members.map((m) => m.accountId),
      mode,
      skill,
      enqueuedAt: Date.now(),
    };
  } else {
    const skill = accountSkills.get(accountId) ?? 1000;
    entry = {
      id: `solo:${accountId}`,
      accountIds: [accountId],
      mode,
      skill,
      enqueuedAt: Date.now(),
    };
  }
  await enqueue(entry);
  return entry;
}

export async function dequeuePlayer(
  accountId: number,
  mode: GameMode,
): Promise<boolean> {
  // Procura uma entry que contenha este accountId.
  const pool = await snapshotQueue(mode);
  const entry = pool.find((e) => e.accountIds.includes(accountId));
  if (!entry) throw new MatchmakingError('not_in_queue', 'não está na fila');
  return dequeue(entry);
}

export async function leaveAllQueues(accountId: number): Promise<number> {
  return removeByAccountId(accountId);
}
