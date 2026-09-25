/**
 * As frotas-padrão têm que voar armadas.
 *
 * Os modelos oferecidos a quem ainda não montou nave usavam ids que não
 * existem (`laser_mk1`, `shield_mk1`, `plasma_cannon`, `shield_heavy`):
 * o servidor ignorava as peças e todo jogador novo decolava só com o
 * motor, sem arma e sem escudo.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PRESET_LOADOUTS } from '../src/persistence/loadoutRepo.js';
import { componentById } from '../src/ui/componentLibrary.js';
import { ARMA_DE_SERVICO, primaryWeapon } from '../src/data/weapons.js';

describe('frotas-padrão', () => {
  it('toda peça existe no catálogo', () => {
    for (const l of DEFAULT_PRESET_LOADOUTS) {
      for (const s of l.slots) {
        expect(componentById(s.templateId), `${l.name}: ${s.templateId}`).toBeDefined();
      }
    }
  });

  it('o nível declarado é o do catálogo', () => {
    for (const l of DEFAULT_PRESET_LOADOUTS) {
      for (const s of l.slots) {
        expect(s.tier, `${l.name}: ${s.templateId}`).toBe(componentById(s.templateId)?.tier);
      }
    }
  });

  it('são um kit inicial: nada acima do nível 2', () => {
    // Uma conta nova começa com zero créditos, então tudo aqui é de
    // graça. Um escudo de nível 4 de brinde tornava a loja dispensável.
    for (const l of DEFAULT_PRESET_LOADOUTS) {
      for (const s of l.slots) {
        expect(componentById(s.templateId)!.tier, `${l.name}: ${s.templateId}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('cada modelo é diferente dos outros', () => {
    // Três modelos idênticos não são escolha nenhuma.
    const assinaturas = DEFAULT_PRESET_LOADOUTS.map((l) =>
      l.slots.map((s) => s.templateId).sort().join(','),
    );
    expect(new Set(assinaturas).size).toBe(DEFAULT_PRESET_LOADOUTS.length);
  });

  it('nenhuma sai com a arma de serviço', () => {
    for (const l of DEFAULT_PRESET_LOADOUTS) {
      const arma = primaryWeapon(l.slots.map((s) => s.templateId));
      expect(arma, l.name).not.toBe(ARMA_DE_SERVICO);
    }
  });
});
