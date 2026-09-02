/**
 * Lógica de negócios de loadouts.
 */

import {
  createLoadout,
  deleteLoadout,
  DbUnavailableError,
  findLoadoutById,
  isUniqueViolation,
  listLoadoutsForAccount,
  updateLoadout,
} from './repository.js';
import type { Loadout } from './types.js';

export { isUniqueViolation };

export class LoadoutError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'LoadoutError';
  }
}

export async function createLoadoutService(
  accountId: number,
  name: string,
  data: Record<string, any>
): Promise<Loadout> {
  try {
    return await createLoadout(accountId, name, data);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      throw new LoadoutError('db_unavailable', 'Database is unavailable');
    }
    throw err;
  }
}

export async function getLoadoutService(
  id: number,
  accountId: number
): Promise<Loadout> {
  let loadout: Loadout | null;
  try {
    loadout = await findLoadoutById(id);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      throw new LoadoutError('db_unavailable', 'Database is unavailable');
    }
    throw err;
  }

  if (!loadout) {
    throw new LoadoutError('not_found', 'Loadout not found');
  }
  // `account_id` é BIGINT e o driver `pg` devolve BIGINT como STRING
  // (para não perder precisão além de 2^53). A comparação estrita
  // `"5" !== 5` era sempre verdadeira, então GET/:id, PATCH e DELETE
  // respondiam `forbidden` para o próprio dono — excluir um layout no
  // hangar simplesmente não funcionava.
  if (Number(loadout.accountId) !== Number(accountId)) {
    throw new LoadoutError('forbidden', 'You do not own this loadout');
  }

  return loadout;
}

export async function listLoadoutsService(accountId: number): Promise<Loadout[]> {
  try {
    return await listLoadoutsForAccount(accountId);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      throw new LoadoutError('db_unavailable', 'Database is unavailable');
    }
    throw err;
  }
}

export async function updateLoadoutService(
  id: number,
  accountId: number,
  fields: { name?: string; data?: Record<string, any> }
): Promise<Loadout> {
  const loadout = await getLoadoutService(id, accountId);

  try {
    const updated = await updateLoadout(loadout.id, fields);
    if (!updated) {
      throw new LoadoutError('not_found', 'Loadout not found');
    }
    return updated;
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      throw new LoadoutError('db_unavailable', 'Database is unavailable');
    }
    throw err;
  }
}

export async function deleteLoadoutService(
  id: number,
  accountId: number
): Promise<void> {
  const loadout = await getLoadoutService(id, accountId);

  try {
    await deleteLoadout(loadout.id);
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      throw new LoadoutError('db_unavailable', 'Database is unavailable');
    }
    throw err;
  }
}
