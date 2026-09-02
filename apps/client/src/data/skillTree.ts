/**
 * Skill tree — versão tipada em cima do JSON estático.
 *
 *   - `skillTree`            : árvore completa importada do JSON.
 *   - `canSpend`             : valida se `nodeId` pode ser gasto
 *                              (todos os `requires` já estão em `spent`).
 *   - `maxSpendablePoints`   : total de pontos disponíveis para um
 *                              `level` dado. 1 ponto por nível acima de 1.
 *
 * O JSON é a fonte da verdade; este módulo apenas re-exporta os
 * dados estáticos + helpers puros, sem dependência de DOM.
 */

import tree from './skillTree.json';

export interface SkillNode {
  id: string;
  name: string;
  description: string;
  requires: string[];
}

export interface SkillBranch {
  id: string;
  name: string;
  nodes: SkillNode[];
}

export interface SkillTree {
  version: number;
  branches: SkillBranch[];
}

export const skillTree: SkillTree = tree as SkillTree;

const NODE_INDEX: Map<string, SkillNode> = (() => {
  const m = new Map<string, SkillNode>();
  for (const b of skillTree.branches) {
    for (const n of b.nodes) m.set(n.id, n);
  }
  return m;
})();

/** Lista plana de node ids (todos os branches). */
export const ALL_SKILL_NODE_IDS: string[] = Array.from(NODE_INDEX.keys());

/** True se `nodeId` existe e todos os seus `requires` estão em `spent`. */
export function canSpend(nodeId: string, spent: Set<string>): boolean {
  const node = NODE_INDEX.get(nodeId);
  if (!node) return false;
  for (const req of node.requires) {
    if (!spent.has(req)) return false;
  }
  return true;
}

/** Pontos gastáveis máximos = level - 1. Nunca negativo. */
export function maxSpendablePoints(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.floor(level) - 1);
}
