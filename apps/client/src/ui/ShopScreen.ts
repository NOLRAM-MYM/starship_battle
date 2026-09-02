import {
  buyItem,
  currencyLabel,
  currencySymbol,
  fetchInventory,
  fetchShop,
  fetchWallet,
  ShopError,
  type CurrencyCode,
  type Item,
  type ItemKind,
  type ShopEntry,
  type Wallet,
} from '../net/economyApi';
import './ShopScreen.css';

/**
 * Loja do jogo.
 *
 * Vende as quatro coisas que o jogador quer comprar: naves inteiras,
 * habilidades ativas, peças de nave e consumíveis. A compra passa pela
 * mesma transação atômica da API (`FOR UPDATE` na carteira e no estoque),
 * então dois cliques simultâneos não geram crédito duplicado.
 *
 * O que já foi comprado aparece como "Adquirido" e deixa de ser
 * comprável para itens não empilháveis — a checagem final continua sendo
 * do servidor; aqui é só para não oferecer o que não faz sentido.
 */

/** Abas da loja, na ordem em que aparecem. */
const TABS: Array<{ id: ItemKind | 'all'; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'ship', label: 'Naves' },
  { id: 'mod_part', label: 'Peças' },
  { id: 'skill', label: 'Habilidades' },
  { id: 'consumable', label: 'Consumíveis' },
];

const KIND_GLYPH: Record<ItemKind, string> = {
  ship: '▲',
  mod_part: '◈',
  skill: '✦',
  consumable: '◍',
  resource: '▤',
  rare: '◆',
};

export interface ShopScreenOptions {
  /** Chamado após uma compra bem-sucedida (hangar recarrega o estado). */
  onPurchase?: (item: Item) => void;
  /** Chamado ao fechar a loja. */
  onClose?: () => void;
}

export class ShopScreen {
  private root: HTMLElement;
  private opts: ShopScreenOptions;

  private entries: ShopEntry[] = [];
  private wallet: Wallet = { gold: 0, credits: 0, dark_matter: 0 };
  /** itemId -> quantidade possuída. */
  private owned = new Map<number, number>();

