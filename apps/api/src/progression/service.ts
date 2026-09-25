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
      | 'not_enough_points'
      | 'rate_limited',
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

/**
 * Maior ganho que um único pedido pode trazer.
 *
 * O prêmio legítimo mais alto é o abate de uma nave pesada com todos os
 * bônus: 250 + 50 (longa distância) + 75 (casco crítico) = 375.
 *
 * Esta rota nasceu como ferramenta de depuração e aceitava QUALQUER
 * inteiro positivo de qualquer conta autenticada: um único pedido com
 * `amount: 2000000000` dava nível máximo e o topo do ranking. Quando o
 * cliente passou a gravar o XP do combate por ela, a porta dos fundos
 * virou a porta da frente.
 */
export const MAX_XP_POR_PEDIDO = 400;

/**
 * Teto de XP por conta a cada minuto.
 *
 * Acima do ritmo mais alto que o jogo consegue produzir, com folga: não
 * atrapalha quem joga e limita quem forja pedidos a um ritmo em que o
 * ranking continua significando algo.
 *
 * É mitigação, não autenticação. O XP chega aqui pelo cliente, e o
 * cliente pode mentir dentro do teto. A solução completa é o servidor
 * de jogo — que é quem sabe o que aconteceu — assinar ou gravar os
 * ganhos ele mesmo.
 *
 * Em memória, como o limitador do chat: com várias réplicas da API o
 * teto vale por réplica.
 */
export const ORCAMENTO_XP_POR_MINUTO = 3000;
const JANELA_MS = 60_000;
const orcamentos = new Map<number, { inicio: number; gasto: number }>();

/** Desconta `amount` do orçamento da conta; `false` se estourou. */
export function consumirOrcamentoDeXp(accountId: number, amount: number, agora = Date.now()): boolean {
  const atual = orcamentos.get(accountId);
  const janela =
    atual && agora - atual.inicio < JANELA_MS ? atual : { inicio: agora, gasto: 0 };
  if (janela.gasto + amount > ORCAMENTO_XP_POR_MINUTO) {
    orcamentos.set(accountId, janela);
    return false;
  }
  janela.gasto += amount;
  orcamentos.set(accountId, janela);
  return true;
}

/** Só para testes. */
export function _resetOrcamentosDeXp(): void {
  orcamentos.clear();
}

export async function addXpService(accountId: number, amount: number): Promise<AddXpResult> {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_XP_POR_PEDIDO) {
    throw new ProgressionError('invalid_input', `amount deve estar entre 1 e ${MAX_XP_POR_PEDIDO}`);
  }
  if (!consumirOrcamentoDeXp(accountId, amount)) {
    throw new ProgressionError('rate_limited', 'ganho de XP acima do ritmo permitido');
  }
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
