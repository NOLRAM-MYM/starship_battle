/**
 * Lógica de negócio de auth: signup, login, logout, me.
 */

import { hashPassword, verifyPassword } from './passwords.js';
import { signToken, verifyToken } from './tokens.js';
import {
  createAccount,
  findAccountByEmail,
  findAccountById,
  findAccountByUsername,
  isUniqueViolation,
} from './repository.js';
import type { PublicAccount } from './types.js';
import { toPublicAccount } from './types.js';

export class AuthError extends Error {
  constructor(
    public readonly code:
      | 'invalid_input'
      | 'email_taken'
      | 'username_taken'
      | 'invalid_credentials'
      | 'db_unavailable'
      | 'invalid_token',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SignupResult {
  account: PublicAccount;
  token: string;
}

export async function signup(
  username: string,
  email: string,
  password: string,
): Promise<SignupResult> {
  // Validação básica (zod é aplicado nas routes para mensagens 400 melhores).
  if (username.length < 3 || username.length > 32) {
    throw new AuthError(
      'invalid_input',
      'username deve ter entre 3 e 32 caracteres',
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AuthError('invalid_input', 'email inválido');
  }
  if (password.length < 8) {
    throw new AuthError('invalid_input', 'password deve ter >= 8 caracteres');
  }

  const hash = await hashPassword(password);
  try {
    const account = await createAccount(username, email, hash);
    const token = signToken({
      accountId: account.id,
      username: account.username,
      role: account.role,
    });
    return { account: toPublicAccount(account), token };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Diferencia email vs username checando qual existe.
      const [byEmail, byUsername] = await Promise.all([
        findAccountByEmail(email).catch(() => null),
        findAccountByUsername(username).catch(() => null),
      ]);
      if (byEmail) throw new AuthError('email_taken', 'email já cadastrado');
      if (byUsername)
        throw new AuthError('username_taken', 'username já cadastrado');
      throw new AuthError('invalid_input', 'conflito único desconhecido');
    }
    if (err instanceof Error && err.name === 'DbUnavailableError') {
      throw new AuthError('db_unavailable', 'banco de dados indisponível');
    }
    throw err;
  }
}

export interface LoginResult {
  account: PublicAccount;
  token: string;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  let account;
  try {
    account = await findAccountByEmail(email);
  } catch (err) {
    if (err instanceof Error && err.name === 'DbUnavailableError') {
      throw new AuthError('db_unavailable', 'banco de dados indisponível');
    }
    throw err;
  }
  if (!account) {
    // Mensagem genérica para evitar enumeração de emails.
    throw new AuthError('invalid_credentials', 'credenciais inválidas');
  }
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) {
    throw new AuthError('invalid_credentials', 'credenciais inválidas');
  }
  const token = signToken({
    accountId: account.id,
    username: account.username,
    role: account.role,
  });
  return { account: toPublicAccount(account), token };
}

export async function getMe(
  token: string,
): Promise<PublicAccount> {
  const payload = verifyToken(token);
  if (!payload) throw new AuthError('invalid_token', 'token inválido');
  const id = Number.parseInt(payload.sub, 10);
  if (!Number.isFinite(id)) {
    throw new AuthError('invalid_token', 'token inválido');
  }
  let account;
  try {
    account = await findAccountById(id);
  } catch (err) {
    if (err instanceof Error && err.name === 'DbUnavailableError') {
      throw new AuthError('db_unavailable', 'banco de dados indisponível');
    }
    throw err;
  }
  if (!account) {
    throw new AuthError('invalid_token', 'conta não encontrada');
  }
  return toPublicAccount(account);
}
