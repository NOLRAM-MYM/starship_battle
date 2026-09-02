import {
  COMPONENT_LIBRARY,
  componentById,
  tierLabel,
  type SlotKindName,
  type UiComponentTemplate,
} from './componentLibrary';
import { aggregateStats, statRating, statsDelta, type AggregateStats } from '../game/shipStats';
import { pilotClassById } from '../data/pilots';
import { statChartSvg } from './StatChart';
import { saveLoadout } from '../persistence/loadoutRepo';
import { detailFromTiers, type ChassisSpec, type ChassisKind } from '../render/ShipMesh';
import './shipBuilder.css';

/**
 * Estaleiro (shipyard).
 *
 * O builder antigo era um painel lateral de 360px com linhas de texto e
 * drag-and-drop obrigatório — inutilizável no celular e sem nenhuma
 * informação sobre o efeito de cada peça. Esta versão é uma tela cheia
 * com três mudanças de fundo:
 *
 *  1. **Encaixar por clique** além de arrastar, então funciona no toque.
 *  2. **Prévia de impacto**: passar o mouse numa peça mostra o delta de
 *     atributos que ela causaria, antes de instalar.
 *  3. **Nave ao vivo**: cada encaixe reconstrói o modelo 3D no fundo.
 */

interface Slot {
  id: number;
  kind: SlotKindName;
  component: UiComponentTemplate | null;
}

const TEMPLATE_SLOTS: Array<Omit<Slot, 'component'>> = [
  { id: 1, kind: 'Engine' },
  { id: 2, kind: 'Engine' },
  { id: 3, kind: 'Weapon' },
  { id: 4, kind: 'Weapon' },
  { id: 5, kind: 'Shield' },
  { id: 6, kind: 'Sensor' },
  { id: 7, kind: 'Cargo' },
  { id: 8, kind: 'Stealth' },
];

/** Rótulo e ícone (glifo) de cada família de slot. */
const KIND_META: Record<SlotKindName, { label: string; glyph: string }> = {
  Engine: { label: 'Propulsão', glyph: '▲' },
  Weapon: { label: 'Armamento', glyph: '✦' },
  Shield: { label: 'Defesa', glyph: '◈' },
  Sensor: { label: 'Sensores', glyph: '◎' },
  Cargo: { label: 'Carga', glyph: '▤' },
  Stealth: { label: 'Furtividade', glyph: '◐' },
};

const KIND_ORDER: SlotKindName[] = ['Engine', 'Weapon', 'Shield', 'Sensor', 'Cargo', 'Stealth'];

export interface LoadoutSlot {
  slotId: number;
  templateId: string;
  tier: number;
}

