/**
 * Performance adaptativo: ajusta `pixelRatio` do renderer conforme
 * o FPS observado.
 *
 * Estratégia:
 *  - Mantém um EMA do FPS (alpha 0.1).
 *  - Se FPS_ema < targetFps * 0.85 sustentado por 60 ticks:
 *    reduz `pixelRatio` em 0.1 (mínimo 0.5).
 *  - Se FPS_ema > targetFps * 1.15 sustentado por 60 ticks:
 *    aumenta `pixelRatio` em 0.1 (máximo 2.0).
 *
 * A função `tick(dt)` é chamada a cada frame pelo loop principal e
 * devolve o estado atual para inspeção/testes.
 */

export interface AdaptivePerfOpts {
  renderer: { setPixelRatio: (n: number) => void };
  targetFps: number;
  initialRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  emaAlpha?: number;
  windowTicks?: number;
}

export interface AdaptivePerfTick {
  currentScale: number;
  currentRatio: number;
}

export interface AdaptivePerfHandle {
  tick(dt: number): AdaptivePerfTick;
}

export function createAdaptivePerf(opts: AdaptivePerfOpts): AdaptivePerfHandle {
  const minRatio = opts.minRatio ?? 0.5;
  const maxRatio = opts.maxRatio ?? 2.0;
  const emaAlpha = opts.emaAlpha ?? 0.1;
  const windowTicks = opts.windowTicks ?? 60;
  let currentRatio = clamp(opts.initialRatio ?? 1.0, minRatio, maxRatio);
  // Inicializa o renderer no valor atual.
  opts.renderer.setPixelRatio(currentRatio);

  let emaFps = opts.targetFps;
  let belowStreak = 0;
  let aboveStreak = 0;

  return {
    tick(dt: number): AdaptivePerfTick {
      // dt em segundos; protege contra 0.
      const safeDt = dt > 0 ? dt : 1 / opts.targetFps;
      const instantFps = 1 / safeDt;
      emaFps = emaAlpha * instantFps + (1 - emaAlpha) * emaFps;

      const lowerBound = opts.targetFps * 0.85;
      const upperBound = opts.targetFps * 1.15;

      if (emaFps < lowerBound) {
        belowStreak += 1;
        aboveStreak = 0;
      } else if (emaFps > upperBound) {
        aboveStreak += 1;
        belowStreak = 0;
      } else {
        belowStreak = 0;
        aboveStreak = 0;
      }

      if (belowStreak >= windowTicks && currentRatio > minRatio) {
        const next = Math.max(minRatio, round1(currentRatio - 0.1));
        if (next !== currentRatio) {
          currentRatio = next;
          opts.renderer.setPixelRatio(currentRatio);
        }
        belowStreak = 0;
      } else if (aboveStreak >= windowTicks && currentRatio < maxRatio) {
        const next = Math.min(maxRatio, round1(currentRatio + 0.1));
        if (next !== currentRatio) {
          currentRatio = next;
          opts.renderer.setPixelRatio(currentRatio);
        }
        aboveStreak = 0;
      }

      return { currentScale: emaFps, currentRatio };
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
