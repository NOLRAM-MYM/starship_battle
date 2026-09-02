/**
 * Party (grupo pré-formado) em Redis.
 *
 * Estrutura:
 *   HASH `mm:party:{id}` com campos:
 *     - id, leaderId, createdAt, members (JSON), ready (boolean)
 *
 * Limite: 5 membros (suficiente para 5v5).
 */

import { randomUUID } from 'node:crypto';
import { getRedis } from '../db/redis.js';
import type { Party, PartyMember } from './types.js';

export class PartyError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'not_found'
      | 'full'
      | 'already_member'
      | 'not_member'
      | 'leader_cannot_leave'
      | 'not_ready',
    message: string,
  ) {
    super(message);
    this.name = 'PartyError';
  }
}

const MAX_MEMBERS = 5;

function key(id: string): string {
  return `mm:party:${id}`;
}

export async function createParty(
  leaderId: number,
  leaderUsername: string,
): Promise<Party> {
  const r = getRedis();
  if (!r) throw new PartyError('db_unavailable', 'redis indisponível');
  const id = randomUUID();
  const party: Party = {
    id,
    leaderAccountId: leaderId,
    members: [
      {
        accountId: leaderId,
        username: leaderUsername,
        ready: false,
        joinedAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    allReady: false,
  };
  await r.hset(key(id), {
    id: party.id,
    leaderId: String(party.leaderAccountId),
    createdAt: String(party.createdAt),
    members: JSON.stringify(party.members),
  });
  return party;
}

function rowToParty(row: Record<string, string>): Party | null {
  if (!row['id'] || !row['leaderId'] || !row['members']) return null;
  let members: PartyMember[] = [];
  try {
    members = JSON.parse(row['members']) as PartyMember[];
  } catch {
    members = [];
  }
  return {
    id: row['id'],
    leaderAccountId: Number.parseInt(row['leaderId'], 10),
    members,
    createdAt: Number.parseInt(row['createdAt'] ?? '0', 10),
    allReady:
      members.length > 0 && members.every((m) => m.ready),
  };
}

export async function getParty(id: string): Promise<Party | null> {
  const r = getRedis();
  if (!r) throw new PartyError('db_unavailable', 'redis indisponível');
  const row = await r.hgetall(key(id));
  if (!row || Object.keys(row).length === 0) return null;
  return rowToParty(row);
}

export async function updateParty(party: Party): Promise<void> {
  const r = getRedis();
  if (!r) throw new PartyError('db_unavailable', 'redis indisponível');
  await r.hset(key(party.id), {
    members: JSON.stringify(party.members),
  });
}

export async function deleteParty(id: string): Promise<void> {
  const r = getRedis();
  if (!r) throw new PartyError('db_unavailable', 'redis indisponível');
  await r.del(key(id));
}

export async function joinParty(
  id: string,
  accountId: number,
  username: string,
): Promise<Party> {
  const party = await getParty(id);
  if (!party) throw new PartyError('not_found', 'party não encontrada');
  if (party.members.length >= MAX_MEMBERS) {
    throw new PartyError('full', 'party cheia');
  }
  if (party.members.some((m) => m.accountId === accountId)) {
    throw new PartyError('already_member', 'já é membro da party');
  }
  party.members.push({
    accountId,
    username,
    ready: false,
    joinedAt: Date.now(),
  });
  party.allReady = false;
  await updateParty(party);
  return party;
}

export async function leaveParty(
  id: string,
  accountId: number,
): Promise<Party | null> {
  const party = await getParty(id);
  if (!party) throw new PartyError('not_found', 'party não encontrada');
  if (accountId === party.leaderAccountId) {
    throw new PartyError(
      'leader_cannot_leave',
      'líder precisa dissolver a party',
    );
  }
  if (!party.members.some((m) => m.accountId === accountId)) {
    throw new PartyError('not_member', 'não é membro da party');
  }
  party.members = party.members.filter((m) => m.accountId !== accountId);
  party.allReady =
    party.members.length > 0 && party.members.every((m) => m.ready);
  await updateParty(party);
  return party;
}

export async function setReady(
  id: string,
  accountId: number,
  ready: boolean,
): Promise<Party> {
  const party = await getParty(id);
  if (!party) throw new PartyError('not_found', 'party não encontrada');
  const member = party.members.find((m) => m.accountId === accountId);
  if (!member) throw new PartyError('not_member', 'não é membro da party');
  member.ready = ready;
  party.allReady = party.members.every((m) => m.ready);
  await updateParty(party);
  return party;
}
