/**
 * O segredo que assina os tokens não pode ter valor de fábrica.
 *
 * `JWT_SECRET` tinha um padrão silencioso (`dev-secret-change-me`), e os
 * dois `docker-compose.yml` traziam um segredo fixo. Quem lê o
 * repositório assina um token para qualquer conta — inclusive de
 * administrador. Um servidor que sobe assim não parece comprometido; só
 * está.
 */

import { describe, expect, it } from 'vitest';
import { resolveJwtSecret, SEGREDO_DE_DESENVOLVIMENTO } from '../src/config.js';

describe('segredo do JWT', () => {
  it('em desenvolvimento, a ausência não atrapalha', () => {
    expect(resolveJwtSecret(undefined, 'development')).toBe(SEGREDO_DE_DESENVOLVIMENTO);
  });

  it('em produção, a ausência derruba a subida', () => {
    expect(() => resolveJwtSecret(undefined, 'production')).toThrow(/JWT_SECRET/);
    expect(() => resolveJwtSecret('   ', 'production')).toThrow(/JWT_SECRET/);
  });

  it('em produção, o padrão de desenvolvimento é recusado', () => {
    // O caso perigoso: o valor existe, então nada acusa — e é público.
    expect(() => resolveJwtSecret(SEGREDO_DE_DESENVOLVIMENTO, 'production')).toThrow(/JWT_SECRET/);
  });

  it('em produção, um segredo curto é recusado', () => {
    expect(() => resolveJwtSecret('curto-demais', 'production')).toThrow(/32/);
  });

  it('um segredo próprio passa', () => {
    const bom = 'p'.repeat(48);
    expect(resolveJwtSecret(bom, 'production')).toBe(bom);
    expect(resolveJwtSecret(` ${bom} `, 'production')).toBe(bom);
  });
});
