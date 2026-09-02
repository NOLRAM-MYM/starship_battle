/**
 * Hashing de senha com bcrypt.
 *
 * Custo configurável via BCRYPT_COST env (default 12). Em produção,
 * aumentar gradualmente conforme a capacidade do hardware.
 */

import bcrypt from 'bcrypt';
import { loadConfig } from '../config.js';

export async function hashPassword(plain: string): Promise<string> {
  const cost = loadConfig().bcryptCost;
  return bcrypt.hash(plain, cost);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
