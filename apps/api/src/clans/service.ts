/**
 * Lógica de clãs: criação, edição, dissolution, invites, kick, promote.
 */

import {
  addMember,
  countMembers,
  createClan,
  createInvite,
  DbUnavailableError,
  deleteClan,
  deleteInvite,
  findClanById,
  findInvite,
  findMember,
  isUniqueViolation,
  listClans,
  listInvitesForAccount,
  listMembers,
  removeMember,
  updateClan,
} from './repository.js';
import { isRoleAtLeast, type Clan, type ClanRole } from './types.js';

export class ClanError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'invalid_input'
      | 'not_found'
      | 'already_member'
      | 'not_member'
      | 'no_invite'
      | 'invite_expired'
      | 'name_taken'
      | 'tag_taken'
      | 'forbidden'
      | 'leader_cannot_leave'
      | 'cannot_kick_leader'
      | 'cannot_demote_leader'
      | 'cannot_change_leader_role',
    message: string,
  ) {
    super(message);
    this.name = 'ClanError';
  }
}

const TAG_RE = /^[A-Z0-9]{2,6}$/;
const NAME_MIN = 3;
const NAME_MAX = 32;
const MAX_MEMBERS = 50;
const MAX_DESC = 280;

function validateName(name: string): void {
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ClanError('invalid_input', `name entre ${NAME_MIN} e ${NAME_MAX}`);
  }
}

function validateTag(tag: string): void {
  if (!TAG_RE.test(tag)) {
    throw new ClanError(
      'invalid_input',
      'tag deve ter 2-6 chars, A-Z e 0-9',
    );
  }
}

function validateDescription(d: string): void {
  if (d.length > MAX_DESC) {
    throw new ClanError('invalid_input', `description <= ${MAX_DESC} chars`);
  }
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof DbUnavailableError) {
      throw new ClanError('db_unavailable', 'banco indisponível');
    }
    throw err;
  });
}

export async function createClanService(
  name: string,
  tag: string,
  description: string,
  leaderAccountId: number,
): Promise<{ clan: Clan }> {
  validateName(name);
  validateTag(tag);
  validateDescription(description);
  const clan = await wrap(() => createClan(name, tag, description, leaderAccountId));
  await wrap(() => addMember(clan.id, leaderAccountId, 'leader'));
  return { clan };
}

export async function getClanService(
  id: number,
): Promise<{ clan: Clan; members: { accountId: number; role: ClanRole }[] }> {
  const clan = await wrap(() => findClanById(id));
  if (!clan) throw new ClanError('not_found', 'clan não encontrado');
  const members = await wrap(() => listMembers(id));
  return {
    clan,
    members: members.map((m) => ({ accountId: m.accountId, role: m.role })),
  };
}

export async function listClansService(
  query: string | null,
  limit: number,
): Promise<Clan[]> {
  return wrap(() => listClans(query, limit));
}

export async function updateClanService(
  id: number,
  accountId: number,
  fields: { name?: string | undefined; description?: string | undefined },
): Promise<Clan> {
  if (typeof fields.name === 'string') validateName(fields.name);
  if (typeof fields.description === 'string') validateDescription(fields.description);
  const member = await wrap(() => findMember(id, accountId));
  if (!member || member.role !== 'leader') {
    throw new ClanError('forbidden', 'apenas líder pode editar');
  }
  // Constrói objeto apenas com campos definidos para evitar conflito com
  // exactOptionalPropertyTypes no tipo do repository.
  const patch: { name?: string; description?: string } = {};
  if (typeof fields.name === 'string') patch.name = fields.name;
  if (typeof fields.description === 'string') patch.description = fields.description;
  const updated = await wrap(() => updateClan(id, patch));
  if (!updated) throw new ClanError('not_found', 'clan não encontrado');
  return updated;
}

export async function dissolveClanService(
  id: number,
  accountId: number,
): Promise<void> {
  const clan = await wrap(() => findClanById(id));
  if (!clan) throw new ClanError('not_found', 'clan não encontrado');
  if (clan.leaderAccountId !== accountId) {
    throw new ClanError('forbidden', 'apenas líder pode dissolver');
  }
  await wrap(() => deleteClan(id));
}

