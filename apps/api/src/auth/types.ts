/**
 * Tipos compartilhados do módulo de auth.
 */

/**
 * Papel da conta.
 *
 * `gm` (Game Master) libera as rotas `/gm/*`, que administram economia,
 * progressão e contas. `player` é o padrão de toda conta criada por
 * signup — promoção é sempre ato explícito.
 */
export type AccountRole = 'player' | 'gm';

export function isAccountRole(v: unknown): v is AccountRole {
  return v === 'player' || v === 'gm';
}

export interface Account {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
  createdAt: Date;
  updatedAt: Date;
}

/** Conta sem o hash (para retornar ao cliente). */
export type PublicAccount = Omit<Account, 'passwordHash'>;

export function toPublicAccount(acc: Account): PublicAccount {
  const { passwordHash: _ph, ...rest } = acc;
  return rest;
}
