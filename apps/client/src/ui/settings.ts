/**
 * Configurações persistidas do cliente.
 *
 * Schema versionado em `localStorage` sob a chave `batle.settings.v1`.
 * Falhas de IO (modo privado, quota cheia, SSR) são silenciosas: o
 * app cai nos defaults.
 *
 * `applySettings` aplica o subset de settings que afeta o DOM
 * diretamente (classes CSS no `<body>` para colorblind e fontScale).
 */

export type GraphicsQuality = 'low' | 'med' | 'high' | 'ultra';
export type ColorblindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface ClientSettings {
  graphics: GraphicsQuality;
  audioMaster: number;
  audioSfx: number;
  audioMusic: number;
  sensitivity: number;
  invertY: boolean;
  colorblindMode: ColorblindMode;
  fontScale: number;
}

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  graphics: 'high',
  audioMaster: 0.8,
  audioSfx: 0.8,
  audioMusic: 0.6,
  sensitivity: 1.0,
  invertY: false,
  colorblindMode: 'off',
  fontScale: 1.0,
};

const STORAGE_KEY = 'batle.settings.v1';

function isGraphicsQuality(v: unknown): v is GraphicsQuality {
  return v === 'low' || v === 'med' || v === 'high' || v === 'ultra';
}

function isColorblindMode(v: unknown): v is ColorblindMode {
  return v === 'off' || v === 'protanopia' || v === 'deuteranopia' || v === 'tritanopia';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isClientSettings(v: unknown): v is ClientSettings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isGraphicsQuality(o['graphics']) &&
    isNumber(o['audioMaster']) &&
    isNumber(o['audioSfx']) &&
    isNumber(o['audioMusic']) &&
    isNumber(o['sensitivity']) &&
    typeof o['invertY'] === 'boolean' &&
    isColorblindMode(o['colorblindMode']) &&
    isNumber(o['fontScale'])
  );
}

export function loadSettings(): ClientSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CLIENT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLIENT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (isClientSettings(parsed)) return { ...parsed };
    return { ...DEFAULT_CLIENT_SETTINGS };
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

export function saveSettings(s: ClientSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* silencioso */
  }
}

const CB_CLASSES: ColorblindMode[] = ['off', 'protanopia', 'deuteranopia', 'tritanopia'];
const CB_CLASS_PREFIX = 'batle-cb-';

const FS_CLASSES = ['batle-fs-110', 'batle-fs-125', 'batle-fs-150'] as const;

export function applySettings(s: ClientSettings): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;

  // Colorblind: remove qualquer classe existente, depois aplica a atual.
  for (const m of CB_CLASSES) {
    if (m === 'off') continue;
    body.classList.remove(`${CB_CLASS_PREFIX}${m}`);
  }
  if (s.colorblindMode !== 'off') {
    body.classList.add(`${CB_CLASS_PREFIX}${s.colorblindMode}`);
  }

  // FontScale: remove todas, depois aplica conforme threshold.
  for (const cls of FS_CLASSES) body.classList.remove(cls);
  if (s.fontScale >= 1.5) body.classList.add('batle-fs-150');
  else if (s.fontScale >= 1.25) body.classList.add('batle-fs-125');
  else if (s.fontScale >= 1.1) body.classList.add('batle-fs-110');
}

export interface MountSettingsPanelOpts {
  container: HTMLElement;
  onChange: (s: ClientSettings) => void;
}

export interface MountSettingsPanelHandle {
  destroy(): void;
  getSettings(): ClientSettings;
}

export function mountSettingsPanel(opts: MountSettingsPanelOpts): MountSettingsPanelHandle {
  const { container, onChange } = opts;
  let current: ClientSettings = loadSettings();

  const root = document.createElement('div');
  root.id = 'batle-settings-panel';
  root.style.padding = '0.5rem';
  root.style.fontFamily = 'sans-serif';
  root.style.fontSize = '12px';
  root.style.color = '#fff';
  root.style.background = 'rgba(0,0,0,0.6)';
  root.style.border = '1px solid rgba(255,255,255,0.2)';
  root.style.minWidth = '240px';

  function row(label: string, input: HTMLElement): HTMLDivElement {
    const r = document.createElement('div');
    r.style.marginBottom = '6px';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.style.display = 'block';
    lab.style.fontSize = '10px';
    lab.style.opacity = '0.85';
    lab.appendChild(input);
    r.appendChild(lab);
    return r;
  }

  function range(value: number, min: number, max: number, step: number): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(value);
    return i;
  }

  function select<T extends string>(value: T, options: readonly T[]): HTMLSelectElement {
    const s = document.createElement('select');
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      s.appendChild(o);
    }
    return s;
  }

  function checkbox(value: boolean): HTMLInputElement {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = value;
    return c;
  }

  // Graphics
  const graphicsSel = select<GraphicsQuality>(current.graphics, [
    'low',
    'med',
    'high',
    'ultra',
  ]);
  graphicsSel.addEventListener('input', () => {
    const v = graphicsSel.value;
    if (isGraphicsQuality(v)) {
      current = { ...current, graphics: v };
      commit();
    }
  });
  root.appendChild(row('Graphics', graphicsSel));

  // Audio master
  const masterR = range(current.audioMaster, 0, 1, 0.05);
  masterR.addEventListener('input', () => {
    current = { ...current, audioMaster: parseFloat(masterR.value) };
    commit();
  });
  root.appendChild(row('Audio Master', masterR));

  // Audio sfx
  const sfxR = range(current.audioSfx, 0, 1, 0.05);
  sfxR.addEventListener('input', () => {
    current = { ...current, audioSfx: parseFloat(sfxR.value) };
    commit();
  });
  root.appendChild(row('Audio SFX', sfxR));

  // Audio music
  const musicR = range(current.audioMusic, 0, 1, 0.05);
  musicR.addEventListener('input', () => {
    current = { ...current, audioMusic: parseFloat(musicR.value) };
    commit();
  });
  root.appendChild(row('Audio Music', musicR));

  // Sensitivity
  const sensR = range(current.sensitivity, 0.1, 3.0, 0.1);
  sensR.addEventListener('input', () => {
    current = { ...current, sensitivity: parseFloat(sensR.value) };
    commit();
  });
  root.appendChild(row('Sensitivity', sensR));

  // Invert Y
  const invCb = checkbox(current.invertY);
  invCb.addEventListener('input', () => {
    current = { ...current, invertY: invCb.checked };
    commit();
  });
  root.appendChild(row('Invert Y', invCb));

  // Colorblind mode
  const cbSel = select<ColorblindMode>(current.colorblindMode, [
    'off',
    'protanopia',
    'deuteranopia',
    'tritanopia',
  ]);
  cbSel.addEventListener('input', () => {
    const v = cbSel.value;
    if (isColorblindMode(v)) {
      current = { ...current, colorblindMode: v };
      commit();
    }
  });
  root.appendChild(row('Colorblind', cbSel));

  // Font scale
  const fsR = range(current.fontScale, 0.8, 1.5, 0.05);
  fsR.addEventListener('input', () => {
    current = { ...current, fontScale: parseFloat(fsR.value) };
    commit();
  });
  root.appendChild(row('Font Scale', fsR));

  container.appendChild(root);

  function commit(): void {
    applySettings(current);
    saveSettings(current);
    onChange(current);
  }

  function destroy(): void {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function getSettings(): ClientSettings {
    return { ...current };
  }

  return { destroy, getSettings };
}
