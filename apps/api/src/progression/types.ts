/**
 * Tipos do módulo de progressão.
 *
 *   - AccountProgression : projeção agregada da conta (xp + skills gastas).
 *   - SpendRequest       : body de POST /progression/skills/spend.
 *   - XpGainRequest      : body de POST /progression/xp (debug/admin).
 */

export interface AccountProgression {
  accountId: number;
  totalXp: number;
  level: number;
  spentPoints: number;
  availablePoints: number;
  skills: Array<{ branch: string; node: string; level: number }>;
}

export interface SpendRequest {
  branch: string;
  node: string;
}

export interface XpGainRequest {
  amount: number;
  source?: string;
}

export const VALID_BRANCHES = ['combat', 'industry', 'exploration'] as const;
export type SkillBranch = (typeof VALID_BRANCHES)[number];

export function isValidBranch(s: string): s is SkillBranch {
  return (VALID_BRANCHES as readonly string[]).includes(s);
}

/** Curva de XP — espelha o cliente: `xpNext(level) = round(100 * 1.4^level)`. */
export function xpNextFor(level: number): number {
  if (level < 0) return 100;
  return Math.round(100 * Math.pow(1.4, level));
}

/** Pontos gastáveis = level - 1. */
export function maxSpendablePoints(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.floor(level) - 1);
}

/** Calcula o level a partir de xp total. */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) return 1;
  let level = 1;
  let cumulative = 0;
  for (let n = 0; n < 200; n += 1) {
    const cost = xpNextFor(n);
    if (cumulative + cost > xp) {
      level = n + 1;
      break;
    }
    cumulative += cost;
    level = n + 2;
  }
  return level;
}
