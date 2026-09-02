/**
 * Tipos do módulo de economia.
 */

export type CurrencyCode = 'gold' | 'credits' | 'dark_matter';

/** Wallet de uma conta: mapa currency → amount. */
export type Wallet = Record<CurrencyCode, number>;

export interface Transaction {
  id: number;
  fromAccountId: number | null;
  toAccountId: number | null;
  currency: CurrencyCode;
  amount: number;
  /** Razão: kill_reward, shop_buy, shop_sell, transfer, quest_reward, admin. */
  reason: string;
  /** Ref opcional (ex: quest_id, item_id). */
  refType: string | null;
  refId: string | null;
  createdAt: Date;
}

/**
 * Categoria do item na loja.
 *
 * `ship` e `skill` foram acrescentados para a loja vender nave completa e
 * habilidade ativa, além das peças (`mod_part`) e recursos que já existiam.
 */
export type ItemKind = 'mod_part' | 'consumable' | 'rare' | 'resource' | 'ship' | 'skill';

/**
 * O que a compra concede, por categoria. Guardado em `items.metadata`
 * (JSONB) para que um item novo não exija migração de schema.
 */
export interface ItemMetadata {
  /** `mod_part`: id do template no catálogo do estaleiro. */
  templateId?: string;
  /** `skill`: id da habilidade ativa destravada. */
  skillId?: 'Dash' | 'Emp' | 'Repair';
  /** `ship`: chassi concedido. */
  chassis?: 'interceptor' | 'skirmisher' | 'cruiser' | 'hauler';
  /** `ship`: slots que a nave traz de fábrica. */
  slots?: number;
  /** Tier/raridade, usado para colorir o card na loja. */
  tier?: 1 | 2 | 3 | 4 | 5;
}

export interface Item {
  id: number;
  code: string;
  kind: ItemKind;
  name: string;
  description: string;
  basePrice: number;
  /** Currency usada no preço (default 'credits'). */
  currency: CurrencyCode;
  stackable: boolean;
  /** Efeito da compra. Vazio para recursos puros. */
  metadata: ItemMetadata;
}

export interface ShopItem {
  itemId: number;
  /** Multiplicador sobre o basePrice (1.0 = preço padrão). */
  priceMultiplier: number;
  /** Estoque disponível; null = infinito. */
  stock: number | null;
}

export interface InventoryEntry {
  accountId: number;
  itemId: number;
  quantity: number;
}

/** Helpers. */
export function emptyWallet(): Wallet {
  return { gold: 0, credits: 0, dark_matter: 0 };
}

export function isValidCurrency(s: string): s is CurrencyCode {
  return s === 'gold' || s === 'credits' || s === 'dark_matter';
}
