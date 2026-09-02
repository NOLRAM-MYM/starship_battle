/**
 * HUD responsivo (rebuild em resize / device-class change).
 *
 * Este módulo apenas fornece o observador que notifica o caller sobre
 * mudanças de layout. A renderização concreta do HUD continua a cargo
 * do código de UI existente.
 */

import { getDeviceClass, type DeviceClass } from '../input/adaptive.js';

export interface ResponsiveHudOpts {
  onLayoutChange: (cls: DeviceClass) => void;
}

export interface ResponsiveHudHandle {
  destroy(): void;
}

export function createResponsiveHud(opts: ResponsiveHudOpts): ResponsiveHudHandle {
  let last: DeviceClass = getDeviceClass();
  opts.onLayoutChange(last);

  const ro = new ResizeObserver(() => {
    const cur = getDeviceClass();
    if (cur !== last) {
      last = cur;
      opts.onLayoutChange(cur);
    }
  });
  ro.observe(document.body);

  return {
    destroy(): void {
      ro.disconnect();
    },
  };
}
