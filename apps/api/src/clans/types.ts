/**
 * Tipos do módulo de clãs.
 */

export type ClanRole = 'leader' | 'officer' | 'member';

export const ROLE_RANK: Record<ClanRole, number> = {
  leader: 3,
  officer: 2,
  member: 1,
};

export function isRoleAtLeast(role: ClanRole, required: ClanRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export interface Clan {
  id: number;
  name: string;
  tag: string;
  description: string;
  leaderAccountId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClanMember {
  clanId: number;
  accountId: number;
  role: ClanRole;
  joinedAt: Date;
}

export interface ClanInvite {
  id: number;
  clanId: number;
  accountId: number;
  invitedByAccountId: number;
  createdAt: Date;
  expiresAt: Date;
}
