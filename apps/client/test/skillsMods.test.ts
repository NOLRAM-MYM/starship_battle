/**
 * Modificadores de skill no cliente.
 *
 * O hangar precisa ANTECIPAR o que o servidor vai calcular. Se os dois
 * lados divergirem, o painel promete um DPS e a arena entrega outro —
 * o pior tipo de bug, porque nada quebra: só fica errado.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyModsToStats,
  combatMods,
  combatNodeIds,
  hasEffect,
  NO_MODS,
} from '../src/data/skills.js';

describe('combatMods', () => {
  it('sem nós não muda nada', () => {
    expect(combatMods([])).toEqual(NO_MODS);
    expect(hasEffect(NO_MODS)).toBe(false);
  });

  it('ignora nós desconhecidos', () => {
    expect(combatMods(['nao_existe'])).toEqual(NO_MODS);
  });

  it('multiplicadores compõem por multiplicação, não soma', () => {
    // 1.05 * 1.15 = 1.2075. Somar daria 1.20 e, num ramo longo, builds
    // degeneradas.
    const m = combatMods(['combat_t1', 'combat_t3']);
    expect(m.damageMult).toBeCloseTo(1.05 * 1.15, 6);
  });

  it('perfuração soma mas não passa de 1', () => {
    const m = combatMods(Array(30).fill('combat_t4'));
    expect(m.shieldPierce).toBeLessThanOrEqual(1);
    expect(m.shieldPierce).toBeGreaterThan(0.9);
  });
});

describe('applyModsToStats', () => {
  const base = { damage: 100, fireRate: 2, dps: 200 };

  it('sem skills os números não mudam', () => {
    expect(applyModsToStats(base, NO_MODS)).toEqual(base);
  });

  it('dps recalcula de dano × cadência, somando os dois bônus', () => {
    // O erro a evitar: multiplicar só o dps pelo ganho de dano, o que
    // perderia o ganho de cadência.
    const m = combatMods(['combat_t1', 'combat_t2']);
    const s = applyModsToStats(base, m);
    expect(s.dps).toBeCloseTo(100 * 1.05 * (2 * 1.1), 1);
    expect(s.dps).toBeGreaterThan(base.dps * 1.05);
  });

  it('não muda campos fora do combate', () => {
    const comMassa = { ...base, mass: 900 };
    const s = applyModsToStats(comMassa, combatMods(['combat_t1']));
    expect(s.mass).toBe(900);
  });
});

describe('paridade com os efeitos do servidor', () => {
  // Gerado por `cargo test -p game-server --lib skill_fixture`.
  const FIXTURE = join(process.cwd(), 'src/net/__fixtures__/skills.json');

  it('a fixture existe', () => {
    expect(existsSync(FIXTURE), 'gere com `cargo test -p game-server --lib skill_fixture`').toBe(
      true,
    );
  });

  it('cada nó tem o mesmo efeito nos dois lados', () => {
    const servidor: Record<string, Record<string, number>> = JSON.parse(
      readFileSync(FIXTURE, 'utf8'),
    );
    for (const [id, esperado] of Object.entries(servidor)) {
      const m = combatMods([id]);
      expect(m.damageMult, `${id}: dano`).toBeCloseTo(esperado.damageMult!, 6);
      expect(m.fireRateMult, `${id}: cadência`).toBeCloseTo(esperado.fireRateMult!, 6);
      expect(m.shieldPierce, `${id}: perfuração`).toBeCloseTo(esperado.shieldPierce!, 6);
      expect(m.chargeTimeMult, `${id}: tempo de carga`).toBeCloseTo(esperado.chargeTimeMult!, 6);
    }
  });

  it('o cliente não conhece nós de combate que o servidor ignora', () => {
    const servidor = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    for (const id of combatNodeIds()) {
      expect(Object.keys(servidor), `${id} só existe no cliente`).toContain(id);
    }
  });
});