export class ShipBuilder {
  private slots: Slot[] = TEMPLATE_SLOTS.map((s) => ({ ...s, component: null }));
  private root: HTMLElement;
  private onChange?: (loadout: LoadoutSlot[]) => void;
  private onPreview?: (spec: ChassisSpec) => void;
  private onClose?: () => void;
  /** Classe do piloto ativo — afeta os atributos mostrados aqui. */
  private pilotClassId: string | null = null;
  /** Filtro de categoria do catálogo; null = tudo. */
  private filter: SlotKindName | null = null;
  /** Componente sob o cursor, para a prévia de delta. */
  private hovered: UiComponentTemplate | null = null;
  /**
   * Peças que o jogador possui (compradas na loja).
   *
   * `null` = sem informação de inventário (API fora, ou jogo offline).
   * Nesse caso liberamos tudo em vez de travar o estaleiro inteiro: um
   * erro de rede não pode impedir a pessoa de montar a nave.
   */
  private ownedTemplates: Set<string> | null = null;
  /** Chamado quando o jogador clica numa peça que ainda não possui. */
  private onRequestShop?: (comp: UiComponentTemplate) => void;
  private visible = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('shipyard');
    this.root.style.display = 'none';
    this.render();
  }

  /** Alterna a visibilidade do estaleiro. */
  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.emitPreview();
    else this.onClose?.();
  }

  isOpen(): boolean {
    return this.visible;
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    this.onClose?.();
  }

  /** Registra callback para mudanças de loadout. */
  setOnChange(cb: (loadout: LoadoutSlot[]) => void): void {
    this.onChange = cb;
  }

  /** Recebe a nave a exibir no `HangarStage` a cada alteração. */
  setOnPreview(cb: (spec: ChassisSpec) => void): void {
    this.onPreview = cb;
  }

  /** Chamado ao fechar o estaleiro (o hangar reassume a prévia 3D). */
  setOnClose(cb: () => void): void {
    this.onClose = cb;
  }

  /**
   * Informa quais peças o jogador possui. Passe `null` para liberar
   * tudo (sem inventário disponível).
   */
  setOwnedTemplates(ids: readonly string[] | null): void {
    this.ownedTemplates = ids === null ? null : new Set(ids);
    if (this.visible) this.render();
  }

  /** Callback para abrir a loja a partir de uma peça bloqueada. */
  setOnRequestShop(cb: (comp: UiComponentTemplate) => void): void {
    this.onRequestShop = cb;
  }

  /** True se a peça pode ser instalada (possuída, ou inventário ausente). */
  private owns(comp: UiComponentTemplate): boolean {
    return this.ownedTemplates === null || this.ownedTemplates.has(comp.id);
  }

  /** Define a classe do piloto para o cálculo de atributos. */
  setPilotClass(classId: string | null): void {
    this.pilotClassId = classId;
    if (this.visible) this.render();
  }

  /** Carrega um loadout salvo nos slots (usado ao editar da frota). */
  loadSlots(entries: readonly LoadoutSlot[]): void {
    for (const s of this.slots) s.component = null;
    for (const entry of entries) {
      const slot = this.slots.find((s) => s.id === entry.slotId);
      const comp = componentById(entry.templateId);
      if (slot && comp && comp.kind === slot.kind && this.owns(comp)) {
        slot.component = comp;
      }
    }
    this.render();
    this.emit();
  }

  getLoadout(): LoadoutSlot[] {
    return this.slots
      .filter((s): s is Slot & { component: UiComponentTemplate } => s.component !== null)
      .map((s) => ({ slotId: s.id, templateId: s.component.id, tier: s.component.tier }));
  }

  // ------------------------------------------------------------------
  // Estado derivado
  // ------------------------------------------------------------------

  private installed(): UiComponentTemplate[] {
    return this.slots
      .map((s) => s.component)
      .filter((c): c is UiComponentTemplate => c !== null);
  }

  private currentStats(): AggregateStats {
    return aggregateStats(this.installed(), pilotClassById(this.pilotClassId ?? ''));
  }

  /**
   * Atributos hipotéticos se o componente sob o cursor fosse instalado
   * no primeiro slot compatível (substituindo o ocupante, se houver).
   */
  private previewStats(candidate: UiComponentTemplate): AggregateStats | null {
    const slot = this.firstCompatibleSlot(candidate);
    if (!slot) return null;
    const next = this.installed().filter((c) => c !== slot.component);
    next.push(candidate);
    return aggregateStats(next, pilotClassById(this.pilotClassId ?? ''));
  }

  /** Slot vazio compatível; se não houver vazio, o primeiro do tipo. */
  private firstCompatibleSlot(comp: UiComponentTemplate): Slot | null {
    return (
      this.slots.find((s) => s.kind === comp.kind && s.component === null) ??
      this.slots.find((s) => s.kind === comp.kind) ??
      null
    );
  }

  private chassisSpec(): ChassisSpec {
    const installed = this.installed();
    const engines = installed.filter((c) => c.kind === 'Engine').length;
    const weapons = installed.filter((c) => c.kind === 'Weapon').length;
    const mass = installed.reduce((a, c) => a + c.mass, 0);
    const kind: ChassisKind =
      mass > 160 ? 'cruiser' : mass > 100 ? 'hauler' : weapons >= 2 ? 'skirmisher' : 'interceptor';
    const accent = pilotClassById(this.pilotClassId ?? '')?.accent ?? 0x4ec9ff;
    return {
      kind,
      hull: 0x28405e,
      glow: accent,
      engines: Math.max(1, engines),
      weapons,
      detail: detailFromTiers(installed.map((c) => c.tier)),
      // A nave no fundo reflete cada peça encaixada, na hora.
      loadout: installed.map((c) => c.id),
    };
  }

  private emit(): void {
    this.onChange?.(this.getLoadout());
    this.emitPreview();
  }

  private emitPreview(): void {
    this.onPreview?.(this.chassisSpec());
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  private render(): void {
    const stats = this.currentStats();
    const preview = this.hovered ? this.previewStats(this.hovered) : null;

    this.root.innerHTML = `
      <div class="yard-backdrop"></div>
      <div class="yard-frame">
        <header class="yard-top">
          <div>
            <div class="eyebrow">Estaleiro orbital</div>
            <h2 class="yard-title">Montagem de Nave</h2>
          </div>
          <button class="yard-close btn" id="yard-close" aria-label="Fechar estaleiro">Fechar ✕</button>
        </header>

        <div class="yard-body">
          <!-- Catálogo -->
          <section class="yard-pane yard-catalog">
            <div class="yard-pane-head">
              <span class="eyebrow">Catálogo</span>
              <div class="yard-filters">
                <button class="chip ${this.filter === null ? 'active' : ''}" data-filter="">Tudo</button>
                ${KIND_ORDER.map(
                  (k) => `<button class="chip ${this.filter === k ? 'active' : ''}"
                            data-filter="${k}">${KIND_META[k].label}</button>`,
                ).join('')}
              </div>
            </div>
            <div class="yard-catalog-list">
              ${this.catalogItems()}
            </div>
          </section>

          <!-- Slots -->
          <section class="yard-pane yard-slots">
            <div class="yard-pane-head">
              <span class="eyebrow">Hardpoints</span>
              <button class="chip" id="yard-clear">Esvaziar</button>
            </div>
            <div class="slot-grid">
              ${KIND_ORDER.map((kind) => this.slotGroup(kind)).join('')}
            </div>
            <p class="yard-hint">
              Clique numa peça do catálogo para encaixar no primeiro slot livre,
              ou arraste até um slot específico. Clique num slot ocupado para remover.
            </p>
          </section>

          <!-- Atributos -->
          <section class="yard-pane yard-readout">
            <span class="eyebrow">Perfil</span>
            <div class="yard-chart">
              ${statChartSvg({
                values: statRating(preview ?? stats),
                compare: preview ? statRating(stats) : null,
              })}
            </div>
            ${this.readoutRows(stats, preview)}
            <div class="yard-cost">
              <span>Custo total</span>
              <b>${stats.cost.toLocaleString('pt-BR')} ₡</b>
            </div>
            <button class="btn btn-primary yard-save" id="yard-save">Salvar layout</button>
            <div class="yard-msg" id="yard-msg" role="status"></div>
          </section>
        </div>
      </div>`;

    this.bind();
  }

  private catalogItems(): string {
    const list = COMPONENT_LIBRARY.filter((c) => this.filter === null || c.kind === this.filter);
    if (list.length === 0) return `<div class="yard-empty">Nada nesta categoria.</div>`;

    return list
      .map((c) => {
        const equipped = this.installed().some((i) => i.id === c.id);
        const locked = !this.owns(c);
        return `
        <article class="comp-card ${equipped ? 'equipped' : ''} ${locked ? 'locked' : ''}"
                 draggable="${!locked}"
                 data-comp="${c.id}" data-tier="${c.tier}" tabindex="0" role="button"
                 aria-label="${escapeHtml(c.name)}, ${tierLabel(c.tier)}${locked ? ', bloqueado' : ''}">
          <div class="comp-top">
            <span class="comp-glyph">${KIND_META[c.kind].glyph}</span>
            <span class="comp-name">${escapeHtml(c.name)}</span>
            <span class="comp-tier">T${c.tier}</span>
          </div>
          <div class="comp-blurb">${escapeHtml(c.blurb)}</div>
          <div class="comp-stats">
            ${componentStatChips(c)}
            <span class="comp-mass">${c.mass}t</span>
          </div>
          ${
            locked
              ? `<div class="comp-lock">Não adquirido — ${c.cost.toLocaleString('pt-BR')} na loja</div>`
              : ''
          }
        </article>`;
      })
      .join('');
  }

  private slotGroup(kind: SlotKindName): string {
    const slots = this.slots.filter((s) => s.kind === kind);
    if (slots.length === 0) return '';
    return `
      <div class="slot-group">
        <div class="slot-group-label">${KIND_META[kind].glyph} ${KIND_META[kind].label}</div>
        <div class="slot-group-items">
          ${slots.map((s) => this.slotCell(s)).join('')}
        </div>
      </div>`;
  }

  private slotCell(slot: Slot): string {
    const c = slot.component;
    return `
      <div class="slot-cell ${c ? 'filled' : ''}" data-slot="${slot.id}"
           ${c ? `data-tier="${c.tier}"` : ''} tabindex="0" role="button"
           aria-label="Slot ${slot.id} ${KIND_META[slot.kind].label}${c ? `: ${c.name}` : ' vazio'}">
        <span class="slot-index">#${slot.id}</span>
        ${
          c
            ? `<span class="slot-comp">${escapeHtml(c.name)}</span>
               <span class="slot-tier">${tierLabel(c.tier)}</span>`
            : `<span class="slot-free">livre</span>`
        }
      </div>`;
  }

  private readoutRows(stats: AggregateStats, preview: AggregateStats | null): string {
    const delta = preview ? statsDelta(stats, preview) : {};
    const rows: Array<[string, keyof AggregateStats, string, boolean]> = [
      ['Aceleração', 'acceleration', 'm/s²', true],
      ['DPS', 'dps', '', true],
      ['Casco', 'hull', '', true],
      ['Escudo', 'shield', '', true],
      ['Regen.', 'shieldRegen', '/s', true],
      ['Massa', 'mass', 't', false],
      ['Sensores', 'sensorRange', 'u', true],
      ['Carga', 'cargo', '', true],
    ];

    return `<div class="yard-rows">${rows
      .map(([label, key, unit, moreIsBetter]) => {
        const value = stats[key];
        const d = delta[key];
        const chip =
          typeof d === 'number' && d !== 0
            ? `<i class="delta ${(d > 0) === moreIsBetter ? 'good' : 'bad'}">${
                d > 0 ? '+' : ''
              }${d}</i>`
            : '';
        return `<div class="yard-row"><span>${label}</span>
                <b>${formatStat(value)}<u>${unit}</u>${chip}</b></div>`;
      })
      .join('')}</div>`;
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------

  private bind(): void {
    const q = <T extends HTMLElement>(sel: string): T | null => this.root.querySelector<T>(sel);

    q('#yard-close')?.addEventListener('click', () => this.close());
    this.root.querySelector('.yard-backdrop')?.addEventListener('click', () => this.close());

    // --- Filtros de categoria ---
    this.root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.filter ?? '';
        this.filter = v === '' ? null : (v as SlotKindName);
        this.render();
      });
    });

    q('#yard-clear')?.addEventListener('click', () => {
      for (const s of this.slots) s.component = null;
      this.render();
      this.emit();
    });

    // --- Catálogo: clique encaixa, arrasto inicia transferência ---
    this.root.querySelectorAll<HTMLElement>('.comp-card').forEach((card) => {
      const compId = card.dataset.comp;
      const comp = compId ? componentById(compId) : undefined;
      if (!comp) return;

      const equip = (): void => {
        if (!this.owns(comp)) {
          // Peça não comprada: em vez de falhar em silêncio, leva o
          // jogador direto para onde ela pode ser adquirida.
          this.message(`${comp.name} ainda não foi adquirido.`, 'bad');
          this.onRequestShop?.(comp);
          return;
        }
        const slot = this.firstCompatibleSlot(comp);
        if (!slot) return;
        slot.component = comp;
        this.hovered = null;
        this.render();
        this.emit();
      };

      card.addEventListener('click', equip);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          equip();
        }
      });

      // Prévia de impacto ao passar o mouse / focar.
      const showPreview = (): void => {
        if (this.hovered?.id === comp.id) return;
        this.hovered = comp;
        this.renderReadoutOnly();
      };
      const clearPreview = (): void => {
        if (!this.hovered) return;
        this.hovered = null;
        this.renderReadoutOnly();
      };
      card.addEventListener('mouseenter', showPreview);
      card.addEventListener('focus', showPreview);
      card.addEventListener('mouseleave', clearPreview);
      card.addEventListener('blur', clearPreview);

      card.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData('text/plain', comp.id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    // --- Slots: drop, clique remove ---
    this.root.querySelectorAll<HTMLElement>('.slot-cell').forEach((cell) => {
      const slotId = Number(cell.dataset.slot);
      const slot = this.slots.find((s) => s.id === slotId);
      if (!slot) return;

      const clear = (): void => {
        if (!slot.component) return;
        slot.component = null;
        this.render();
        this.emit();
      };
      cell.addEventListener('click', clear);
      cell.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Delete') {
          ev.preventDefault();
          clear();
        }
      });

      cell.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (ev) => {
        ev.preventDefault();
        cell.classList.remove('drag-over');
        const compId = ev.dataTransfer?.getData('text/plain');
        const comp = compId ? componentById(compId) : undefined;
        if (!comp) return;
        if (!this.owns(comp)) {
          cell.classList.add('reject');
          this.message(`${comp.name} ainda não foi adquirido.`, 'bad');
          setTimeout(() => cell.classList.remove('reject'), 260);
          return;
        }
        if (comp.kind !== slot.kind) {
          // Recusa explícita: o jogador precisa ver *por que* não encaixou.
          cell.classList.add('reject');
          this.message(`${comp.name} não cabe num slot de ${KIND_META[slot.kind].label}.`, 'bad');
          setTimeout(() => cell.classList.remove('reject'), 260);
          return;
        }
        slot.component = comp;
        this.render();
        this.emit();
      });
    });

    q('#yard-save')?.addEventListener('click', () => void this.save());
  }

  /**
   * Redesenha só a coluna de atributos.
   * Recriar a árvore inteira a cada `mouseenter` perderia o hover e o foco.
   */
  private renderReadoutOnly(): void {
    const pane = this.root.querySelector('.yard-readout');
    if (!pane) return;
    const stats = this.currentStats();
    const preview = this.hovered ? this.previewStats(this.hovered) : null;

    const chart = pane.querySelector('.yard-chart');
    if (chart) {
      chart.innerHTML = statChartSvg({
        values: statRating(preview ?? stats),
        compare: preview ? statRating(stats) : null,
      });
    }
    const rows = pane.querySelector('.yard-rows');
    if (rows) rows.outerHTML = this.readoutRows(stats, preview);
  }

  private message(text: string, tone: 'good' | 'bad' = 'good'): void {
    const el = this.root.querySelector('#yard-msg');
    if (!el) return;
    el.textContent = text;
    el.className = `yard-msg ${tone}`;
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = '';
        el.className = 'yard-msg';
      }
    }, 3200);
  }

  private async save(): Promise<void> {
    const loadout = this.getLoadout();
    if (loadout.length === 0) {
      this.message('Instale ao menos um módulo antes de salvar.', 'bad');
      return;
    }
    if (!this.installed().some((c) => c.kind === 'Engine')) {
      this.message('Uma nave sem propulsor não sai da doca.', 'bad');
      return;
    }

    const name = window.prompt('Nome do layout:');
    if (!name) return;

    try {
      await saveLoadout({ name, slots: loadout });
      this.message(`Layout "${name}" salvo.`, 'good');
    } catch (err) {
      console.error('Erro ao salvar layout:', err);
      this.message('Falha ao salvar. Verifique se você está autenticado.', 'bad');
    }
  }
}

