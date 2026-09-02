/**
 * Repositório de clãs no Postgres.
 */

import { getPool } from '../db/postgres.js';
import type { Clan, ClanMember, ClanInvite, ClanRole } from './types.js';

export class DbUnavailableError extends Error {
  constructor() {
    super('Database indisponível');
    this.name = 'DbUnavailableError';
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

export async function createClan(
  name: string,
  tag: string,
  description: string,
  leaderAccountId: number,
): Promise<Clan> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Clan>(
    `INSERT INTO clans (name, tag, description, leader_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id,
               name,
               tag,
               description,
               leader_id AS "leaderAccountId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [name, tag, description, leaderAccountId],
  );
  const row = r.rows[0];
  if (!row) throw new Error('Falha ao criar clan: nenhum row retornado');
  return row;
}

export async function findClanById(id: number): Promise<Clan | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<Clan>(
    `SELECT id, name, tag, description,
            leader_id AS "leaderAccountId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM clans WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function listClans(query: string | null, limit: number): Promise<Clan[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const lim = Math.max(1, Math.min(limit, 100));
  if (query && query.length > 0) {
    const r = await pool.query<Clan>(
      `SELECT id, name, tag, description,
              leader_id AS "leaderAccountId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM clans
       WHERE lower(name) LIKE '%' || lower($1) || '%' OR lower(tag) LIKE '%' || lower($1) || '%'
       ORDER BY name
       LIMIT $2`,
      [query, lim],
    );
    return r.rows;
  }
  const r = await pool.query<Clan>(
    `SELECT id, name, tag, description,
            leader_id AS "leaderAccountId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM clans ORDER BY name LIMIT $1`,
    [lim],
  );
  return r.rows;
}

export async function updateClan(
  id: number,
  fields: { name?: string; description?: string },
): Promise<Clan | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (typeof fields.name === 'string') {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (typeof fields.description === 'string') {
    sets.push(`description = $${i++}`);
    params.push(fields.description);
  }
  if (sets.length === 0) return findClanById(id);
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const r = await pool.query<Clan>(
    `UPDATE clans SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING id, name, tag, description,
               leader_id AS "leaderAccountId",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    params,
  );
  return r.rows[0] ?? null;
}

export async function deleteClan(id: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query(`DELETE FROM clans WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ---------- Members ----------

export async function addMember(
  clanId: number,
  accountId: number,
  role: ClanRole,
): Promise<ClanMember> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<ClanMember>(
    `INSERT INTO clan_members (clan_id, account_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (clan_id, account_id) DO UPDATE SET role = $3
     RETURNING clan_id AS "clanId", account_id AS "accountId",
               role, joined_at AS "joinedAt"`,
    [clanId, accountId, role],
  );
  const row = r.rows[0];
  if (!row) throw new Error('Falha ao adicionar membro');
  return row;
}

export async function findMember(
  clanId: number,
  accountId: number,
): Promise<ClanMember | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<ClanMember>(
    `SELECT clan_id AS "clanId", account_id AS "accountId",
            role, joined_at AS "joinedAt"
     FROM clan_members WHERE clan_id = $1 AND account_id = $2 LIMIT 1`,
    [clanId, accountId],
  );
  return r.rows[0] ?? null;
}

export async function listMembers(clanId: number): Promise<ClanMember[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<ClanMember>(
    `SELECT clan_id AS "clanId", account_id AS "accountId",
            role, joined_at AS "joinedAt"
     FROM clan_members WHERE clan_id = $1 ORDER BY joined_at`,
    [clanId],
  );
  return r.rows;
}

export async function removeMember(
  clanId: number,
  accountId: number,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query(
    `DELETE FROM clan_members WHERE clan_id = $1 AND account_id = $2`,
    [clanId, accountId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function countMembers(clanId: number): Promise<number> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM clan_members WHERE clan_id = $1`,
    [clanId],
  );
  return Number.parseInt(r.rows[0]?.count ?? '0', 10);
}

// ---------- Invites ----------

export async function createInvite(
  clanId: number,
  accountId: number,
  invitedBy: number,
): Promise<ClanInvite> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<ClanInvite>(
    `INSERT INTO clan_invites (clan_id, account_id, invited_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (clan_id, account_id) DO UPDATE
       SET invited_by = $3, expires_at = NOW() + INTERVAL '7 days'
     RETURNING id,
               clan_id AS "clanId",
               account_id AS "accountId",
               invited_by AS "invitedByAccountId",
               created_at AS "createdAt",
               expires_at AS "expiresAt"`,
    [clanId, accountId, invitedBy],
  );
  const row = r.rows[0];
  if (!row) throw new Error('Falha ao criar invite');
  return row;
}

export async function findInvite(
  clanId: number,
  accountId: number,
): Promise<ClanInvite | null> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<ClanInvite>(
    `SELECT id,
            clan_id AS "clanId",
            account_id AS "accountId",
            invited_by AS "invitedByAccountId",
            created_at AS "createdAt",
            expires_at AS "expiresAt"
     FROM clan_invites WHERE clan_id = $1 AND account_id = $2 LIMIT 1`,
    [clanId, accountId],
  );
  return r.rows[0] ?? null;
}

export async function deleteInvite(
  clanId: number,
  accountId: number,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query(
    `DELETE FROM clan_invites WHERE clan_id = $1 AND account_id = $2`,
    [clanId, accountId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listInvitesForAccount(
  accountId: number,
): Promise<ClanInvite[]> {
  const pool = getPool();
  if (!pool) throw new DbUnavailableError();
  const r = await pool.query<ClanInvite>(
    `SELECT id,
            clan_id AS "clanId",
            account_id AS "accountId",
            invited_by AS "invitedByAccountId",
            created_at AS "createdAt",
            expires_at AS "expiresAt"
     FROM clan_invites
     WHERE account_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [accountId],
  );
  return r.rows;
}
