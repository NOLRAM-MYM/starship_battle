import {
  ACTIONS,
  browserDisputaTecla,
  conflictsFor,
  isBindableCode,
  keyLabel,
  loadKeymap,
  resetKeymap,
  resolveKeyLabels,
  saveKeymap,
  type ActionMeta,
  type GameAction,
  type Keymap,
} from '../input/keybindings';
import {
  detectFamily,
  familyLabel,
  padBindings,
  type PadFamily,
} from '../input/gamepad';
import './KeybindScreen.css';

/**
 * Configuração de controles, acessível pelo hangar.
 *
 * Grava a POSIÇÃO física da tecla (`event.code`), então o mapa vale em
 * qualquer layout. O rótulo mostrado, porém, usa `navigator.keyboard
 * .getLayoutMap()` quando o navegador oferece: num ABNT2 ou AZERTY o
 * jogador vê o caractere impresso na tecla dele, não o nome interno.
 *
 * Conflitos são resolvidos na hora: vincular uma tecla já usada libera
 * a ação anterior, e o painel avisa qual foi.
 */

export interface KeybindScreenOptions {
  /** Chamado sempre que o mapa muda, para o controlador se atualizar. */
  onChange?: (map: Keymap) => void;
  onClose?: () => void;
}

export class KeybindScreen {
  /** Família do controle detectado, para os rótulos dos botões. */
  private padFamily: PadFamily = 'generic';
  private padConectado = false;

