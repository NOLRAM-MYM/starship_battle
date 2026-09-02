/**
 * Overlay de performance (FPS / frame time / memória).
 *
 * Mantém um EMA do FPS (alpha 0.1) e re-renderiza o texto a cada
 * 500ms para não causar reflow em todo frame. Se `performance.memory`
 * estiver disponível (Chromium) o uso aproximado de JS heap é
 * mostrado também.
 *
 * Não é parte do HUD de jogo — fica em top-right e pode ser
 * togglado com Ctrl+P.
 */

export interface PerfHudHandle {
  tick(dt: number): void;
  toggle(): void;
  destroy(): void;
  visible: boolean;
}

export interface PerfHudOpts {
  /** Container onde o overlay será inserido. Default: document.body. */
  container?: HTMLElement;
  /** Alpha do EMA do FPS. Default: 0.1. */
  emaAlpha?: number;
  /** Intervalo de re-render do texto. Default: 500ms. */
  refreshMs?: number;
}

export function createPerfHud(opts: PerfHudOpts = {}): PerfHudHandle {
  const emaAlpha = opts.emaAlpha ?? 0.1;
  const refreshMs = opts.refreshMs ?? 500;
  const container =
    opts.container ??
    (typeof document !== 'undefined' ? document.body : (null as unknown as HTMLElement));

  const handle: PerfHudHandle = {
    visible: false,
    tick,
    toggle,
    destroy,
  };

  if (typeof document === 'undefined' || !container) {
    // No-op (SSR/test sem DOM).
    return handle;
  }

  const root = document.createElement('div');
  root.id = 'batle-perf-hud';
  root.style.position = 'fixed';
  root.style.top = '0';
  root.style.right = '0';
  root.style.padding = '4px 8px';
  root.style.fontFamily = 'monospace';
  root.style.fontSize = '11px';
  root.style.color = '#9aff9a';
  root.style.background = 'rgba(0,0,0,0.55)';
  root.style.borderBottomLeftRadius = '4px';
  root.style.zIndex = '1100';
  root.style.pointerEvents = 'none';
  root.style.display = 'none';
  root.textContent = 'FPS: 60.0 | Frame: 16.7ms | Mem: —';

  container.appendChild(root);
  handle.visible = false;

  let currentEma = 60;
  let lastRefresh = 0;

  function tick(dt: number): void {
    if (!handle.visible) return;
    const safeDt = dt > 0 ? dt : 1 / 60;
    const instantFps = 1 / safeDt;
    currentEma = emaAlpha * instantFps + (1 - emaAlpha) * currentEma;
    const now = performance.now();
    if (now - lastRefresh < refreshMs) return;
    lastRefresh = now;
    render();
  }

  function render(): void {
    const fps = currentEma;
    const frameMs = 1000 / Math.max(1, fps);
    const mem = formatMem(getMemBytes());
    root.textContent = `FPS: ${fps.toFixed(1)} | Frame: ${frameMs.toFixed(1)}ms | Mem: ${mem}`;
  }

  function toggle(): void {
    handle.visible = !handle.visible;
    root.style.display = handle.visible ? 'block' : 'none';
  }

  function destroy(): void {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return handle;
}

function getMemBytes(): number | null {
  const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } };
  const m = perf.memory?.usedJSHeapSize;
  return typeof m === 'number' ? m : null;
}

function formatMem(bytes: number | null): string {
  if (bytes === null) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${mb.toFixed(1)}MB`;
}
