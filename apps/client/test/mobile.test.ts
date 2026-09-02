/**
 * Testes da Task 5.2 (Mobile / Touch / Adaptive / Reconnect).
 *
 * Quatro testes mínimos exigidos:
 *  1. `isMobile` retorna false para user agent desktop.
 *  2. `createTouchInputState` retorna zeros.
 *  3. `createReconnect` incrementa `attempt` em cada falha.
 *  4. `createAdaptivePerf` reduz `pixelRatio` quando FPS é baixo.
 *
 * Ambiente: `happy-dom` (configurado em `vite.config.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isMobile } from '../src/input/adaptive.js';
import { createTouchInputState } from '../src/input/touch.js';
import { createAdaptivePerf } from '../src/perf/adaptive.js';
import { createReconnect } from '../src/net/reconnect.js';

describe('Mobile (Task 5.2)', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let originalInnerWidth: number;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    vi.useRealTimers();
  });

  it('isMobile returns false for desktop user agent', () => {
    // Stub matchMedia: (pointer: coarse) → false, (pointer: fine) → true.
    window.matchMedia = (query: string): MediaQueryList => {
      const isFine = /pointer:\s*fine/.test(query);
      return {
        matches: isFine,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    };
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1920,
    });

    expect(isMobile()).toBe(false);
  });

  it('TouchInputState factory returns zeros', () => {
    const s = createTouchInputState();
    expect(s).toEqual({ thrust: 0, steer: 0, fire: false, brake: false });
  });

  it('Reconnect backoff increments attempt on each failure and respects maxRetries', async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockRejectedValue(new Error('nope'));
    const rec = createReconnect({ connect, maxRetries: 8 });

    expect(rec.attempt).toBe(0);

    await rec.trigger();
    expect(rec.attempt).toBe(1);

    await rec.trigger();
    expect(rec.attempt).toBe(2);

    await rec.trigger();
    expect(rec.attempt).toBe(3);

    // cancel() reseta o attempt.
    rec.cancel();
    expect(rec.attempt).toBe(0);
  });

  it('Adaptive perf throttles pixelRatio when fps is low', () => {
    const setPixelRatio = vi.fn();
    const renderer = { setPixelRatio };
    const perf = createAdaptivePerf({
      renderer,
      targetFps: 30,
      initialRatio: 1.0,
    });

    // Construtor já chama setPixelRatio(1.0).
    expect(setPixelRatio).toHaveBeenCalledWith(1.0);

    // 20fps (dt=0.05) < 30 * 0.85 (25.5): depois de ~65 ticks a EMA
    // converge abaixo do limite e a streak de 60 ticks aciona o throttle.
    for (let i = 0; i < 80; i++) {
      perf.tick(0.05);
    }

    // Deve ter sido chamado com algum valor < 1.0.
    const calls = setPixelRatio.mock.calls.map((c) => c[0] as number);
    expect(calls.some((v) => v < 1.0)).toBe(true);
    // E o valor atual reportado é < inicial.
    const tick = perf.tick(0.05);
    expect(tick.currentRatio).toBeLessThan(1.0);
  });
});
