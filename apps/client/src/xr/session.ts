/**
 * Lifecycle de sessão XR (WebXR).
 *
 * Detecta suporte, requisita uma sessão `immersive-vr` e expõe um
 * pequeno state machine (`idle` → `requesting` → `active` → `ending`).
 *
 * Importante: este módulo NÃO depende do three.js — só usa as APIs
 * DOM nativas (`navigator.xr`, `XRSession`, `XRSystem`). É seguro
 * importar tanto do render path quanto de testes (happy-dom).
 */

import type {} from './types.js';

export type XrSessionState = 'idle' | 'requesting' | 'active' | 'ending';

let sessionState: XrSessionState = 'idle';

export function getSessionState(): XrSessionState {
  return sessionState;
}

function setSessionState(next: XrSessionState): void {
  sessionState = next;
}

/**
 * Detecta se o browser/headset atual suporta uma sessão imersiva VR.
 * Retorna `false` se `navigator.xr` for undefined (desktop comum).
 */
export async function isXrSupported(): Promise<boolean> {
  const xr = (typeof navigator !== 'undefined' ? navigator.xr : undefined) as XRSystem | undefined;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/**
 * Requisita uma sessão `immersive-vr` com referência `local-floor`.
 * Retorna `null` se o browser não suportar XR ou se a requisição falhar.
 */
export async function requestVrSession(): Promise<XRSession | null> {
  const xr = (typeof navigator !== 'undefined' ? navigator.xr : undefined) as XRSystem | undefined;
  if (!xr) return null;
  if (sessionState !== 'idle') return null;

  setSessionState('requesting');
  try {
    const session = await xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
    });
    setSessionState('active');

    // Mantém o state em sincronia com eventos da sessão.
    session.addEventListener('end', () => {
      setSessionState('idle');
    });

    return session;
  } catch {
    setSessionState('idle');
    return null;
  }
}

/**
 * Encerra uma sessão XR. Falhas são silenciosas (o caller pode não
 * ter permissão ou a sessão já pode ter sido encerrada pelo usuário).
 */
export function endSession(session: XRSession): void {
  if (!session) return;
  if (sessionState === 'active' || sessionState === 'requesting') {
    setSessionState('ending');
  }
  try {
    const p = session.end();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => {
        /* silencioso */
      });
    }
  } catch {
    setSessionState('idle');
  }
}

/**
 * Reseta o state machine para `idle`. Útil em testes e em fluxos
 * de recovery quando sabemos que a sessão foi invalidada pelo SO.
 */
export function _resetSessionStateForTests(): void {
  setSessionState('idle');
}
