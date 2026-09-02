/**
 * HUD de combate.
 *
 * A versão anterior montava tudo com `style.*` inline e mostrava apenas
 * três barras finas de 4px. Esta reescrita mantém exatamente a mesma API
 * pública (`createHudState` / `updateHudState` / `computeLevel` /
 * `mountHud`) e acrescenta o que faltava para o combate ser legível:
 * radar, painel de alvo, feedback de dano, alertas e cooldowns com timer.
 *
 * Estilo vive em `hud.css`; aqui só há estrutura e sincronização.
 */

import type { ActiveSkill } from '../net/protocol.js';
import { createRadar, type RadarHandle } from './Radar.js';
import { createCompass, type CompassHandle } from './Compass.js';
import type { Contact, Vec3 } from '../game/targeting.js';
import type { NavPoint } from '../game/navigation.js';
import './hud.css';

/** Um consumível equipado, como o HUD o mostra. */
export interface ConsumableState {
  /** Nome curto para o slot. */
  name: string;
  /** Cargas restantes — o servidor é a fonte da verdade. */
  charges: number;
}

export interface SkillState {
  id: ActiveSkill;
  cooldownEnd: number;
  cooldownTotal: number;
}

export interface HudState {
  hp: number;
  hpMax: number;
  shield: number;
  shieldMax: number;
  xp: number;
  xpNext: number;
  money: number;
  targetName: string | null;
  skills: SkillState[];
  /**
   * Consumíveis equipados, com as cargas restantes.
   *
   * A loja vendia `repair_kit` e `shield_cell` desde sempre e não havia
   * NADA no jogo indicando que estavam equipados, nem tecla para usar.
   */
  consumables: ConsumableState[];
  /** Callsign exibido no painel de vitais. */
  callsign: string;
  /** Contatos para o radar — atualizados pelo loop a partir do snapshot. */
  contacts: Contact[];
  /** Posição da própria nave (origem do radar). */
  position: Vec3;
  /** Rumo em radianos no plano XZ. */
  heading: number;
  /** Id do alvo travado, ou null. */
  targetId: number | null;
  /** Distância até o alvo, em unidades. */
  targetDistance: number;
  /** Fração de HP do alvo (0..1). */
  targetHp: number;
  /** Marcos do setor (planetas, sol, cinturão) para a bússola. */
  navPoints: NavPoint[];
  /** Marco selecionado como destino, ou null. */
  navTargetId: string | null;
  /**
   * Corpo cujo poço gravitacional capturou a nave, ou null.
   *
   * O servidor é quem aplica a força; isto é só o aviso, para o jogador
   * entender por que está sendo puxado e o quanto falta para escapar.
   */
  gravityWell: { name: string; distance: number; surface: number } | null;
  /**
   * Carga do gatilho: 0..1 (fração do tempo de carga da arma).
   *
   * Sem indicador o jogador não teria como saber quando o tiro está
   * cheio — teria que contar mentalmente.
   */
  fireCharge: number;
  /** Nome da arma primária, para o rótulo da carga. */
  weaponName: string | null;
  /**
   * Multiplicador de dano da carga ATUAL (1 = tiro normal).
   *
   * Sem este número a barra enchia sem dizer nada: não dava para saber
   * se segurar mais meio segundo valia a pena, nem que o laser em
   * rajada simplesmente não carrega.
   */
  chargeMult: number;
}

export function createHudState(): HudState {
  return {
    hp: 0,
    hpMax: 100,
    shield: 0,
    shieldMax: 0,
    xp: 0,
    xpNext: 100,
    money: 0,
    targetName: null,
    consumables: [],
    skills: [
      { id: 'Dash', cooldownEnd: 0, cooldownTotal: 5000 },
      { id: 'Emp', cooldownEnd: 0, cooldownTotal: 10000 },
      { id: 'Repair', cooldownEnd: 0, cooldownTotal: 15000 },
    ],
    callsign: 'PILOTO',
    contacts: [],
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    targetId: null,
    targetDistance: 0,
    targetHp: 1,
    navPoints: [],
    navTargetId: null,
    gravityWell: null,
    fireCharge: 0,
    weaponName: null,
    chargeMult: 1,
  };
}

