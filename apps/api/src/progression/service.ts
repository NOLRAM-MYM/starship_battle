/**
 * Lógica de negócio de progressão.
 *
 * Camada fina sobre o repository: converte erros em códigos HTTP-friendly
 * via `ProgressionError`.
 *
 * `wrap` reaproveita o padrão dos outros módulos (economy/quests).
 */

import {
  addXp as addXpRepo,
  DbUnavailableError,
  InvalidInputError,
  NotEnoughPointsError,
  getProgression as getProgressionRepo,
  spendSkill as spendSkillRepo,
} from './repository.js';
import {
  isValidBranch,
  type AccountProgression,
} from './types.js';
import { findAccountById } from '../auth/repository.js';
import { getRedis } from '../db/redis.js';

export class ProgressionError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'invalid_input'
      | 'not_enough_points',
    message: string,
  ) {
    super(message);
    this.name = 'ProgressionError';
  }
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof DbUnavailableError) {
      throw new ProgressionError('db_unavailable', 'banco indisponível');
    }
    if (err instanceof InvalidInputError) {
      throw new ProgressionError('invalid_input', err.message);
    }
    if (err instanceof NotEnoughPointsError) {
      throw new ProgressionError('not_enough_points', err.message);
    }
    throw err;
  });
}

export interface AddXpResult {
  totalXp: number;
  level: number;
  leveledUp: boolean;
}

export async function getProgressionService(accountId: number): Promise<AccountProgression> {
  return wrap(() => getProgressionRepo(accountId));
}

export async function addXpService(accountId: number, amount: number): Promise<AddXpResult> {
  const result = await wrap(() => addXpRepo(accountId, amount));
  
  try {
    const redis = getRedis();
    if (redis) {
      const account = await findAccountById(accountId);
      if (account) {
        await redis.zincrby('leaderboard:xp', amount, account.username);
      }
    }
  } catch (err) {
    // Falha silenciosa para não quebrar a progressão se o Redis falhar
    console.error('Falha ao sincronizar XP com Redis:', err);
  }

  return result;
}

export async function spendSkillService(
  accountId: number,
  branch: string,
  node: string,
): Promise<void> {
  if (!isValidBranch(branch)) {
    throw new ProgressionError('invalid_input', `branch inválido: ${branch}`);
  }
  if (typeof node !== 'string' || node.length === 0 || node.length > 80) {
    throw new ProgressionError('invalid_input', 'node deve ser string não-vazia');
  }
  return wrap(() => spendSkillRepo(accountId, branch, node));
}
