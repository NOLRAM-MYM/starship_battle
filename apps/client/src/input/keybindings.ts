/**
 * Mapa de teclas do jogo — remapeável e independente de layout.
 *
 * O controlador antigo lia `event.key`, que é o CARACTERE gerado. Isso
 * quebra fora do QWERTY: num teclado AZERTY o `W` fica onde o QWERTY tem
 * `Z`, e o jogador francês teria que apertar `Z` para "W". Aqui usamos
 * `event.code`, que identifica a POSIÇÃO FÍSICA da tecla — `KeyW` é
 * sempre a mesma tecla, em qualquer layout do mundo.
 *
 * Como `code` é físico e o rótulo mostrado precisa ser legível, há uma
 * função de rótulo que usa a API do navegador (`keyboard.getLayoutMap`)
 * quando disponível e cai num nome genérico quando não.
 */

/** Ações vinculáveis. */
export type GameAction =
  | 'pitchUp'
  | 'pitchDown'
  | 'yawLeft'
  | 'yawRight'
  | 'rollLeft'
  | 'rollRight'
  | 'thrust'
  | 'fire'
  | 'defend'
  | 'skill1'
  | 'skill2'
  | 'skill3'
  | 'consumable1'
  | 'consumable2'
  | 'launchTorpedo'
  | 'deployDecoys'
  | 'fineControl'
  | 'cycleTarget'
  | 'toggleGravityLines'
  | 'toHangar';

export interface ActionMeta {
  action: GameAction;
  label: string;
  /** Agrupamento na tela de configuração. */
  group: 'Pilotagem' | 'Combate' | 'Interface';
  hint?: string;
}

/** Ordem e rótulos exibidos na configuração. */
export const ACTIONS: readonly ActionMeta[] = [
  { action: 'pitchUp', label: 'Subir (nariz para cima)', group: 'Pilotagem' },
  { action: 'pitchDown', label: 'Descer (nariz para baixo)', group: 'Pilotagem' },
  { action: 'yawLeft', label: 'Virar à esquerda', group: 'Pilotagem' },
  { action: 'yawRight', label: 'Virar à direita', group: 'Pilotagem' },
  { action: 'rollLeft', label: 'Rolar à esquerda', group: 'Pilotagem' },
  { action: 'rollRight', label: 'Rolar à direita', group: 'Pilotagem' },
  {
    action: 'thrust',
    label: 'Acelerar',
    group: 'Pilotagem',
    hint: 'Segure para ganhar velocidade',
  },
  { action: 'fire', label: 'Atirar', group: 'Combate' },
  { action: 'defend', label: 'Defesa', group: 'Combate' },
  { action: 'skill1', label: 'Habilidade 1 — Impulso', group: 'Combate' },
  { action: 'skill2', label: 'Habilidade 2 — PEM', group: 'Combate' },
  { action: 'skill3', label: 'Habilidade 3 — Reparo', group: 'Combate' },
  { action: 'consumable1', label: 'Consumível 1', group: 'Combate' },
  { action: 'consumable2', label: 'Consumível 2', group: 'Combate' },
  { action: 'launchTorpedo', label: 'Torpedo (no alvo travado)', group: 'Combate' },
  { action: 'deployDecoys', label: 'Iscas de dispersão', group: 'Combate' },
  { action: 'fineControl', label: 'Mira fina (segurar)', group: 'Pilotagem' },
  { action: 'cycleTarget', label: 'Trocar de alvo', group: 'Interface' },
  {
    action: 'toggleGravityLines',
    label: 'Linhas de gravidade',
    group: 'Interface',
    hint: 'Mostra ou esconde trajetória e força; o alerta permanece',
  },
  { action: 'toHangar', label: 'Voltar ao hangar', group: 'Interface' },
];

export type Keymap = Record<GameAction, string>;

/**
 * Padrão pedido: W sobe, S desce, A/D viram, Q atira, E defende,
 * 1/2/3 habilidades. Rolagem em Z/C e aceleração no Shift, que sobram
 * naturalmente sob a mão esquerda.
 */
