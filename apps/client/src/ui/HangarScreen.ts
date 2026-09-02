import { listLoadouts, deleteLoadout, type SavedLoadout } from '../persistence/loadoutRepo';
import { statsForLoadout, statRating, type LoadoutEntry } from '../game/shipStats';
import { applyModsToStats, combatMods, hasEffect, NO_MODS, type CombatMods } from '../data/skills';
import { fetchProgression, skillNodeIds } from '../net/progressionApi';
import { componentById } from './componentLibrary';
import { statChartSvg } from './StatChart';
import { createPilotCard, loadPilotProfile, savePilotProfile } from './PilotCard';
import { pilotClassById } from '../data/pilots';
import type { PilotProfile } from '../data/pilots';
import { detailFromTiers, type ChassisSpec, type ChassisKind } from '../render/ShipMesh';
import './HangarScreen.css';

/**
 * Tela de hangar.
 *
 * A versão anterior era uma caixa de 400px com uma lista de nomes: o
 * jogador escolhia um layout sem ver a nave nem saber o que ela faz.
 * Agora é uma tela cheia em três colunas — piloto à esquerda, nave 3D ao
 * vivo no centro (renderizada pelo `HangarStage` atrás da UI), frota e
 * atributos à direita — e a seleção repercute imediatamente nos três.
 */

export interface HangarCallbacks {
  onPlay: (loadoutId: number | string) => void;
  onOpenBuilder: () => void;
  /** Notifica o `HangarStage` para reconstruir a nave exibida. */
  onShipPreview?: (spec: ChassisSpec) => void;
}

export class HangarScreen {
  private root: HTMLElement;
  private loadouts: SavedLoadout[] = [];
  private selectedLoadoutId: number | string | null = null;
  private profile: PilotProfile;
  /** Aviso transitório (exclusão, erro), mostrado sobre a frota. */
  private notice: { text: string; tone: 'good' | 'bad' } | null = null;
  private onPlay: ((loadoutId: number | string) => void) | undefined;
  private onOpenBuilder: (() => void) | undefined;
  private onShipPreview: ((spec: ChassisSpec) => void) | undefined;
  private onOpenShop: (() => void) | undefined;
  private onOpenKeybinds: (() => void) | undefined;
  /** Alterna vitrine/esquema; devolve o modo novo. */
  private onToggleMode: (() => 'showcase' | 'blueprint') | undefined;
  private modo: 'showcase' | 'blueprint' = 'showcase';

