/**
 * Lógica de negócio de economia.
 *
 * Camada fina sobre o repository: converte erros em códigos HTTP-friendly
 * via EconomyError.
 */

import {
  buyItem,
  credit,
  DbUnavailableError,
  getWallet,
  InsufficientFundsError,
  ItemNotInShopError,
  listInventory,
  listItems,
  listShop,
  listTransactions,
  OutOfStockError,
  SelfTransferError,
  transfer,
  type ShopView,
  type TransferParams,
} from './repository.js';
import type { CurrencyCode, Item, Transaction, Wallet } from './types.js';
import { isValidCurrency } from './types.js';

export class EconomyError extends Error {
  constructor(
    public readonly code:
      | 'db_unavailable'
      | 'insufficient_funds'
      | 'invalid_input'
      | 'item_not_found'
      | 'item_not_in_shop'
      | 'out_of_stock'
      | 'self_transfer',
    message: string,
  ) {
    super(message);
    this.name = 'EconomyError';
  }
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof DbUnavailableError) {
      throw new EconomyError('db_unavailable', 'banco indisponível');
    }
    if (err instanceof InsufficientFundsError) {
      throw new EconomyError('insufficient_funds', err.message);
    }
    if (err instanceof SelfTransferError) {
      throw new EconomyError('self_transfer', err.message);
    }
    if (err instanceof ItemNotInShopError) {
      throw new EconomyError('item_not_in_shop', err.message);
    }
    if (err instanceof OutOfStockError) {
      throw new EconomyError('out_of_stock', err.message);
    }
    throw err;
  });
}

export async function getWalletService(accountId: number): Promise<Wallet> {
  return wrap(() => getWallet(accountId));
}

export async function transferService(params: TransferParams): Promise<Transaction> {
  if (!isValidCurrency(params.currency)) {
    throw new EconomyError('invalid_input', 'currency inválida');
  }
  if (params.amount <= 0) {
    throw new EconomyError('invalid_input', 'amount deve ser > 0');
  }
  return wrap(() => transfer(params));
}

export async function creditService(
  toAccountId: number,
  currency: CurrencyCode,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): Promise<Transaction> {
  if (!isValidCurrency(currency)) {
    throw new EconomyError('invalid_input', 'currency inválida');
  }
  return wrap(() => credit(toAccountId, currency, amount, reason, refType, refId));
}

export async function listItemsService(): Promise<Item[]> {
  return wrap(() => listItems());
}

export async function listShopService(): Promise<ShopView[]> {
  return wrap(() => listShop());
}

export async function buyItemService(
  accountId: number,
  itemId: number,
  quantity: number,
): Promise<Transaction> {
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new EconomyError('invalid_input', 'itemId inválido');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new EconomyError('invalid_input', 'quantity deve ser > 0');
  }
  if (quantity > 1000) {
    throw new EconomyError('invalid_input', 'quantity máxima: 1000');
  }
  return wrap(() => buyItem(accountId, itemId, quantity));
}

export async function listInventoryService(accountId: number) {
  return wrap(() => listInventory(accountId));
}

export async function listTransactionsService(accountId: number, limit: number) {
  return wrap(() => listTransactions(accountId, limit));
}
