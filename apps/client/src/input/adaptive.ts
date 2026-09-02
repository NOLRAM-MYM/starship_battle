/**
 * Detecção de classe de dispositivo (mobile / tablet / desktop).
 *
 * Critério primário: `matchMedia('(pointer: coarse)').matches` indica
 * touch primário. Combinado com a largura da viewport, classificamos:
 *  - < 768px  → mobile
 *  - 768..1024 → tablet
 *  - demais   → desktop
 */

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

const MOBILE_MAX_WIDTH = 768;
const TABLET_MAX_WIDTH = 1024;

export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return coarse && window.innerWidth < MOBILE_MAX_WIDTH;
}

export function isTablet(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return (
    coarse &&
    window.innerWidth >= MOBILE_MAX_WIDTH &&
    window.innerWidth < TABLET_MAX_WIDTH
  );
}

export function isDesktop(): boolean {
  return !isMobile() && !isTablet();
}

export function getDeviceClass(): DeviceClass {
  if (isMobile()) return 'mobile';
  if (isTablet()) return 'tablet';
  return 'desktop';
}

export function onDeviceClassChange(cb: (cls: DeviceClass) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const mql = window.matchMedia('(pointer: coarse)');
  let last: DeviceClass = getDeviceClass();
  const handler = (): void => {
    const cur = getDeviceClass();
    if (cur !== last) {
      last = cur;
      cb(cur);
    }
  };
  mql.addEventListener('change', handler);
  window.addEventListener('resize', handler);
  return () => {
    mql.removeEventListener('change', handler);
    window.removeEventListener('resize', handler);
  };
}
