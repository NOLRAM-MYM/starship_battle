/**
 * Captura estado do teclado e produz o input de voo.
 *
 * Duas mudanças de fundo em relação à versão anterior:
 *
 * 1. **Independente de layout.** Lê `event.code` (posição física da
 *    tecla) em vez de `event.key` (caractere). Antes, num teclado AZERTY
 *    o `W` do jogo caía numa tecla diferente da marcada; agora `KeyW` é
 *    a mesma tecla em qualquer layout.
 *
 * 2. **Remapeável.** As teclas vêm de um `Keymap` que o jogador edita no
 *    hangar, e não de comparações fixas no meio do laço.
 *
 * Controles padrão: W/S sobe e desce o nariz, A/D viram, Z/C rolam,
 * Shift acelera, Q atira, E defende, 1/2/3 habilidades.
 */

import {
  detectFamily,
  familyLabel,
  LIMIAR_GATILHO,
  readAxes,
  readButtons,
  type PadInfo,
  type PadPrevState,
} from './gamepad';
import {
  buildReverseMap,
  DEFAULT_KEYMAP,
  type GameAction,
  type Keymap,
} from './keybindings';

export interface InputState {
  /** -1..1 — guinada. */
  steer: number;
  /** -1..1 — arfagem. */
  pitch: number;
  /** -1..1 — rolagem. */
  roll: number;
  /** 0..1 — aceleração. */
  thrust: number;
  /**
   * `true` no instante em que o gatilho é SOLTO (não ao apertar).
   *
   * Mudou de propósito: o disparo agora sai ao soltar, para que segurar
   * acumule carga. Toque rápido continua atirando na hora, porque a
   * carga fica ~0 e o servidor trata como tiro normal.
   */
  fire: boolean;
  /** Segundos que o gatilho ficou segurado. */
  fireCharge: number;
  /** Edge-trigger. */
  defend: boolean;
  /** Edge-trigger. */
  skill: 'Dash' | 'Emp' | 'Repair' | null;
  /** Edge-trigger: índice do slot de consumível pedido (0 ou 1). */
  useConsumable: number | null;
  /**
   * Edge-trigger: pedido de lançar torpedo.
   *
   * O ALVO não vem daqui — quem sabe qual entidade está travada é o laço
   * do jogo. O controlador só relata que a tecla foi apertada.
   */
  launchTorpedo: boolean;
  /** Edge-trigger: soltar iscas de dispersão. */
  deployDecoys: boolean;
  /**
   * Modo de precisão, enquanto a tecla está SEGURADA.
   *
   * Não é edge-trigger como os outros: é um estado mantido, do mesmo
   * jeito que a aceleração.
   */
  fineControl: boolean;
}

export interface InputController {
  /** Snapshot atual; consome os edge-triggers. */
  read(): InputState;
  consumeFire(): boolean;
  /** Segundos de carga acumulados AGORA (gatilho ainda apertado). */
  currentCharge(): number;
  consumeSkill(): 'Dash' | 'Emp' | 'Repair' | null;
  /** Troca o mapa em tempo real (aplicado na próxima tecla). */
  setKeymap(map: Keymap): void;
  /** Registra callback para ações de interface (alvo, hangar). */
  onAction(action: GameAction, cb: () => void): void;
  attach(target?: HTMLElement | Window): void;
  detach(): void;
  /** Controle conectado, ou `null`. Para a interface anunciar. */
  gamepad(): PadInfo | null;
  /** Avisa quando um controle conecta ou desconecta. */
  onGamepadChange(cb: (info: PadInfo | null) => void): void;
}

const SKILL_OF: Partial<Record<GameAction, 'Dash' | 'Emp' | 'Repair'>> = {
  skill1: 'Dash',
  skill2: 'Emp',
  skill3: 'Repair',
};

