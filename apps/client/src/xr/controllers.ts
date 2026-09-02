/**
 * Abstração de input XR (WebXR Input Sources).
 *
 * Mapeia o(s) XRInputSource(s) ativos em uma `XRSession` para o
 * mesmo `XrInputState` que o InputController de teclado usa:
 *
 *   - botões primários (trigger[0] OU squeeze[1]) → `fire`
 *   - analógico primário (axes[0] = steer, axes[1] = thrust)
 *
 * Se a sessão não tiver input sources, mantém o estado zerado.
 *
 * Importante: NÃO depende do three.js — só tipos DOM (`XRSession`,
 * `XRFrame`, `XRInputSource`).
 */

import type {} from './types.js';

export interface XrInputState {
  thrust: number; // -1..1 (eixo y do analógico)
  steer: number; // -1..1 (eixo x do analógico)
  fire: boolean;
}

export function createXrInputState(): XrInputState {
  return { thrust: 0, steer: 0, fire: false };
}

const TRIGGER_BUTTON_INDEX = 0;
const SQUEEZE_BUTTON_INDEX = 1;
const AXIS_X_INDEX = 0;
const AXIS_Y_INDEX = 1;

/**
 * Atualiza `state` lendo os `inputSources` da sessão XR. Deve ser
 * chamado a cada `XRFrame` (uma vez por frame de animação).
 */
export function updateXrInput(state: XrInputState, session: XRSession, _frame: XRFrame): void {
  const sources = session.inputSources;
  if (!sources || sources.length === 0) {
    state.thrust = 0;
    state.steer = 0;
    state.fire = false;
    return;
  }

  let thrust = 0;
  let steer = 0;
  let fire = false;

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!src) continue;

    // Botões primários: trigger[0] e squeeze/grip[1].
    const gp = src.gamepad;
    if (gp) {
      const trigger = gp.buttons[TRIGGER_BUTTON_INDEX];
      const squeeze = gp.buttons[SQUEEZE_BUTTON_INDEX];
      if (trigger && trigger.pressed) fire = true;
      if (squeeze && squeeze.pressed) fire = true;

      // Eixo analógico primário: x = steer, y = thrust.
      const ax = gp.axes;
      if (ax.length >= 2) {
        const x = ax[AXIS_X_INDEX] ?? 0;
        const y = ax[AXIS_Y_INDEX] ?? 0;
        // Se houver mais de um controller, o "primário" é o primeiro
        // com input não-zero. Para simplicidade, somamos (com clamp)
        // — funciona bem para thumbsticks simétricos.
        steer = clamp(steer + x, -1, 1);
        thrust = clamp(thrust + y, -1, 1);
      }
    }
  }

  state.thrust = thrust;
  state.steer = steer;
  state.fire = fire;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