  private root: HTMLElement;
  private opts: KeybindScreenOptions = {};
  private map: Keymap;
  private visible = false;
  /** Ação aguardando a próxima tecla, ou null. */
  private capturing: GameAction | null = null;
  /** Rótulos resolvidos pelo layout do sistema. */
  private labels = new Map<string, string>();
  private notice: { text: string; tone: 'good' | 'bad' } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('keybind-screen');
    this.root.style.display = 'none';
    this.map = loadKeymap();
    this.render();
    void this.refreshLabels();
  }

  setOptions(opts: KeybindScreenOptions): void {
    this.opts = opts;
  }

  getKeymap(): Keymap {
    return { ...this.map };
  }

  isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    this.visible = true;
    this.root.style.display = 'block';
    this.notice = null;
    // O jogador costuma conectar o controle justamente ao vir conferir
    // os comandos: reler aqui é o que faz a tela mostrar a verdade.
    this.detectarPad();
    this.render();
    void this.refreshLabels();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.capturing = null;
    this.stopCapture();
    this.root.style.display = 'none';
    this.opts.onClose?.();
  }

  /** Busca os rótulos reais do layout e redesenha se mudaram. */
  private async refreshLabels(): Promise<void> {
    const codes = ACTIONS.map((a) => this.map[a.action]);
    this.labels = await resolveKeyLabels(codes);
    if (this.visible) this.render();
  }

  // ------------------------------------------------------ captura
  private captureHandler = (e: KeyboardEvent): void => {
    if (this.capturing === null) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
      this.capturing = null;
      this.notice = { text: 'Captura cancelada.', tone: 'bad' };
      this.stopCapture();
      this.render();
      return;
    }

    if (!isBindableCode(e.code)) {
      this.notice = {
        text: `${keyLabel(e.code)} é reservada pelo navegador ou pelo sistema.`,
        tone: 'bad',
      };
      this.render();
      return;
    }

    const action = this.capturing;
    const colisoes = conflictsFor(this.map, e.code, action);
    const next: Keymap = { ...this.map, [action]: e.code };

    // Conflito: a ação antiga fica SEM tecla em vez de duas ações
    // dispararem juntas. O jogador vê qual precisa reatribuir.
    for (const outra of colisoes) next[outra] = '';

    this.map = next;
    saveKeymap(this.map);
    this.opts.onChange?.(this.getKeymap());

    // O aviso do navegador vem primeiro: um conflito interno o jogador
    // resolve aqui mesmo, mas uma tecla disputada pelo navegador falha
    // só em pleno voo, quando não há como saber por quê.
    if (browserDisputaTecla(e.code)) {
      this.notice = {
        text: `${keyLabel(e.code)} costuma ser tomada pelo navegador — se o comando falhar no meio do jogo, é isso.`,
        tone: 'bad',
      };
    } else {
      this.notice = colisoes.length
        ? {
            text: `Tecla tomada de "${labelOf(colisoes[0]!)}" — reatribua essa ação.`,
            tone: 'bad',
          }
        : { text: 'Controle atualizado.', tone: 'good' };
    }

    this.capturing = null;
    this.stopCapture();
    this.render();
    void this.refreshLabels();
  };

  private startCapture(action: GameAction): void {
    this.capturing = action;
    this.notice = { text: 'Pressione a tecla desejada (Esc cancela).', tone: 'good' };
    // `capture: true` para pegar o evento antes de qualquer outro
    // handler — inclusive o do jogo.
    window.addEventListener('keydown', this.captureHandler, { capture: true });
    this.render();
  }

  private stopCapture(): void {
    window.removeEventListener('keydown', this.captureHandler, { capture: true });
  }

  // -------------------------------------------------------- render
  private display(code: string): string {
    if (!code) return '— sem tecla —';
    return this.labels.get(code) ?? keyLabel(code);
  }

  /**
   * Relê o controle conectado.
   *
   * Consultado ao ABRIR a tela, e não uma vez só na construção: o
   * jogador costuma conectar o controle justamente quando vem conferir
   * os comandos, e uma leitura única mostraria "nenhum detectado" para
   * sempre.
   */
  private detectarPad(): void {
    this.padConectado = false;
    this.padFamily = 'generic';
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    for (const g of navigator.getGamepads()) {
      if (g && g.connected) {
        this.padConectado = true;
        this.padFamily = detectFamily(g.id);
        return;
      }
    }
  }

  private render(): void {
    const padFamilyLabel = familyLabel(this.padFamily);
    const grupos = ['Pilotagem', 'Combate', 'Interface'] as const;
    const semTecla = ACTIONS.filter((a) => !this.map[a.action]).length;

    this.root.innerHTML = `
      <div class="kb-backdrop"></div>
      <div class="kb-frame">
        <header class="kb-top">
          <div>
            <div class="eyebrow">Configuração</div>
            <h2 class="kb-title">Controles</h2>
          </div>
          <button class="btn kb-close" id="kb-close" aria-label="Fechar controles">Fechar ✕</button>
        </header>

        <p class="kb-help">
          As teclas são gravadas pela <b>posição física</b>, então o mapa
          funciona igual em QWERTY, AZERTY e ABNT2. Clique numa ação e
          pressione a tecla que quiser.
        </p>

        <section class="kb-pad">
          <h3 class="kb-pad-title">
            Controle ${escapeHtml(padFamilyLabel)}
            <span class="kb-pad-status ${this.padConectado ? 'on' : ''}">
              ${this.padConectado ? 'conectado' : 'nenhum detectado'}
            </span>
          </h3>
          <p class="kb-help">
            Controles de PlayStation, Nintendo e Xbox funcionam assim que o
            <b>sistema</b> os conecta — por Bluetooth ou cabo, sem diferença.
            O navegador não faz o emparelhamento: pareie pelo sistema e o
            jogo reconhece sozinho. Modelos que não conhecemos funcionam
            igual, só com os nomes genéricos nos botões.
          </p>
          <div class="kb-pad-grid">
            ${padBindings(this.padFamily)
              .map(
                (b) =>
                  `<div class="kb-pad-row"><span>${escapeHtml(b.acao)}</span><b>${escapeHtml(b.botao)}</b></div>`,
              )
              .join('')}
          </div>
        </section>

        ${
          this.notice
            ? `<div class="kb-notice ${this.notice.tone}" role="status">${escapeHtml(this.notice.text)}</div>`
            : ''
        }
        ${
          semTecla > 0
            ? `<div class="kb-notice bad">${semTecla} ação(ões) sem tecla atribuída.</div>`
            : ''
        }

        <div class="kb-body">
          ${grupos
            .map((g) => {
              const itens = ACTIONS.filter((a) => a.group === g);
              if (itens.length === 0) return '';
              return `
              <section class="kb-group">
                <div class="eyebrow">${g}</div>
                ${itens.map((a) => this.rowHtml(a)).join('')}
              </section>`;
            })
            .join('')}
        </div>

        <footer class="kb-foot">
          <button class="btn" id="kb-reset">Restaurar padrão</button>
          <button class="btn btn-primary" id="kb-done">Concluído</button>
        </footer>
      </div>`;

    this.bind();
  }

  private rowHtml(a: ActionMeta): string {
    const code = this.map[a.action];
    const capturando = this.capturing === a.action;
    return `
      <div class="kb-row ${capturando ? 'capturing' : ''} ${code ? '' : 'unbound'}">
        <div class="kb-label">
          ${escapeHtml(a.label)}
          ${a.hint ? `<span class="kb-hint">${escapeHtml(a.hint)}</span>` : ''}
        </div>
        <button class="kb-key" data-action="${a.action}"
                aria-label="Alterar tecla de ${escapeHtml(a.label)}">
          ${capturando ? 'pressione…' : escapeHtml(this.display(code))}
        </button>
      </div>`;
  }

  private bind(): void {
    this.root.querySelector('#kb-close')?.addEventListener('click', () => this.close());
    this.root.querySelector('#kb-done')?.addEventListener('click', () => this.close());
    this.root.querySelector('.kb-backdrop')?.addEventListener('click', () => this.close());

    this.root.querySelector('#kb-reset')?.addEventListener('click', () => {
      this.map = resetKeymap();
      this.opts.onChange?.(this.getKeymap());
      this.notice = { text: 'Controles restaurados ao padrão.', tone: 'good' };
      this.render();
      void this.refreshLabels();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action as GameAction | undefined;
        if (a) this.startCapture(a);
      });
    });
  }
}

export function mountKeybindScreen(): KeybindScreen {
  const root = document.createElement('div');
  root.id = 'keybind-screen';
  document.body.appendChild(root);
  return new KeybindScreen(root);
}

function labelOf(action: GameAction): string {
  return ACTIONS.find((a) => a.action === action)?.label ?? action;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