export const DEFAULT_KEYMAP: Keymap = {
  pitchUp: 'KeyW',
  pitchDown: 'KeyS',
  yawLeft: 'KeyA',
  yawRight: 'KeyD',
  rollLeft: 'KeyZ',
  rollRight: 'KeyC',
  thrust: 'ShiftLeft',
  fire: 'KeyQ',
  defend: 'KeyE',
  skill1: 'Digit1',
  skill2: 'Digit2',
  skill3: 'Digit3',
  // 4 e 5 seguem as três de habilidade: a mão já está sobre a fileira,
  // e o consumível é decidido no mesmo instante que uma habilidade.
  consumable1: 'Digit4',
  consumable2: 'Digit5',
  // R e F ficam sob os dedos que não estão em WASD: as duas são reações
  // de fração de segundo, e obrigar a mão a sair da fileira de voo para
  // soltar iscas anularia a defesa.
  launchTorpedo: 'KeyR',
  deployDecoys: 'KeyF',
  // Alt esquerdo: fica sob o polegar, dá para segurar enquanto WASD
  // continua sendo usado. Mira fina é um MODO mantido, não um toque.
  fineControl: 'AltLeft',
  cycleTarget: 'Tab',
  toggleGravityLines: 'KeyG',
  toHangar: 'Escape',
};

const STORAGE_KEY = 'batle.keymap';

function isKeymap(v: unknown): v is Keymap {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return ACTIONS.every((a) => typeof o[a.action] === 'string' && o[a.action] !== '');
}

/** Lê o mapa salvo, completando ações novas com o padrão. */
export function loadKeymap(): Keymap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEYMAP };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_KEYMAP };
    // Merge com o padrão: uma versão nova do jogo pode ter adicionado
    // ações que o mapa salvo não conhece.
    const merged = { ...DEFAULT_KEYMAP, ...(parsed as Partial<Keymap>) };
    return isKeymap(merged) ? merged : { ...DEFAULT_KEYMAP };
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(map: Keymap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage indisponível (modo privado). O mapa vale para a sessão.
  }
}

export function resetKeymap(): Keymap {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
  return { ...DEFAULT_KEYMAP };
}

/** Índice reverso `code -> ação`, para o loop de input ser O(1). */
export function buildReverseMap(map: Keymap): Map<string, GameAction> {
  const rev = new Map<string, GameAction>();
  for (const { action } of ACTIONS) {
    const code = map[action];
    if (code) rev.set(code, action);
  }
  return rev;
}

/** Ações que já usam este `code`, fora a própria. Detecta conflito. */
export function conflictsFor(map: Keymap, code: string, except: GameAction): GameAction[] {
  return ACTIONS.filter((a) => a.action !== except && map[a.action] === code).map(
    (a) => a.action,
  );
}

/**
 * Rótulo legível de um `code` físico.
 *
 * Fallback puro (sem navegador): remove os prefixos que a spec usa e
 * devolve algo curto. `KeyW` -> `W`, `Digit1` -> `1`, `ShiftLeft` ->
 * `Shift esq`.
 */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) {
    const dir: Record<string, string> = {
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
    };
    return dir[code] ?? code;
  }
  const named: Record<string, string> = {
    Space: 'Espaço',
    ShiftLeft: 'Shift esq',
    ShiftRight: 'Shift dir',
    ControlLeft: 'Ctrl esq',
    ControlRight: 'Ctrl dir',
    AltLeft: 'Alt esq',
    AltRight: 'Alt dir',
    Tab: 'Tab',
    Escape: 'Esc',
    Enter: 'Enter',
    Backspace: 'Backspace',
    CapsLock: 'CapsLock',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    IntlBackslash: '\\',
    IntlRo: 'Ro',
    IntlYen: 'Yen',
  };
  return named[code] ?? code;
}

/**
 * Rótulo real conforme o layout do sistema, quando o navegador expõe
 * `navigator.keyboard.getLayoutMap()`. Num ABNT2 ou AZERTY isso mostra o
 * caractere que está impresso na tecla, em vez do nome físico.
 *
 * Cai silenciosamente em `keyLabel` onde a API não existe (Firefox,
 * Safari) — nunca falha.
 */
export async function resolveKeyLabels(codes: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const c of codes) out.set(c, keyLabel(c));

  const kb = (navigator as Navigator & {
    keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> };
  }).keyboard;
  if (!kb?.getLayoutMap) return out;

  try {
    const layout = await kb.getLayoutMap();
    for (const c of codes) {
      const real = layout.get(c);
      if (real) out.set(c, real.toUpperCase());
    }
  } catch {
    // Permissão negada ou API instável: mantém o fallback.
  }
  return out;
}

/**
 * `code` é vinculável? Bloqueia teclas que sequestrariam o navegador
 * (F5, F11, F12) ou que o SO intercepta.
 */
export function isBindableCode(code: string): boolean {
  if (!code) return false;
  const blocked = new Set([
    'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu',
    'PrintScreen', 'NumLock', 'ScrollLock', 'Pause',
  ]);
  return !blocked.has(code);
}
