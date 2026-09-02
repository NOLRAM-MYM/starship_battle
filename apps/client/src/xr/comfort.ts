/**
 * Comfort settings para VR.
 *
 * - `snapTurnDegrees`: 0 (smooth) | 30 | 60 | 90 (snap por增量).
 * - `vignette`: ativa vignette de movimento (placeholder, sem shader).
 * - `movementMode`: 'smooth' (contínuo) | 'dash' (discreto).
 *
 * Persistência: `localStorage` com schema versionado `batle.xr.comfort.v1`.
 * Falhas de IO são silenciosas (modo privado, quota cheia, SSR, ...).
 */

export type SnapTurnDegrees = 0 | 30 | 60 | 90;
export type MovementMode = 'smooth' | 'dash';

export interface ComfortSettings {
  snapTurnDegrees: SnapTurnDegrees;
  vignette: boolean;
  movementMode: MovementMode;
}

export const DEFAULT_COMFORT_SETTINGS: ComfortSettings = {
  snapTurnDegrees: 30,
  vignette: true,
  movementMode: 'smooth',
};

const STORAGE_KEY = 'batle.xr.comfort.v1';

function isSnapTurnDegrees(v: unknown): v is SnapTurnDegrees {
  return v === 0 || v === 30 || v === 60 || v === 90;
}

function isMovementMode(v: unknown): v is MovementMode {
  return v === 'smooth' || v === 'dash';
}

function isComfortSettings(v: unknown): v is ComfortSettings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isSnapTurnDegrees(o['snapTurnDegrees']) &&
    typeof o['vignette'] === 'boolean' &&
    isMovementMode(o['movementMode'])
  );
}

export function loadComfortSettings(): ComfortSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_COMFORT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COMFORT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (isComfortSettings(parsed)) return { ...parsed };
    return { ...DEFAULT_COMFORT_SETTINGS };
  } catch {
    return { ...DEFAULT_COMFORT_SETTINGS };
  }
}

export function saveComfortSettings(s: ComfortSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* silencioso */
  }
}

/**
 * Aplica snap-turn ou smoothing entre `currentYaw` e `target`.
 *
 * - Se `settings.snapTurnDegrees > 0`: arredonda a diferença para o
 *   múltiplo mais próximo de `snapTurnDegrees` e adiciona ao current.
 *   O snap é incremental (não absoluto) para evitar teleporte de yaw.
 * - Caso contrário: retorna `currentYaw + (target - currentYaw) * 0.1`
 *   (smoothing exponencial simples).
 *
 * Yaw é tratado em graus.
 */
export function applySnapTurn(currentYaw: number, target: number, settings: ComfortSettings): number {
  if (settings.snapTurnDegrees > 0) {
    const step = settings.snapTurnDegrees;
    const diff = target - currentYaw;
    // Quantiza a diferença para o múltiplo mais próximo de `step`,
    // sem jamais dar salto maior que `step` (evita rotação total).
    const quantized = Math.round(diff / step) * step;
    return currentYaw + quantized;
  }
  return currentYaw + (target - currentYaw) * 0.1;
}
