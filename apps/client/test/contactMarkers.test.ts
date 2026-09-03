/**
 * Marcadores de contato.
 *
 * O caso que mais importa é o do contato ATRÁS da câmera: a projeção
 * produz coordenadas espelhadas, e usá-las sem checar coloca a seta
 * apontando para o lado oposto do que se deve virar — pior que não
 * mostrar nada, porque o jogador confia nela.
 */

import { describe, it, expect } from 'vitest';
import { markerFromProjection, type ContactMarker } from '../src/hud/ContactMarkers.js';

const L = 1440;
const A = 900;
const dados: Omit<ContactMarker, 'x' | 'y' | 'offscreen' | 'angle'> = {
  distance: 300,
  faction: 'hostile',
  isTarget: false,
  label: 'inimigo',
};

describe('contato dentro do campo de visão', () => {
  it('o centro da tela vira o centro em pixels', () => {
    const m = markerFromProjection({ x: 0, y: 0 }, true, L, A, dados);
    expect(m.offscreen).toBe(false);
    expect(m.x).toBeCloseTo(L / 2, 3);
    expect(m.y).toBeCloseTo(A / 2, 3);
  });

  it('o eixo Y é invertido, como manda a projeção', () => {
    // NDC cresce para CIMA; pixels crescem para BAIXO. Errar isto põe
    // o marcador espelhado na vertical, e o jogador vira para o lado
    // errado.
    const acima = markerFromProjection({ x: 0, y: 0.5 }, true, L, A, dados);
    expect(acima.y).toBeLessThan(A / 2);
  });

  it('a direita em NDC é a direita em pixels', () => {
    const dir = markerFromProjection({ x: 0.5, y: 0 }, true, L, A, dados);
    expect(dir.x).toBeGreaterThan(L / 2);
  });
});

describe('contato fora do campo de visão', () => {
  it('sai da tela e vira seta na borda', () => {
    const m = markerFromProjection({ x: 3, y: 0 }, true, L, A, dados);
    expect(m.offscreen).toBe(true);
    // Preso à borda, com margem.
    expect(m.x).toBeLessThan(L);
    expect(m.x).toBeGreaterThan(L / 2);
  });

  it('a seta fica presa ao retângulo da tela, não a um círculo', () => {
    // Num monitor largo, um círculo deixaria as setas laterais longe da
    // borda, onde o olho não as procura.
    const lado = markerFromProjection({ x: 5, y: 0 }, true, L, A, dados);
    expect(lado.x).toBeCloseTo(L / 2 + (L / 2 - 34), 1);
  });

  it('o marcador nunca escapa da tela', () => {
    for (const [x, y] of [
      [9, 9],
      [-9, 9],
      [9, -9],
      [-9, -9],
      [0, 12],
      [12, 0],
    ]) {
      const m = markerFromProjection({ x: x!, y: y! }, true, L, A, dados);
      expect(m.x, `x com ndc ${x},${y}`).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(L);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(A);
    }
  });
});

describe('contato atrás da câmera', () => {
  it('é sempre tratado como fora da tela', () => {
    // Mesmo com NDC dentro de -1..1, o que está atrás não pode ser
    // desenhado como se estivesse à frente.
    const m = markerFromProjection({ x: 0.1, y: 0.1 }, false, L, A, dados);
    expect(m.offscreen).toBe(true);
  });

  it('a seta aponta para o lado CERTO de virar', () => {
    // Atrás da câmera o sinal do NDC se inverte. Sem espelhar, a seta
    // manda virar para o lado oposto — e o jogador confia nela.
    const atras = markerFromProjection({ x: 0.5, y: 0 }, false, L, A, dados);
    const frente = markerFromProjection({ x: 0.5, y: 0 }, true, L, A, dados);
    // O mesmo NDC, à frente e atrás, tem que produzir lados OPOSTOS.
    expect(Math.sign(atras.x - L / 2)).toBe(-Math.sign(frente.x - L / 2));
  });

  it('não produz NaN com NDC degenerado', () => {
    const m = markerFromProjection({ x: 0, y: 0 }, false, L, A, dados);
    expect(Number.isFinite(m.x)).toBe(true);
    expect(Number.isFinite(m.y)).toBe(true);
    expect(Number.isFinite(m.angle)).toBe(true);
  });
});

describe('dados do contato', () => {
  it('preserva facção, alvo e rótulo', () => {
    const m = markerFromProjection({ x: 0, y: 0 }, true, L, A, {
      ...dados,
      faction: 'ally',
      isTarget: true,
      label: 'Ala',
    });
    expect(m.faction).toBe('ally');
    expect(m.isTarget).toBe(true);
    expect(m.label).toBe('Ala');
  });
});