export function createInputController(initial: Keymap = DEFAULT_KEYMAP): InputController {
  let reverse = buildReverseMap(initial);
  /** Ações fisicamente pressionadas agora. */
  const held = new Set<GameAction>();
  const listeners = new Map<GameAction, Array<() => void>>();

  let pendingFire = false;
  let pendingCharge = 0;
  /** Instante em que o gatilho foi apertado, ou null. */
  let fireHeldSince: number | null = null;
  let pendingDefend = false;
  let pendingSkill: 'Dash' | 'Emp' | 'Repair' | null = null;
  let pendingConsumable: number | null = null;
  let pendingTorpedo = false;
  let pendingDecoys = false;

  function emit(action: GameAction): void {
    for (const cb of listeners.get(action) ?? []) cb();
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Enquanto o jogador digita num campo (callsign, login), o teclado
    // pertence ao formulário, não à nave.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }

    const action = reverse.get(e.code);
    if (!action) return;

    // `Tab` moveria o foco e `Space` rolaria a página.
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();

    if (!held.has(action)) {
      // O tiro agora sai ao SOLTAR: apertar só começa a carregar.
      if (action === 'fire') fireHeldSince = performance.now();
      if (action === 'defend') pendingDefend = true;
      const skill = SKILL_OF[action];
      if (skill) pendingSkill = skill;
      if (action === 'consumable1') pendingConsumable = 0;
      if (action === 'consumable2') pendingConsumable = 1;
      if (action === 'launchTorpedo') pendingTorpedo = true;
      if (action === 'deployDecoys') pendingDecoys = true;
      emit(action);
    }
    held.add(action);
  }

  function onKeyUp(e: KeyboardEvent): void {
    const action = reverse.get(e.code);
    if (!action) return;
    held.delete(action);

    if (action === 'fire' && fireHeldSince !== null) {
      pendingCharge = Math.max(0, (performance.now() - fireHeldSince) / 1000);
      pendingFire = true;
      fireHeldSince = null;
    }
  }

  /** Alt-tab não pode deixar teclas "grudadas". */
  function onBlur(): void {
    held.clear();
    // Perder o foco com o gatilho apertado não deve virar um tiro
    // carregado fantasma ao voltar. O mesmo vale para um consumível
    // pedido e não consumido: gastaria uma carga sozinho.
    fireHeldSince = null;
    pendingConsumable = null;
    pendingTorpedo = false;
    pendingDecoys = false;
  }

  // --- Controle ---
  //
  // O navegador NÃO pareia nada: o Bluetooth acontece no sistema. O que
  // chega aqui é a Gamepad API, que entrega qualquer controle já
  // conectado, com ou sem fio, sem diferença.
  let padInfo: PadInfo | null = null;
  const padPrev: PadPrevState = new Set<number>();
  const padListeners: Array<(info: PadInfo | null) => void> = [];

  /** Primeiro controle realmente conectado. */
  function lerPad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const g of navigator.getGamepads()) {
      if (g && g.connected) return g;
    }
    return null;
  }

  function atualizarInfo(g: Gamepad | null): void {
    const novo: PadInfo | null = g
      ? {
          index: g.index,
          id: g.id,
          family: detectFamily(g.id),
          label: familyLabel(detectFamily(g.id)),
        }
      : null;
    const mudou = (padInfo?.index ?? -1) !== (novo?.index ?? -1);
    padInfo = novo;
    if (mudou) for (const cb of padListeners) cb(novo);
  }

  let attached: { target: Window } | null = null;

  function attach(target: HTMLElement | Window = window): void {
    if (attached) return;
    const t = (target === window ? window : target) as Window;
    t.addEventListener('keydown', onKeyDown as EventListener);
    t.addEventListener('keyup', onKeyUp as EventListener);
    window.addEventListener('blur', onBlur);
    attached = { target: t };
  }

  function detach(): void {
    if (!attached) return;
    attached.target.removeEventListener('keydown', onKeyDown as EventListener);
    attached.target.removeEventListener('keyup', onKeyUp as EventListener);
    window.removeEventListener('blur', onBlur);
    attached = null;
  }

  /** Eixo a partir de duas ações opostas. */
  const axis = (neg: GameAction, pos: GameAction): number => {
    let v = 0;
    if (held.has(neg)) v -= 1;
    if (held.has(pos)) v += 1;
    return v;
  };

  return {
    read(): InputState {
      const g = lerPad();
      atualizarInfo(g);
      const pad = g ? readAxes(g) : null;
      const padBtn = g ? readButtons(g, padPrev) : null;

      // O gatilho do controle também carrega o tiro, igual ao teclado.
      if (padBtn) {
        if (padBtn.fireHeld && fireHeldSince === null) {
          fireHeldSince = performance.now();
        }
        if (padBtn.fire && fireHeldSince !== null) {
          pendingCharge = Math.max(0, (performance.now() - fireHeldSince) / 1000);
          pendingFire = true;
          fireHeldSince = null;
        }
        if (padBtn.defend) pendingDefend = true;
        if (padBtn.skill) pendingSkill = padBtn.skill;
        if (padBtn.useConsumable !== null) pendingConsumable = padBtn.useConsumable;
        if (padBtn.launchTorpedo) pendingTorpedo = true;
        if (padBtn.deployDecoys) pendingDecoys = true;
        if (padBtn.cycleTarget) emit('cycleTarget');
        if (padBtn.toHangar) emit('toHangar');
        if (padBtn.toggleGravityLines) emit('toggleGravityLines');
      }

      const fire = pendingFire;
      pendingFire = false;
      const fireCharge = pendingCharge;
      pendingCharge = 0;
      const defend = pendingDefend;
      pendingDefend = false;
      const skill = pendingSkill;
      pendingSkill = null;
      const useConsumable = pendingConsumable;
      pendingConsumable = null;
      const launchTorpedo = pendingTorpedo;
      pendingTorpedo = false;
      const deployDecoys = pendingDecoys;
      pendingDecoys = false;

      // Teclado e controle SOMAM, com saturação. Assim os dois valem ao
      // mesmo tempo — dá para pilotar na alavanca e usar uma tecla sem
      // que um cancele o outro — e nenhum dos dois precisa "ganhar".
      const misturar = (tecla: number, analogico: number): number =>
        Math.max(-1, Math.min(1, tecla + analogico));

      return {
        steer: misturar(axis('yawLeft', 'yawRight'), pad?.steer ?? 0),
        // W deve levantar o nariz. No referencial do servidor, pitch
        // positivo sobe, então `pitchDown -> -1` e `pitchUp -> +1`.
        pitch: misturar(axis('pitchDown', 'pitchUp'), pad?.pitch ?? 0),
        roll: misturar(axis('rollLeft', 'rollRight'), pad?.roll ?? 0),
        thrust: Math.max(held.has('thrust') ? 1 : 0, pad?.thrust ?? 0),
        fire,
        fireCharge,
        defend,
        skill,
        useConsumable,
        launchTorpedo,
        deployDecoys,
        fineControl: held.has('fineControl') || (pad?.fine ?? 0) >= LIMIAR_GATILHO,
      };
    },

    consumeFire(): boolean {
      const v = pendingFire;
      pendingFire = false;
      return v;
    },

    currentCharge(): number {
      // Alimenta a barra de carga do HUD enquanto o gatilho está preso.
      if (fireHeldSince === null) return 0;
      return (performance.now() - fireHeldSince) / 1000;
    },

    consumeSkill(): 'Dash' | 'Emp' | 'Repair' | null {
      const v = pendingSkill;
      pendingSkill = null;
      return v;
    },

    setKeymap(map: Keymap): void {
      reverse = buildReverseMap(map);
      // Teclas seguradas sob o mapa antigo virariam fantasmas.
      held.clear();
    },

    onAction(action: GameAction, cb: () => void): void {
      const arr = listeners.get(action) ?? [];
      arr.push(cb);
      listeners.set(action, arr);
    },

    gamepad(): PadInfo | null {
      return padInfo;
    },

    onGamepadChange(cb): void {
      padListeners.push(cb);
      // Avisa já, caso o controle esteja conectado desde antes.
      cb(padInfo);
    },

    attach,
    detach,
  };
}
