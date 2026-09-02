/**
 * Testes da Task 5.4 (Polish: HUD / Settings / SkillTree).
 *
 * Três testes mínimos exigidos:
 *  1. `loadSettings` retorna defaults quando `localStorage` está vazio.
 *  2. `computeLevel` retorna 1 para xp=0 e 2 para xp=150 (curva 100*1.4^n).
 *  3. `canSpend` retorna true só quando todos os requirements estão em `spent`.
 *
 * Ambiente: `happy-dom` (configurado em `vite.config.ts`).
 *
 * Nota sobre `localStorage`: em algumas versões de happy-dom 15+
 * o global `localStorage` não vem exposto por padrão. Antes de
 * rodar os testes que dependem de storage, instalamos um polyfill
 * via `Window` do próprio happy-dom (zero deps novas).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  loadSettings,
  DEFAULT_CLIENT_SETTINGS,
} from '../src/ui/settings.js';
import { computeLevel } from '../src/hud/Hud.js';
import { canSpend } from '../src/data/skillTree.js';

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const w = new Window();
    const storage = w.localStorage as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: storage,
    });
  }
});

describe('Polish (Task 5.4)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('loadSettings returns defaults when localStorage is empty', () => {
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_CLIENT_SETTINGS);
    // Confere os campos principais explicitamente.
    expect(s.graphics).toBe('high');
    expect(s.audioMaster).toBe(0.8);
    expect(s.audioSfx).toBe(0.8);
    expect(s.audioMusic).toBe(0.6);
    expect(s.sensitivity).toBe(1.0);
    expect(s.invertY).toBe(false);
    expect(s.colorblindMode).toBe('off');
    expect(s.fontScale).toBe(1.0);
  });

  it('computeLevel returns 1 for xp=0 and 2 for xp=150 (curve 100*1.4^n)', () => {
    // xp=0: nem level 1 tem custo pago, então level=1.
    const r0 = computeLevel(0);
    expect(r0.level).toBe(1);
    // xpNext no nível 1 = round(100 * 1.4^0) = 100.
    expect(r0.xpNext).toBe(100);

    // xp=150: paga level 1 (100), mas não level 2 (140 a mais = 240). level=2.
    const r150 = computeLevel(150);
    expect(r150.level).toBe(2);
    // xpNext no nível 2 = round(100 * 1.4^1) = 140.
    expect(r150.xpNext).toBe(140);

    // xp logo abaixo do custo do nível 2 (100+140=240): mantém level=2.
    const r239 = computeLevel(239);
    expect(r239.level).toBe(2);
  });

  it('canSpend returns true only when all requirements are met', () => {
    // T1 (combat_t1) sem requisitos → sempre pode gastar.
    expect(canSpend('combat_t1', new Set())).toBe(true);

    // T2 (combat_t2) requer T1: sem T1 em spent, falha.
    expect(canSpend('combat_t2', new Set())).toBe(false);

    // T2 com T1 em spent: pode gastar.
    expect(canSpend('combat_t2', new Set(['combat_t1']))).toBe(true);

    // T5 (combat_t5) requer cadeia completa: falha com T1 apenas.
    expect(canSpend('combat_t5', new Set(['combat_t1']))).toBe(false);

    // T5 com toda a cadeia (combat_t1..t4): pode gastar.
    expect(
      canSpend('combat_t5', new Set(['combat_t1', 'combat_t2', 'combat_t3', 'combat_t4'])),
    ).toBe(true);

    // Node inexistente: false.
    expect(canSpend('does_not_exist', new Set())).toBe(false);

    // Outras branches: industry_t2 requer industry_t1.
    expect(canSpend('industry_t2', new Set())).toBe(false);
    expect(canSpend('industry_t2', new Set(['industry_t1']))).toBe(true);

    // exploration_t3 requer t1 e t2.
    expect(canSpend('exploration_t3', new Set(['exploration_t1']))).toBe(false);
    expect(canSpend('exploration_t3', new Set(['exploration_t1', 'exploration_t2']))).toBe(true);
  });
});