  /** Modificadores de combate vindos das skills da conta. */
  private combat: CombatMods = NO_MODS;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('hangar-screen');
    this.root.style.display = 'none';
    this.profile = loadPilotProfile(localStorage.getItem('username') ?? 'Piloto');
    this.render();
  }

  /**
   * Busca as skills da conta.
   *
   * Sem isto o hangar mostrava o DPS do equipamento puro: o jogador
   * comprava "+5% weapon damage", o número não se mexia, e a árvore
   * parecia decorativa mesmo já tendo efeito real na arena.
   *
   * Chamado em `show`, não no construtor — pelo mesmo motivo do perfil
   * logo acima: o construtor roda no boot, antes do login, e ali não há
   * token nenhum para consultar a API. Recarregar a cada exibição também
   * pega os pontos gastos durante a sessão.
   */
  private async loadSkills(): Promise<void> {
    this.combat = combatMods(skillNodeIds(await fetchProgression()));
  }

  setCallbacks(
    onPlay: (loadoutId: number | string) => void,
    onOpenBuilder: () => void,
    onShipPreview?: (spec: ChassisSpec) => void,
    onOpenShop?: () => void,
    onOpenKeybinds?: () => void,
    onToggleMode?: () => 'showcase' | 'blueprint',
  ): void {
    this.onPlay = onPlay;
    this.onOpenBuilder = onOpenBuilder;
    this.onShipPreview = onShipPreview;
    this.onOpenShop = onOpenShop;
    this.onOpenKeybinds = onOpenKeybinds;
    this.onToggleMode = onToggleMode;
  }

  async show(): Promise<void> {
    this.root.style.display = 'block';
    // O construtor roda no boot, ANTES do login — naquele momento não há
    // `username` no storage e o callsign caía no default "Piloto" para
    // sempre. Recarregamos aqui, quando a sessão já existe.
    // `loadPilotProfile` devolve o perfil salvo quando há um, então um
    // callsign que o jogador editou não é sobrescrito.
    this.profile = loadPilotProfile(localStorage.getItem('username') ?? 'Piloto');
    await this.loadSkills();
    await this.loadData();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /**
   * Reposiciona os rótulos das peças sobre a nave.
   *
   * Chamado por quadro enquanto o hangar está visível. As coordenadas
   * vêm da projeção 3D do `HangarStage`; aqui só posicionamos o HTML.
   */
  updatePartLabels(
    projetadas: ReadonlyArray<{ templateId: string; x: number; y: number; visible: boolean }>,
  ): void {
    const host = this.root.querySelector<HTMLElement>('#part-labels');
    if (!host) return;

    if (this.modo !== 'blueprint') {
      host.innerHTML = '';
      return;
    }

    // Recria só quando o conjunto de peças muda; reposicionar é barato,
    // recriar 10 nós por quadro não seria.
    const chave = projetadas.map((p) => p.templateId).join('|');
    if (host.dataset.chave !== chave) {
      host.dataset.chave = chave;
      host.innerHTML = projetadas
        .map((p) => {
          const c = componentById(p.templateId);
          return `<div class="part-label" data-id="${p.templateId}">
                    <span class="pl-dot"></span>
                    <b>${escapeHtml(c?.name ?? p.templateId)}</b>
                    <u>${escapeHtml(c ? `T${c.tier} · ${c.mass}t` : '')}</u>
                  </div>`;
        })
        .join('');
    }

    const nos = host.querySelectorAll<HTMLElement>('.part-label');
    projetadas.forEach((p, i) => {
      const no = nos[i];
      if (!no) return;
      no.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
      no.style.opacity = p.visible ? '1' : '0';
    });
  }

  /** Modo de apresentação atual. */
  getMode(): 'showcase' | 'blueprint' {
    return this.modo;
  }

  /** Perfil atual — o loop de jogo usa a classe para aplicar modificadores. */
  getProfile(): PilotProfile {
    return this.profile;
  }

  /** Loadout selecionado resolvido em slots, ou lista vazia. */
  getSelectedSlots(): LoadoutEntry[] {
    const l = this.loadouts.find((x) => x.id === this.selectedLoadoutId);
    return (l?.slots ?? []) as LoadoutEntry[];
  }

  private async loadData(): Promise<void> {
    this.renderShell('<div class="hangar-status">Carregando frota…</div>');
    try {
      this.loadouts = await listLoadouts();
      if (this.loadouts.length > 0 && !this.hasSelection()) {
        this.selectedLoadoutId = this.loadouts[0]?.id ?? null;
      }
      this.render();
    } catch (err) {
      console.error('Falha ao carregar loadouts:', err);
      this.renderShell(`
        <div class="hangar-status error">
          <p>Não foi possível carregar sua frota.</p>
          <button class="btn" id="hangar-retry">Tentar novamente</button>
        </div>`);
      this.root
        .querySelector('#hangar-retry')
        ?.addEventListener('click', () => void this.loadData());
    }
  }

  private hasSelection(): boolean {
    return this.loadouts.some((l) => l.id === this.selectedLoadoutId);
  }

  /** Casca comum (fundo + moldura) usada por loading e erro. */
  private renderShell(inner: string): void {
    this.root.innerHTML = `
      <div class="hangar-scanline" aria-hidden="true"></div>
      <header class="hangar-top">
        <span class="hangar-brand">BATLE<b>·</b>HANGAR</span>
      </header>
      <div class="hangar-shell">${inner}</div>`;
  }

  /**
   * Deriva a nave visual do loadout: classe de casco pelo perfil de massa,
   * cor pela classe do piloto, nº de nacelas/canhões pelos componentes.
   */
  /** Spec da nave selecionada — o jogo usa o MESMO para desenhar em voo. */
  getChassisSpec(): ChassisSpec {
    return this.chassisSpec();
  }

  private chassisSpec(): ChassisSpec {
    const slots = this.getSelectedSlots();
    let engines = 0;
    let weapons = 0;
    let mass = 0;
    for (const s of slots) {
      const c = componentById(s.templateId);
      if (!c) continue;
      mass += c.mass;
      if (c.kind === 'Engine') engines++;
      if (c.kind === 'Weapon') weapons++;
    }
    const cls = pilotClassById(this.profile.classId);
    const kind: ChassisKind =
      mass > 160 ? 'cruiser' : mass > 100 ? 'hauler' : weapons >= 2 ? 'skirmisher' : 'interceptor';

    // Tiers instalados decidem o nível de detalhe: a nave fica
    // visivelmente mais elaborada conforme a build evolui.
    const tiers: number[] = [];
    for (const sl of slots) {
      const tier = componentById(sl.templateId)?.tier;
      if (typeof tier === 'number') tiers.push(tier);
    }

    return {
      kind,
      hull: 0x28405e,
      glow: cls?.accent ?? 0x4ec9ff,
      engines: Math.max(1, engines),
      weapons,
      detail: detailFromTiers(tiers),
      // Cada componente equipado ganha geometria própria no casco.
      loadout: slots.map((sl) => sl.templateId),
    };
  }

  private render(): void {
    // Os números do painel já incluem as skills: é o mesmo cálculo que o
    // servidor fará no disparo, então o hangar não promete uma coisa e a
    // arena entrega outra.
    const stats = applyModsToStats(
      statsForLoadout(this.getSelectedSlots(), this.profile.classId),
      this.combat,
    );
    const rating = statRating(stats);

    this.root.innerHTML = `
      <div class="hangar-scanline" aria-hidden="true"></div>

      <header class="hangar-top">
        <span class="hangar-brand">BATLE<b>·</b>HANGAR</span>
        <span class="hangar-dock">DOCA 07 — SETOR ORION</span>
      </header>

      <div class="hangar-grid">
        <div class="hangar-col hangar-col-left" id="hangar-pilot"></div>

        <div class="hangar-col hangar-col-center">
          <!-- Centro deliberadamente vazio: é a janela para a nave 3D. -->
          <!-- Rótulos das peças, posicionados por projeção 3D->2D. -->
          <div class="part-labels" id="part-labels" aria-hidden="true"></div>
          <div class="hangar-ship-caption glass">
            <div class="eyebrow">Nave ativa</div>
            <div class="ship-name">${escapeHtml(this.selectedName())}</div>
            <div class="ship-class">${escapeHtml(chassisLabel(this.chassisSpec().kind))}</div>
          </div>
          <div class="hangar-cta">
            <button class="btn ${this.modo === 'blueprint' ? 'btn-primary' : ''}"
                    id="hangar-mode">${this.modo === 'blueprint' ? 'Vitrine' : 'Esquema'}</button>
            <button class="btn" id="hangar-shop">Loja</button>
            <button class="btn" id="hangar-keys">Controles</button>
            <button class="btn" id="hangar-build">Estaleiro</button>
            <button class="btn btn-primary" id="hangar-play"
              ${this.hasSelection() ? '' : 'disabled'}>Lançar</button>
          </div>
        </div>

        <div class="hangar-col hangar-col-right">
          <section class="glass hangar-panel">
            <div class="eyebrow">Frota</div>
            ${
              this.notice
                ? `<div class="hangar-notice ${this.notice.tone}" role="status">${escapeHtml(this.notice.text)}</div>`
                : ''
            }
            <div class="hangar-fleet">
              ${
                this.loadouts.length === 0
                  ? `<div class="hangar-status">Nenhum layout salvo.<br/>Monte sua primeira nave no estaleiro.</div>`
                  : this.loadouts.map((l) => this.fleetItem(l)).join('')
              }
            </div>
          </section>

          <section class="glass hangar-panel">
            <div class="eyebrow">Perfil da nave</div>
            <div class="hangar-chart">${statChartSvg({ values: rating })}</div>
            <div class="hangar-stats">
              ${statRow('Aceleração', stats.acceleration.toFixed(1), 'm/s²')}
              ${statRow('DPS', String(stats.dps), '')}
              ${
                hasEffect(this.combat)
                  ? `<div class="hangar-skillnote">Inclui bônus de skills:
                       dano ×${this.combat.damageMult.toFixed(2)},
                       cadência ×${this.combat.fireRateMult.toFixed(2)}${
                         this.combat.shieldPierce > 0
                           ? `, perfura ${Math.round(this.combat.shieldPierce * 100)}% do escudo`
                           : ''
                       }</div>`
                  : ''
              }
              ${statRow('HP efetivo', String(stats.effectiveHp), '')}
              ${statRow('Massa', String(stats.mass), 't')}
              ${statRow('Sensores', String(stats.sensorRange), 'u')}
              ${statRow('Furtividade', `${Math.round(stats.stealth * 100)}`, '%')}
            </div>
          </section>
        </div>
      </div>`;

    // Card do piloto é um componente próprio (avatar + classe).
    const pilotHost = this.root.querySelector('#hangar-pilot');
    if (pilotHost) {
      const card = createPilotCard({
        profile: this.profile,
        onClassChange: (classId) => {
          this.profile = { ...this.profile, classId };
          savePilotProfile(this.profile);
          this.render(); // atributos e cor da nave dependem da classe
        },
        onCallsignChange: (callsign) => {
          this.profile = { ...this.profile, callsign };
          savePilotProfile(this.profile);
          this.render();
        },
      });
      pilotHost.appendChild(card.element);
    }

    this.bindEvents();
    this.onShipPreview?.(this.chassisSpec());
  }

  private selectedName(): string {
    return this.loadouts.find((l) => l.id === this.selectedLoadoutId)?.name ?? 'Casco sem equipar';
  }

  private fleetItem(l: SavedLoadout): string {
    const slots = (l.slots ?? []) as LoadoutEntry[];
    const s = statsForLoadout(slots, this.profile.classId);
    const selected = this.selectedLoadoutId === l.id;
    return `
      <article class="fleet-item ${selected ? 'selected' : ''}" data-id="${String(l.id)}"
               tabindex="0" role="button" aria-pressed="${selected}">
        <div class="fleet-head">
          <span class="fleet-name">${escapeHtml(l.name)}</span>
          <button class="fleet-del" data-del="${String(l.id)}"
                  title="Excluir layout" aria-label="Excluir ${escapeHtml(l.name)}">×</button>
        </div>
        <div class="fleet-meta">
          <span>${slots.length} módulos</span>
          <span>${s.dps} dps</span>
          <span>${s.effectiveHp} hp</span>
        </div>
      </article>`;
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLElement>('.fleet-item').forEach((item) => {
      const select = (): void => {
        const id = item.dataset.id;
        const l = this.loadouts.find((x) => String(x.id) === id);
        if (!l) return;
        this.selectedLoadoutId = l.id;
        this.render();
      };
      item.addEventListener('click', (ev) => {
        // O botão de excluir vive dentro do card; não deve selecionar.
        if ((ev.target as HTMLElement).dataset.del) return;
        select();
      });
      item.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          select();
        }
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('.fleet-del').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.del;
        if (!id) return;
        const l = this.loadouts.find((x) => String(x.id) === id);
        if (!l) return;
        if (!window.confirm(`Excluir o layout "${l.name}"?`)) return;

        btn.disabled = true;
        try {
          await deleteLoadout(l.id);
        } catch (err) {
          // Antes o erro virava só um `console.error` e a tela recarregava
          // com o layout ainda lá: parecia que o botão não funcionava.
          console.error('Falha ao excluir layout:', err);
          btn.disabled = false;
          this.notice = {
            text: `Não foi possível excluir "${l.name}". Tente novamente.`,
            tone: 'bad',
          };
          this.render();
          return;
        }
        if (this.selectedLoadoutId === l.id) this.selectedLoadoutId = null;
        this.notice = { text: `Layout "${l.name}" excluído.`, tone: 'good' };
        await this.loadData();
      });
    });

    this.root.querySelector('#hangar-build')?.addEventListener('click', () => {
      this.onOpenBuilder?.();
    });

    this.root.querySelector('#hangar-shop')?.addEventListener('click', () => {
      this.onOpenShop?.();
    });

    this.root.querySelector('#hangar-keys')?.addEventListener('click', () => {
      this.onOpenKeybinds?.();
    });

    this.root.querySelector('#hangar-mode')?.addEventListener('click', () => {
      const novo = this.onToggleMode?.();
      if (novo) {
        this.modo = novo;
        this.render();
      }
    });

    this.root.querySelector('#hangar-play')?.addEventListener('click', () => {
      if (this.selectedLoadoutId !== null && this.onPlay) {
        this.onPlay(this.selectedLoadoutId);
      }
    });
  }
}

function statRow(label: string, value: string, unit: string): string {
  return `<div class="stat-row"><span>${escapeHtml(label)}</span>
          <b>${escapeHtml(value)}<i>${escapeHtml(unit)}</i></b></div>`;
}

function chassisLabel(kind: ChassisKind): string {
  switch (kind) {
    case 'interceptor': return 'Interceptador · leve';
    case 'skirmisher': return 'Escaramuçador · médio';
    case 'cruiser': return 'Cruzador · pesado';
    case 'hauler': return 'Cargueiro · industrial';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