export function updateHudState(state: HudState, patch: Partial<HudState>): void {
  Object.assign(state, patch);
}

/**
 * Curva de XP: `xpNext(level) = round(100 * 1.4^level)`.
 * Level = maior N tal que soma de 100*1.4^i para i=0..N-1 <= xp.
 * Sempre retorna level >= 1.
 */
export function computeLevel(xp: number): { level: number; xpNext: number } {
  if (!Number.isFinite(xp) || xp < 0) {
    return { level: 1, xpNext: xpNextFor(1) };
  }
  let level = 1;
  let cumulative = 0;
  // Cresce rápido (1.4^n), então N típico é pequeno.
  for (let n = 0; n < 200; n += 1) {
    const cost = xpNextFor(n);
    if (cumulative + cost > xp) {
      level = n + 1;
      break;
    }
    cumulative += cost;
    level = n + 2;
  }
  return { level, xpNext: xpNextFor(level - 1) };
}

function xpNextFor(level: number): number {
  return Math.round(100 * Math.pow(1.4, level));
}

export interface MountHudOpts {
  container: HTMLElement;
  state: HudState;
  /** Alcance do radar em unidades de mundo. */
  radarRange?: number;
  /** Botão de saída e rótulo da tecla equivalente. */
  extras?: MountHudExtras;
}

export interface MountHudHandle {
  destroy(): void;
  refresh(): void;
  /** Pisca a vinheta vermelha e registra o dano tomado. */
  flashDamage(intensity?: number): void;
  /** Alerta efêmero no centro (level up, alvo destruído, ...). */
  toast(text: string, tone?: 'good' | 'bad' | 'neutral'): void;
  /** Reflete no botão o estado das linhas (para o atalho de teclado). */
  setGravityLines(on: boolean): void;
}

export interface MountHudExtras {
  /** Handler do botão "voltar ao hangar". */
  onExit?: () => void;
  /** Tecla mostrada no botão de saída (vem do mapa configurável). */
  exitKeyLabel?: string;
  /** Alterna as linhas de gravidade. Deve devolver o novo estado. */
  onToggleGravityLines?: () => boolean;
  /** Tecla equivalente, mostrada no botão. */
  gravityKeyLabel?: string;
  /** Estado inicial do botão. */
  gravityLinesOn?: boolean;
}

/** Cria um elemento com classe e conteúdo, em uma linha. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface BarRefs {
  fill: HTMLElement;
  ghost: HTMLElement;
  value: HTMLElement;
}

/** Barra com rastro: o "ghost" desce devagar mostrando o dano recente. */
function createBar(label: string, fillClass: string): { root: HTMLElement; refs: BarRefs } {
  const root = el('div', 'hud-bar');
  const head = el('div', 'hud-bar-head');
  head.appendChild(el('span', undefined, label));
  const value = el('b', undefined, '0');
  head.appendChild(value);

  const track = el('div', 'hud-track');
  const ghost = el('div', 'hud-ghost');
  const fill = el('div', `hud-fill ${fillClass}`);
  track.appendChild(ghost);
  track.appendChild(fill);

  root.appendChild(head);
  root.appendChild(track);
  return { root, refs: { fill, ghost, value } };
}

