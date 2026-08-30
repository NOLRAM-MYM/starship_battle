import { COMPONENT_LIBRARY, type UiComponentTemplate, type SlotKindName } from './componentLibrary';
import './shipBuilder.css';

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

export interface LoadoutSlot {
  slotId: number;
  templateId: string;
  tier: number;
}

export class ShipBuilder {
  private slots: Slot[] = TEMPLATE_SLOTS.map((s) => ({ ...s, component: null }));
  private root: HTMLElement;
  private onChange?: (loadout: LoadoutSlot[]) => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
  }

  /** Registra callback para mudanças de loadout (usado pela Task 8). */
  setOnChange(cb: (loadout: LoadoutSlot[]) => void): void {
    this.onChange = cb;
  }

  private emit(): void {
    this.onChange?.(this.getLoadout());
  }

  private render(): void {
    this.root.innerHTML = `
      <h2>SHIP BUILDER</h2>
      <div class="section-title">Componentes</div>
      <div id="lib"></div>
      <div class="section-title">Slots da Nave</div>
      <div id="slots"></div>
      <div class="section-title">Status</div>
      <div id="stats" class="stats-block"></div>
      <button id="save-loadout" class="save-btn">SALVAR LAYOUT</button>
    `;
    this.renderLibrary();
    this.renderSlots();
    this.renderStats();
    this.bindSave();
  }

  private renderLibrary(): void {
    const lib = this.root.querySelector('#lib');
    if (!lib) return;
    lib.innerHTML = '';
    for (const comp of COMPONENT_LIBRARY) {
      const el = document.createElement('div');
      el.className = 'component-item';
      el.draggable = true;
      el.dataset.tier = String(comp.tier);
      el.innerHTML = `<span>${comp.name}</span><span class="component-tier">T${comp.tier}</span>`;
      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData('text/plain', comp.id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
      });
      lib.appendChild(el);
    }
  }

  private renderSlots(): void {
    const wrap = this.root.querySelector('#slots');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const slot of this.slots) {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.dataset.slotId = String(slot.id);
      row.dataset.filled = slot.component ? 'true' : 'false';
      const compHtml = slot.component
        ? `<span class="slot-component">${slot.component.name}</span>`
        : `<span class="slot-empty">— vazio</span>`;
      row.innerHTML = `<span class="slot-kind">#${slot.id} ${slot.kind}</span>${compHtml}`;
      row.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });
      row.addEventListener('drop', (ev) => {
        ev.preventDefault();
        row.classList.remove('drag-over');
        const compId = ev.dataTransfer?.getData('text/plain');
        if (!compId) return;
        const comp = COMPONENT_LIBRARY.find((c) => c.id === compId);
        if (!comp) return;
        if (comp.kind !== slot.kind) {
          row.classList.add('reject');
          setTimeout(() => row.classList.remove('reject'), 200);
          return;
        }
        slot.component = comp;
        this.renderSlots();
        this.renderStats();
        this.emit();
      });
      wrap.appendChild(row);
    }
  }

  private renderStats(): void {
    const stats = this.root.querySelector('#stats');
    if (!stats) return;
    const filled = this.slots.filter((s) => s.component).length;
    const total = this.slots.length;
    const mass = this.slots.reduce((acc, s) => acc + (s.component ? s.component.mass : 0), 0);
    const thrust = this.slots.filter((s) => s.component?.kind === 'Engine').length;
    stats.innerHTML = `
      <div class="stat-row"><span>Slots preenchidos</span><span class="stat-value">${filled}/${total}</span></div>
      <div class="stat-row"><span>Massa total</span><span class="stat-value">${mass} t</span></div>
      <div class="stat-row"><span>Motores instalados</span><span class="stat-value">${thrust}</span></div>
    `;
  }

  private bindSave(): void {
    const btn = this.root.querySelector('#save-loadout');
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.addEventListener('click', async () => {
      const name = window.prompt('Nome do layout:');
      if (!name) return;
      const { saveLoadout } = await import('../persistence/loadoutRepo');
      await saveLoadout({
        id: crypto.randomUUID(),
        name,
        slots: this.getLoadout(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      window.alert('Layout salvo!');
    });
  }

  getLoadout(): LoadoutSlot[] {
    return this.slots
      .filter((s) => s.component !== null)
      .map((s) => ({
        slotId: s.id,
        templateId: s.component!.id,
        tier: s.component!.tier,
      }));
  }
}

export function mountShipBuilder(): ShipBuilder {
  const root = document.createElement('div');
  root.id = 'ship-builder';
  document.body.appendChild(root);
  return new ShipBuilder(root);
}