export function mountShipBuilder(): ShipBuilder {
  const root = document.createElement('div');
  root.id = 'ship-builder';
  document.body.appendChild(root);
  return new ShipBuilder(root);
}

/** Chips compactos com os dois atributos mais relevantes da peça. */
function componentStatChips(c: UiComponentTemplate): string {
  const s = c.stats;
  const chips: string[] = [];
  if (s.thrust) chips.push(`+${s.thrust} emp`);
  if (s.damage) chips.push(`${s.damage} dano`);
  if (s.fireRate) chips.push(`${s.fireRate}/s`);
  if (s.shield) chips.push(`${s.shield > 0 ? '+' : ''}${s.shield} esc`);
  if (s.shieldRegen) chips.push(`${s.shieldRegen}/s reg`);
  if (s.hull) chips.push(`+${s.hull} casco`);
  if (s.sensorRange) chips.push(`${s.sensorRange}u`);
  if (s.cargo) chips.push(`+${s.cargo} carga`);
  if (s.stealth) chips.push(`${s.stealth > 0 ? '+' : ''}${Math.round(s.stealth * 100)}% furt`);
  return chips
    .slice(0, 3)
    .map((t) => `<span class="chip-stat">${escapeHtml(t)}</span>`)
    .join('');
}

function formatStat(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
