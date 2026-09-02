/**
 * Cliente HTTP da economia (carteira, loja, inventário).
 *
 * Espelha as rotas de `apps/api/src/economy/routes.ts`. Toda chamada é
 * autenticada com o mesmo bearer token do resto do app; sem token, as
 * funções falham cedo com uma mensagem que a UI sabe exibir, em vez de
 * mandar um request que voltaria 401.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080';

export type CurrencyCode = 'gold' | 'credits' | 'dark_matter';

export type Wallet = Record<CurrencyCode, number>;

export type ItemKind = 'mod_part' | 'consumable' | 'rare' | 'resource' | 'ship' | 'skill';

export interface ItemMetadata {
  templateId?: string;
  skillId?: 'Dash' | 'Emp' | 'Repair';
  chassis?: 'interceptor' | 'skirmisher' | 'cruiser' | 'hauler';
  slots?: number;
  tier?: 1 | 2 | 3 | 4 | 5;
}

export interface Item {
  id: number;
  code: string;
  kind: ItemKind;
  name: string;
  description: string;
  basePrice: number;
  currency: CurrencyCode;
  stackable: boolean;
  metadata: ItemMetadata;
}

export interface ShopEntry {
  item: Item;
  /** `stock: null` = estoque infinito. */
  shop: { itemId: number; priceMultiplier: number; stock: number | null } | null;
  /** Preço já com o multiplicador aplicado. */
  finalPrice: number;
}

export interface InventoryEntry {
  accountId: number;
  itemId: number;
  quantity: number;
}

/** Erro de economia com o código da API, para a UI reagir por caso. */
export class ShopError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ShopError';
    this.code = code;
  }
}

/** Mensagens em português para os códigos que a API devolve. */
const MESSAGES: Record<string, string> = {
  unauthorized: 'Sessão expirada. Entre novamente.',
  db_unavailable: 'Serviço de economia indisponível no momento.',
  insufficient_funds: 'Créditos insuficientes para esta compra.',
  invalid_input: 'Pedido inválido.',
  item_not_found: 'Este item não existe mais.',
  item_not_in_shop: 'Este item não está à venda.',
  out_of_stock: 'Estoque esgotado.',
  self_transfer: 'Você não pode transferir para si mesmo.',
  network: 'Não foi possível falar com o servidor. Ele está no ar?',
};

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  if (!token) throw new ShopError('unauthorized', MESSAGES.unauthorized!);
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...authHeader(), ...(init?.headers ?? {}) },
    });
  } catch {
    // `fetch` rejeita com TypeError quando a API está fora do ar; a
    // mensagem crua ("Failed to fetch") não ajuda o jogador.
    throw new ShopError('network', MESSAGES.network!);
  }

  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
    } catch {
      // Corpo não-JSON: fica o código HTTP genérico.
    }
    throw new ShopError(code, MESSAGES[code] ?? `Falha na operação (${code}).`);
  }
  return (await res.json()) as T;
}

export async function fetchWallet(): Promise<Wallet> {
  const { wallet } = await request<{ wallet: Wallet }>('/economy/wallet');
  return wallet;
}

export async function fetchShop(): Promise<ShopEntry[]> {
  const { shop } = await request<{ shop: ShopEntry[] }>('/economy/shop');
  return shop;
}

export async function fetchInventory(): Promise<InventoryEntry[]> {
  const { inventory } = await request<{ inventory: InventoryEntry[] }>('/economy/inventory');
  return inventory;
}

export async function buyItem(itemId: number, quantity = 1): Promise<void> {
  await request('/economy/shop/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, quantity }),
  });
}

/** Símbolo curto de cada moeda, para os preços na loja. */
export function currencySymbol(c: CurrencyCode): string {
  switch (c) {
    case 'credits': return 'C';
    case 'gold': return 'Au';
    case 'dark_matter': return 'DM';
  }
}

export function currencyLabel(c: CurrencyCode): string {
  switch (c) {
    case 'credits': return 'Créditos';
    case 'gold': return 'Ouro';
    case 'dark_matter': return 'Matéria Escura';
  }
}
