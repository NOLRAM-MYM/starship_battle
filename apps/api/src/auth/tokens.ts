/**
 * Tokens JWT.
 *
 * Stateless: o payload contém o account id e expiry.
 * Sessões revogáveis (logout) são registradas em Redis (Task 3.2.2).
 */

import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';
import { isAccountRole, type AccountRole } from './types.js';

export interface JwtPayload {
  /** Subject = account id (string). */
  sub: string;
  /** Username (cache para evitar hit no DB). */
  username: string;
  /**
   * Papel da conta, embutido para que o guard de GM não precise
   * consultar o banco a cada request. Tokens emitidos antes desta
   * mudança não têm o campo — tratados como `player`, que é o
   * padrão seguro (nega acesso em vez de conceder).
   */
  role: AccountRole;
  /** Issued at (epoch seconds). */
  iat?: number | undefined;
  /** Expiry (epoch seconds). */
  exp?: number | undefined;
}

export function signToken(payload: {
  accountId: number;
  username: string;
  role?: AccountRole;
}): string {
  const config = loadConfig();
  return jwt.sign(
    {
      sub: String(payload.accountId),
      username: payload.username,
      role: payload.role ?? 'player',
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresSec },
  );
}

export function verifyToken(token: string): JwtPayload | null {
  const config = loadConfig();
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const d = decoded as Record<string, unknown>;
    if (typeof d.sub !== 'string' || typeof d.username !== 'string') return null;
    return {
      sub: d.sub,
      username: d.username,
      // Fail-closed: token sem papel (ou com papel desconhecido) vira
      // `player`. Nunca promovemos por ausência de informação.
      role: isAccountRole(d.role) ? d.role : 'player',
      iat: typeof d.iat === 'number' ? d.iat : undefined,
      exp: typeof d.exp === 'number' ? d.exp : undefined,
    };
  } catch {
    return null;
  }
}
