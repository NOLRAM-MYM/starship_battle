/**
 * Skills que saem do cliente para o servidor de jogo.
 *
 * A árvore era decorativa: os nós ficavam no banco, a interface
 * anunciava "+5% weapon damage", e nada chegava à simulação. Estes
 * testes cobrem a ponta do cliente — o que é enviado no `Join`.
 */

import { describe, it, expect } from 'vitest';
import { skillNodeIds, type Progression } from '../src/net/progressionApi.js';

const base = (skills: Progression['skills']): Progression => ({
  level: 5,
  totalXp: 1000,
  availablePoints: 0,
  skills,
});

describe('skillNodeIds', () => {
  it('sem progressão devolve lista vazia', () => {
    // API fora do ar não pode impedir de voar.
    expect(skillNodeIds(null)).toEqual([]);
  });

  it('devolve os ids dos nós comprados', () => {
    const ids = skillNodeIds(
      base([
        { branch: 'combat', node: 'combat_t1', level: 1 },
        { branch: 'combat', node: 'combat_t2', level: 1 },
      ]),
    );
    expect(ids).toEqual(['combat_t1', 'combat_t2']);
  });

  it('nó comprado várias vezes entra repetido', () => {
    // O servidor acumula por repetição; enviar uma vez só daria ao
    // jogador menos do que ele pagou.
    const ids = skillNodeIds(base([{ branch: 'combat', node: 'combat_t1', level: 3 }]));
    expect(ids).toEqual(['combat_t1', 'combat_t1', 'combat_t1']);
  });

  it('nível zero ou negativo ainda conta uma vez', () => {
    // Linha corrompida no banco não pode sumir com a skill comprada.
    expect(skillNodeIds(base([{ branch: 'combat', node: 'combat_t1', level: 0 }]))).toEqual([
      'combat_t1',
    ]);
  });

  it('sem skills compradas devolve vazio', () => {
    expect(skillNodeIds(base([]))).toEqual([]);
  });

  it('objeto sem o array de skills não estoura', () => {
    // A API embrulha em `{ progression: ... }`; ler o nível errado
    // devolvia um objeto sem `skills` e quebrava o lançamento inteiro
    // com "p.skills is not iterable".
    const torto = { level: 1, totalXp: 0, availablePoints: 0 } as unknown as Progression;
    expect(() => skillNodeIds(torto)).not.toThrow();
    expect(skillNodeIds(torto)).toEqual([]);
  });
});