  private tab: ItemKind | 'all' = 'all';
  private visible = false;
  private loading = false;
  private message: { text: string; tone: 'good' | 'bad' } | null = null;
  /** Item cuja compra está em voo, para travar só aquele botão. */
  private buying: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.opts = {};
    this.root.classList.add('shop-screen');
    this.root.style.display = 'none';
    this.render();
  }

  setOptions(opts: ShopScreenOptions): void {
    this.opts = opts;
  }

  isOpen(): boolean {
    return this.visible;
  }

  async open(): Promise<void> {
    this.visible = true;
    this.root.style.display = 'block';
    await this.reload();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
    this.opts.onClose?.();
  }

  /** Ids de template (peças) que o jogador possui — o estaleiro usa isto. */
  ownedTemplateIds(): string[] {
    const out: string[] = [];
    for (const entry of this.entries) {
      const tpl = entry.item.metadata?.templateId;
      if (tpl && (this.owned.get(entry.item.id) ?? 0) > 0) out.push(tpl);
    }
    return out;
  }

  /** Habilidades ativas destravadas por compra. */
  ownedSkillIds(): string[] {
    const out: string[] = [];
    for (const entry of this.entries) {
      const skill = entry.item.metadata?.skillId;
      if (skill && (this.owned.get(entry.item.id) ?? 0) > 0) out.push(skill);
    }
    return out;
  }

  /**
   * Carrega catálogo e inventário SEM exibir a loja.
   *
   * Usado no boot para o estaleiro já saber o que o jogador possui —
   * abrir e fechar a tela só para ler o inventário faria a UI piscar.
   */
  async loadOwnership(): Promise<void> {
    const [shop, wallet, inventory] = await Promise.all([
      fetchShop(),
      fetchWallet(),
      fetchInventory(),
    ]);
    this.entries = shop;
    this.wallet = wallet;
    this.owned = new Map(inventory.map((i) => [i.itemId, i.quantity]));
  }

  private async reload(): Promise<void> {
    this.loading = true;
    this.render();
    try {
      // Em paralelo: as três chamadas são independentes e a loja só
      // fica utilizável quando as três chegam.
      const [shop, wallet, inventory] = await Promise.all([
        fetchShop(),
        fetchWallet(),
        fetchInventory(),
      ]);
      this.entries = shop;
      this.wallet = wallet;
      this.owned = new Map(inventory.map((i) => [i.itemId, i.quantity]));
      this.message = null;
    } catch (err) {
      this.message = {
        text: err instanceof ShopError ? err.message : 'Falha ao carregar a loja.',
        tone: 'bad',
      };
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private canAfford(entry: ShopEntry): boolean {
    return this.wallet[entry.item.currency] >= entry.finalPrice;
  }

  private isOwned(entry: ShopEntry): boolean {
    // Empilháveis (consumíveis) sempre podem ser comprados de novo.
    if (entry.item.stackable) return false;
    return (this.owned.get(entry.item.id) ?? 0) > 0;
  }

  private outOfStock(entry: ShopEntry): boolean {
    const stock = entry.shop?.stock;
    return stock !== null && stock !== undefined && stock <= 0;
  }

  private async purchase(entry: ShopEntry): Promise<void> {
    if (this.buying !== null) return;
    this.buying = entry.item.id;
    this.render();
    try {
      await buyItem(entry.item.id, 1);
      this.message = { text: `${entry.item.name} adquirido.`, tone: 'good' };
      this.opts.onPurchase?.(entry.item);
      // Recarrega carteira e inventário: o servidor é a verdade sobre
      // saldo e estoque, não o estado otimista daqui.
      const [wallet, inventory] = await Promise.all([fetchWallet(), fetchInventory()]);
      this.wallet = wallet;
      this.owned = new Map(inventory.map((i) => [i.itemId, i.quantity]));
    } catch (err) {
      this.message = {
        text: err instanceof ShopError ? err.message : 'Não foi possível concluir a compra.',
        tone: 'bad',
      };
    } finally {
      this.buying = null;
      this.render();
    }
  }

  private visibleEntries(): ShopEntry[] {
    if (this.tab === 'all') return this.entries;
    return this.entries.filter((e) => e.item.kind === this.tab);
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="shop-backdrop"></div>
      <div class="shop-frame">
        <header class="shop-top">
          <div>
            <div class="eyebrow">Mercado orbital</div>
            <h2 class="shop-title">Loja</h2>
          </div>
          <div class="shop-wallet">${this.walletHtml()}</div>
          <button class="btn shop-close" id="shop-close" aria-label="Fechar loja">Fechar ✕</button>
        </header>

        <nav class="shop-tabs" role="tablist">
          ${TABS.map(
            (t) => `<button class="chip ${this.tab === t.id ? 'active' : ''}"
                      role="tab" aria-selected="${this.tab === t.id}"
                      data-tab="${t.id}">${t.label}</button>`,
          ).join('')}
        </nav>

        ${
          this.message
            ? `<div class="shop-msg ${this.message.tone}" role="status">${escapeHtml(this.message.text)}</div>`
            : ''
        }

        <div class="shop-body">
          ${
            this.loading
              ? `<div class="shop-empty">Carregando catálogo…</div>`
              : this.gridHtml()
          }
        </div>
      </div>`;

    this.bind();
  }

  private walletHtml(): string {
    const order: CurrencyCode[] = ['credits', 'gold', 'dark_matter'];
    return order
      .map(
        (c) => `<span class="wallet-chip wallet-${c}" title="${currencyLabel(c)}">
                  <b>${currencySymbol(c)}</b> ${formatNumber(this.wallet[c])}
                </span>`,
      )
      .join('');
  }

  private gridHtml(): string {
    const list = this.visibleEntries();
    if (list.length === 0) {
      return `<div class="shop-empty">Nada nesta categoria por enquanto.</div>`;
    }
    return `<div class="shop-grid">${list.map((e) => this.cardHtml(e)).join('')}</div>`;
  }

  private cardHtml(entry: ShopEntry): string {
    const { item } = entry;
    const tier = item.metadata?.tier ?? 1;
    const owned = this.isOwned(entry);
    const afford = this.canAfford(entry);
    const empty = this.outOfStock(entry);
    const busy = this.buying === item.id;
    const qty = this.owned.get(item.id) ?? 0;

    let label = 'Comprar';
    let disabled = false;
    if (busy) {
      label = 'Comprando…';
      disabled = true;
    } else if (owned) {
      label = 'Adquirido';
      disabled = true;
    } else if (empty) {
      label = 'Esgotado';
      disabled = true;
    } else if (!afford) {
      label = 'Sem saldo';
      disabled = true;
    }

    const stock = entry.shop?.stock;
    const stockNote =
      stock === null || stock === undefined
        ? ''
        : `<span class="shop-stock">${stock} em estoque</span>`;

    return `
      <article class="shop-card ${owned ? 'owned' : ''}" data-tier="${tier}">
        <div class="shop-card-top">
          <span class="shop-glyph">${KIND_GLYPH[item.kind]}</span>
          <span class="shop-name">${escapeHtml(item.name)}</span>
          ${qty > 0 && item.stackable ? `<span class="shop-qty">x${qty}</span>` : ''}
        </div>
        <p class="shop-desc">${escapeHtml(item.description)}</p>
        <div class="shop-card-foot">
          <span class="shop-price ${afford || owned ? '' : 'short'}">
            <b>${currencySymbol(item.currency)}</b> ${formatNumber(entry.finalPrice)}
          </span>
          ${stockNote}
          <button class="btn ${owned ? '' : 'btn-primary'} shop-buy"
                  data-buy="${item.id}" ${disabled ? 'disabled' : ''}>${label}</button>
        </div>
      </article>`;
  }

  private bind(): void {
    this.root.querySelector('#shop-close')?.addEventListener('click', () => this.close());
    this.root.querySelector('.shop-backdrop')?.addEventListener('click', () => this.close());

    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.tab;
        this.tab = (v === 'all' ? 'all' : (v as ItemKind)) ?? 'all';
        this.render();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.buy);
        const entry = this.entries.find((e) => e.item.id === id);
        if (entry) void this.purchase(entry);
      });
    });
  }
}

export function mountShopScreen(): ShopScreen {
  const root = document.createElement('div');
  root.id = 'shop-screen';
  document.body.appendChild(root);
  return new ShopScreen(root);
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