export async function inviteMemberService(
  clanId: number,
  inviterAccountId: number,
  targetAccountId: number,
): Promise<{ clanId: number; accountId: number; expiresAt: Date }> {
  if (targetAccountId === inviterAccountId) {
    throw new ClanError('invalid_input', 'não pode convidar a si mesmo');
  }
  const member = await wrap(() => findMember(clanId, inviterAccountId));
  if (!member || !isRoleAtLeast(member.role, 'officer')) {
    throw new ClanError('forbidden', 'apenas líder ou officer pode convidar');
  }
  const target = await wrap(() => findMember(clanId, targetAccountId));
  if (target) throw new ClanError('already_member', 'já é membro');
  const count = await wrap(() => countMembers(clanId));
  if (count >= MAX_MEMBERS) {
    throw new ClanError('forbidden', `clan cheio (max ${MAX_MEMBERS})`);
  }
  const invite = await wrap(() => createInvite(clanId, targetAccountId, inviterAccountId));
  return {
    clanId: invite.clanId,
    accountId: invite.accountId,
    expiresAt: invite.expiresAt,
  };
}

export async function cancelInviteService(
  clanId: number,
  requesterAccountId: number,
  targetAccountId: number,
): Promise<void> {
  const member = await wrap(() => findMember(clanId, requesterAccountId));
  if (!member || !isRoleAtLeast(member.role, 'officer')) {
    throw new ClanError('forbidden', 'apenas líder ou officer pode cancelar');
  }
  await wrap(() => deleteInvite(clanId, targetAccountId));
}

export async function acceptInviteService(
  clanId: number,
  accountId: number,
): Promise<{ clanId: number; role: ClanRole }> {
  const invite = await wrap(() => findInvite(clanId, accountId));
  if (!invite) throw new ClanError('no_invite', 'sem invite para este clan');
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new ClanError('invite_expired', 'invite expirado');
  }
  const existing = await wrap(() => findMember(clanId, accountId));
  if (existing) throw new ClanError('already_member', 'já é membro');
  const count = await wrap(() => countMembers(clanId));
  if (count >= MAX_MEMBERS) {
    throw new ClanError('forbidden', 'clan cheio');
  }
  await wrap(() => addMember(clanId, accountId, 'member'));
  await wrap(() => deleteInvite(clanId, accountId));
  return { clanId, role: 'member' };
}

export async function leaveClanService(
  clanId: number,
  accountId: number,
): Promise<void> {
  const member = await wrap(() => findMember(clanId, accountId));
  if (!member) throw new ClanError('not_member', 'não é membro');
  if (member.role === 'leader') {
    throw new ClanError(
      'leader_cannot_leave',
      'líder precisa dissolver ou transferir liderança',
    );
  }
  await wrap(() => removeMember(clanId, accountId));
}

export async function kickMemberService(
  clanId: number,
  requesterAccountId: number,
  targetAccountId: number,
): Promise<void> {
  const requester = await wrap(() => findMember(clanId, requesterAccountId));
  if (!requester || !isRoleAtLeast(requester.role, 'officer')) {
    throw new ClanError('forbidden', 'apenas líder ou officer pode expulsar');
  }
  const target = await wrap(() => findMember(clanId, targetAccountId));
  if (!target) throw new ClanError('not_member', 'alvo não é membro');
  if (target.role === 'leader') {
    throw new ClanError('cannot_kick_leader', 'não pode expulsar líder');
  }
  // Officer só pode expulsar member.
  if (
    requester.role === 'officer' &&
    !isRoleAtLeast(requester.role, target.role)
  ) {
    throw new ClanError('forbidden', 'sem permissão para expulsar este rank');
  }
  await wrap(() => removeMember(clanId, targetAccountId));
}

export async function promoteMemberService(
  clanId: number,
  requesterAccountId: number,
  targetAccountId: number,
  newRole: ClanRole,
): Promise<{ accountId: number; role: ClanRole }> {
  const requester = await wrap(() => findMember(clanId, requesterAccountId));
  if (!requester || requester.role !== 'leader') {
    throw new ClanError('forbidden', 'apenas líder pode promover/rebaixar');
  }
  const target = await wrap(() => findMember(clanId, targetAccountId));
  if (!target) throw new ClanError('not_member', 'alvo não é membro');
  if (target.role === 'leader') {
    throw new ClanError('cannot_demote_leader', 'não pode alterar role do líder');
  }
  if (newRole === 'leader') {
    throw new ClanError(
      'cannot_change_leader_role',
      'use endpoint de transferência de liderança',
    );
  }
  await wrap(() => addMember(clanId, targetAccountId, newRole));
  return { accountId: targetAccountId, role: newRole };
}

export async function listMyInvitesService(
  accountId: number,
): Promise<{ clanId: number; invitedBy: number; expiresAt: Date }[]> {
  const invites = await wrap(() => listInvitesForAccount(accountId));
  return invites.map((i) => ({
    clanId: i.clanId,
    invitedBy: i.invitedByAccountId,
    expiresAt: i.expiresAt,
  }));
}

// Re-exporta isUniqueViolation para tratamento em camadas superiores se necessário.
export { isUniqueViolation };