export function mountHud(opts: MountHudOpts): MountHudHandle {
  const { container, state } = opts;

  const root = el('div');
  root.id = 'batle-hud';

  // ---------- Vitais ----------
  const vitals = el('div', 'hud-vitals');
  const callsignRow = el('div', 'hud-callsign');
  const nameEl = el('span', 'hud-name', state.callsign);
  const levelEl = el('span', 'hud-level', 'LV 1');
  callsignRow.append(nameEl, levelEl);

  const hp = createBar('Casco', 'hud-fill-hp');
  const shield = createBar('Escudo', 'hud-fill-shield');
  const xp = createBar('Experiência', 'hud-fill-xp');
  vitals.append(callsignRow, hp.root, shield.root, xp.root);

  // ---------- Alvo ----------
  const target = el('div', 'hud-target');
  const targetName = el('div', 'hud-target-name', '—');
  const targetMeta = el('div', 'hud-target-meta', '');
  const targetTrack = el('div', 'hud-target-track');
  const targetFill = el('div', 'hud-target-fill');
  targetTrack.appendChild(targetFill);
  target.append(targetName, targetMeta, targetTrack);

  // ---------- Radar ----------
  const radar: RadarHandle = createRadar(opts.radarRange ?? 900);

  // ---------- Créditos ----------
  const credits = el('div', 'hud-credits');
  const creditSym = el('span', 'sym', 'C');
  const creditVal = el('span', undefined, '0');
  credits.append(creditSym, creditVal);

  // ---------- Habilidades ----------
  const actions = el('div', 'hud-actions');
  const KEYS = ['1', '2', '3'];
  const LABELS: Record<ActiveSkill, string> = { Dash: 'Impulso', Emp: 'PEM', Repair: 'Reparo' };
  interface SkillRefs {
    box: HTMLElement;
    cd: HTMLElement;
    timer: HTMLElement;
    wasReady: boolean;
  }
  const skillRefs: SkillRefs[] = [];

  state.skills.forEach((skill, idx) => {
    const box = el('div', 'hud-skill');
    const cd = el('div', 'hud-skill-cd');
    const key = el('div', 'hud-skill-key', KEYS[idx] ?? '');
    const name = el('div', 'hud-skill-name', LABELS[skill.id] ?? skill.id);
    const timer = el('div', 'hud-skill-timer', '');
    box.append(cd, key, name, timer);
    actions.appendChild(box);
    skillRefs.push({ box, cd, timer, wasReady: true });
  });

  // ---------- Consumíveis (teclas 4 e 5) ----------
  //
  // Na mesma fileira das habilidades de propósito: são decididos no
  // mesmo instante, e separá-los faria o jogador procurar em dois
  // lugares no meio de um combate. O que os distingue é o CONTADOR —
  // habilidade tem cooldown, consumível acaba.
  interface ConsumableRefs {
    box: HTMLElement;
    count: HTMLElement;
  }
  const consumableRefs: ConsumableRefs[] = [];
  const CONSUMABLE_KEYS = ['4', '5'];

  state.consumables.forEach((c, idx) => {
    const box = el('div', 'hud-skill hud-consumable');
    const key = el('div', 'hud-skill-key', CONSUMABLE_KEYS[idx] ?? '');
    const name = el('div', 'hud-skill-name', c.name);
    const count = el('div', 'hud-consumable-count', String(c.charges));
    box.append(key, name, count);
    actions.appendChild(box);
    consumableRefs.push({ box, count });
  });

  // ---------- Navegação (fita de bússola + marcadores de borda) ----------
  const compass: CompassHandle = createCompass();

  // ---------- Botão de retorno ao hangar ----------
  const exitBtn = el('button', 'hud-exit');
  exitBtn.type = 'button';
  exitBtn.innerHTML = `Hangar<small>${escapeHtml(opts.extras?.exitKeyLabel ?? 'Esc')}</small>`;
  exitBtn.addEventListener('click', () => opts.extras?.onExit?.());

  // ---------- Barra de carga do tiro ----------
  const chargeWrap = el('div', 'hud-charge');
  const chargeFill = el('div', 'hud-charge-fill');
  const chargeLabel = el('div', 'hud-charge-label');
  chargeWrap.appendChild(chargeFill);
  chargeWrap.appendChild(chargeLabel);

  // ---------- Aviso de poço gravitacional ----------
  const gravity = el('div', 'hud-gravity');

  // ---------- Botão das linhas de gravidade ----------
  // O ALERTA acima é sempre visível; este botão controla só as linhas
  // 3D, que poluem a tela quando não se está manobrando perto de um
  // corpo.
  const gravBtn = el('button', 'hud-toggle');
  gravBtn.type = 'button';
  let linhasLigadas = opts.extras?.gravityLinesOn ?? true;
  const pintarBotao = (): void => {
    gravBtn.classList.toggle('off', !linhasLigadas);
    gravBtn.innerHTML =
      `Linhas${linhasLigadas ? '' : ' off'}` +
      `<small>${escapeHtml(opts.extras?.gravityKeyLabel ?? 'G')}</small>`;
    gravBtn.setAttribute('aria-pressed', String(linhasLigadas));
  };
  pintarBotao();
  gravBtn.addEventListener('click', () => {
    const novo = opts.extras?.onToggleGravityLines?.();
    if (typeof novo === 'boolean') {
      linhasLigadas = novo;
      pintarBotao();
    }
  });

  // ---------- Retículo, vinheta e alertas ----------
  const reticle = el('div', 'hud-reticle');
  const vignette = el('div', 'hud-vignette');
  const toasts = el('div', 'hud-toasts');

  root.append(
    vitals, target, radar.element, credits, actions,
    compass.element, exitBtn, gravBtn, gravity, chargeWrap, reticle, vignette, toasts,
  );
  container.appendChild(root);

  // Alvos "fantasma" das barras, atualizados com atraso.
  let ghostHp = 100;
  let ghostShield = 100;
  let vignetteTimer: ReturnType<typeof setTimeout> | null = null;

  function refresh(): void {
    const hpPct = state.hpMax > 0 ? clampPct((state.hp / state.hpMax) * 100) : 0;
    const shieldPct = state.shieldMax > 0 ? clampPct((state.shield / state.shieldMax) * 100) : 0;
    const xpPct = state.xpNext > 0 ? clampPct((state.xp / state.xpNext) * 100) : 0;

    hp.refs.fill.style.width = `${hpPct}%`;
    hp.refs.fill.style.background = hpColor(hpPct);
    shield.refs.fill.style.width = `${shieldPct}%`;
    xp.refs.fill.style.width = `${xpPct}%`;

    // O rastro só desce (dano); ao curar acompanha imediatamente.
    ghostHp = hpPct > ghostHp ? hpPct : Math.max(hpPct, ghostHp - 0.6);
    ghostShield = shieldPct > ghostShield ? shieldPct : Math.max(shieldPct, ghostShield - 1.2);
    hp.refs.ghost.style.width = `${ghostHp}%`;
    shield.refs.ghost.style.width = `${ghostShield}%`;

    const { level } = computeLevel(state.xp);
    levelEl.textContent = `LV ${level}`;
    nameEl.textContent = state.callsign;
    hp.refs.value.textContent = `${Math.max(0, Math.floor(state.hp))} / ${state.hpMax}`;
    shield.refs.value.textContent = `${Math.max(0, Math.floor(state.shield))} / ${state.shieldMax}`;
    xp.refs.value.textContent = `${state.xp} / ${state.xpNext}`;
    creditVal.textContent = formatNumber(state.money);

    // ---- Alvo ----
    if (state.targetName) {
      target.classList.add('active');
      targetName.textContent = state.targetName;
      targetMeta.textContent = `${Math.round(state.targetDistance)} u - ${Math.round(state.targetHp * 100)}%`;
      targetFill.style.width = `${clampPct(state.targetHp * 100)}%`;
    } else {
      target.classList.remove('active');
    }

    radar.draw(state.position, state.heading, state.contacts, state.targetId);
    // A bússola trabalha em GRAUS; `state.heading` está em radianos.
    const headingDeg = ((state.heading * 180) / Math.PI + 360) % 360;
    compass.update(state.position, headingDeg, state.navPoints, state.navTargetId);

    // ---- Consumíveis ----
    state.consumables.forEach((c, idx) => {
      const ref = consumableRefs[idx];
      if (!ref) return;
      ref.count.textContent = String(c.charges);
      // Sem carga: apagado, mas ainda visível. Some-lo faria os slots
      // dançarem no meio do combate.
      ref.box.classList.toggle('empty', c.charges <= 0);
    });

    // ---- Carga do tiro ----
    const carga = Math.max(0, Math.min(1, state.fireCharge));
    chargeWrap.classList.toggle('active', carga > 0.02);
    chargeWrap.classList.toggle('full', carga >= 0.999);
    chargeFill.style.width = `${(carga * 100).toFixed(1)}%`;
    // Nome da arma + ganho atual. O multiplicador é o que transforma a
    // barra de enfeite em decisão: dá para ver quando soltar.
    const mult = state.chargeMult;
    chargeLabel.textContent =
      mult > 1.01
        ? `${state.weaponName ?? 'Arma'} ×${mult.toFixed(1)}`
        : (state.weaponName ?? '');

    // ---- Poço gravitacional ----
    const gw = state.gravityWell;
    if (gw) {
      // Altitude em relação à superfície: é o número que importa para
      // saber se dá tempo de escapar.
      const altitude = Math.max(0, gw.distance - gw.surface);
      const perigo = altitude < gw.surface * 1.5;
      gravity.className = `hud-gravity active${perigo ? ' critical' : ''}`;
      gravity.innerHTML =
        `<b>CAMPO GRAVITACIONAL</b>` +
        `<span>${escapeHtml(gw.name)}</span>` +
        `<u>altitude ${Math.round(altitude)} u</u>`;
    } else {
      gravity.className = 'hud-gravity';
      gravity.textContent = '';
    }

    // ---- Cooldowns ----
    const now = Date.now();
    state.skills.forEach((skill, idx) => {
      const ref = skillRefs[idx];
      if (!ref) return;
      const remaining = skill.cooldownEnd - now;
      if (remaining > 0) {
        const pct = clampPct((remaining / skill.cooldownTotal) * 100);
        ref.cd.style.height = `${pct}%`;
        ref.timer.textContent = `${(remaining / 1000).toFixed(1)}s`;
        ref.box.classList.remove('ready');
        ref.wasReady = false;
      } else {
        ref.cd.style.height = '0%';
        ref.timer.textContent = '';
        ref.box.classList.add('ready');
        // Pulso único na transição recarregando -> pronto.
        if (!ref.wasReady) {
          ref.box.classList.add('just-ready');
          setTimeout(() => ref.box.classList.remove('just-ready'), 440);
          ref.wasReady = true;
        }
      }
    });
  }

  function flashDamage(intensity = 1): void {
    vignette.style.setProperty('opacity', String(Math.min(1, Math.max(0.2, intensity))));
    vignette.classList.add('hit');
    if (vignetteTimer) clearTimeout(vignetteTimer);
    vignetteTimer = setTimeout(() => {
      vignette.classList.remove('hit');
      vignette.style.removeProperty('opacity');
    }, 90);
  }

  function toast(text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
    const node = el('div', `hud-toast ${tone === 'neutral' ? '' : tone}`.trim(), text);
    toasts.appendChild(node);
    // A animação `toast-out` termina em ~2s; removemos logo depois.
    setTimeout(() => node.remove(), 2200);
  }

  function destroy(): void {
    if (vignetteTimer) clearTimeout(vignetteTimer);
    radar.destroy();
    compass.destroy();
    root.remove();
  }

  function setGravityLines(on: boolean): void {
    linhasLigadas = on;
    pintarBotao();
  }

  refresh();
  return { destroy, refresh, flashDamage, toast, setGravityLines };
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function hpColor(pct: number): string {
  // Verde -> âmbar -> vermelho conforme o casco cai.
  if (pct > 60) return 'linear-gradient(90deg, #2fd07a, #45e5a4)';
  if (pct > 30) return 'linear-gradient(90deg, #c99a2f, #ffc34e)';
  return 'linear-gradient(90deg, #c8354a, #ff5f6d)';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
