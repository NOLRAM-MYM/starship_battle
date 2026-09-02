/**
 * Testes da Task 5.1 (WebXR / VR session).
 *
 * Três testes mínimos exigidos:
 *  1. `isXrSupported` retorna false quando `navigator.xr` é undefined.
 *  2. ComfortSettings faz roundtrip load/save via `localStorage`.
 *  3. `applySnapTurn` com `snapTurnDegrees=0` faz smoothing;
 *     com 30, snap para múltiplos de 30°.
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
import { isXrSupported, _resetSessionStateForTests } from '../src/xr/session.js';
import {
  loadComfortSettings,
  saveComfortSettings,
  applySnapTurn,
  DEFAULT_COMFORT_SETTINGS,
  type ComfortSettings,
} from '../src/xr/comfort.js';
import { createXrInputState, updateXrInput } from '../src/xr/controllers.js';

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

describe('XR (Task 5.1)', () => {
  beforeEach(() => {
    _resetSessionStateForTests();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('isXrSupported returns false when navigator.xr is undefined', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

    // Stub um navigator SEM `xr` (desktop comum sem WebXR).
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: { userAgent: 'node-test' },
    });

    try {
      const result = await isXrSupported();
      expect(result).toBe(false);
    } finally {
      // Restaura o navigator original.
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalDescriptor);
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  it('ComfortSettings load/save roundtrips', () => {
    const expected: ComfortSettings = {
      snapTurnDegrees: 60,
      vignette: false,
      movementMode: 'dash',
    };
    saveComfortSettings(expected);
    const loaded = loadComfortSettings();
    expect(loaded).toEqual(expected);

    // Sanity: o default só é devolvido se o storage estiver vazio.
    if (typeof localStorage !== 'undefined') localStorage.clear();
    expect(loadComfortSettings()).toEqual(DEFAULT_COMFORT_SETTINGS);
  });

  it('applySnapTurn: smoothing com snapTurnDegrees=0, snap com 30', () => {
    const smoothSettings: ComfortSettings = { ...DEFAULT_COMFORT_SETTINGS, snapTurnDegrees: 0 };
    const snapSettings: ComfortSettings = { ...DEFAULT_COMFORT_SETTINGS, snapTurnDegrees: 30 };

    // 1) Smoothing: currentYaw=0, target=50 → ~5 (10% de 50).
    const smoothed = applySnapTurn(0, 50, smoothSettings);
    expect(Math.abs(smoothed - 5)).toBeLessThan(0.0001);
    // Suavização: o passo de 5° é menor que o target de 50°.
    expect(Math.abs(smoothed)).toBeLessThan(Math.abs(50));

    // 2) Snap 30°: o INCREMENTO (result − currentYaw) é múltiplo de 30.
    const r1 = applySnapTurn(0, 47, snapSettings);
    expect((r1 - 0) % 30).toBe(0);

    const r2 = applySnapTurn(10, 25, snapSettings);
    expect((r2 - 10) % 30).toBe(0);

    const r3 = applySnapTurn(0, 14, snapSettings);
    // diff=14, quantized=0 (round(0.467)=0), result=0
    expect(r3).toBe(0);

    // 3) diff pequeno (< step/2) → sem snap, mantém currentYaw.
    expect(applySnapTurn(42, 50, snapSettings)).toBe(42);

    // 4) Direção negativa preservada (target < currentYaw).
    const r4 = applySnapTurn(0, -47, snapSettings);
    expect(Math.abs((r4 - 0) % 30)).toBe(0);
    expect(r4).toBeLessThan(0);
  });

  it('updateXrInput: sem input sources mantém estado zerado', () => {
    const state = createXrInputState();
    // Sessão mockada sem `inputSources`.
    const fakeSession = { inputSources: { length: 0 } } as unknown as XRSession;
    const fakeFrame = { session: fakeSession } as unknown as XRFrame;
    updateXrInput(state, fakeSession, fakeFrame);
    expect(state.thrust).toBe(0);
    expect(state.steer).toBe(0);
    expect(state.fire).toBe(false);
  });
});
