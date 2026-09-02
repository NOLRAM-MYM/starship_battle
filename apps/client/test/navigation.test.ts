/**
 * Testes da matemática de navegação (bússola e marcadores de borda).
 * Módulo puro: sem three.js, sem DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  angleDelta,
  bearingTo,
  cardinalMarks,
  compassMarks,
  edgeMarker,
  formatDistance,
  headingFromForward,
  type NavPoint,
} from '../src/game/navigation.js';
import { detailFromTiers } from '../src/render/ShipMesh.js';

const origem = { x: 0, y: 0, z: 0 };

describe('rumo', () => {
  it('-Z é o norte (0°) e +X é leste (90°)', () => {
    expect(bearingTo(origem, { x: 0, y: 0, z: -100 })).toBeCloseTo(0, 4);
    expect(bearingTo(origem, { x: 100, y: 0, z: 0 })).toBeCloseTo(90, 4);
    expect(bearingTo(origem, { x: 0, y: 0, z: 100 })).toBeCloseTo(180, 4);
    expect(bearingTo(origem, { x: -100, y: 0, z: 0 })).toBeCloseTo(270, 4);
  });

  it('headingFromForward casa com bearingTo', () => {
    expect(headingFromForward({ x: 0, y: 0, z: -1 })).toBeCloseTo(0, 4);
    expect(headingFromForward({ x: 1, y: 0, z: 0 })).toBeCloseTo(90, 4);
  });

  it('a altura não muda o rumo (é projeção no plano XZ)', () => {
    expect(bearingTo(origem, { x: 0, y: 9999, z: -100 })).toBeCloseTo(0, 4);
  });
});

describe('angleDelta', () => {
  it('devolve o menor arco, com sinal', () => {
    expect(angleDelta(0, 90)).toBe(90);
    expect(angleDelta(90, 0)).toBe(-90);
  });

  it('atravessa o zero sem dar a volta de 359°', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });

  it('normaliza o caso oposto para +180', () => {
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(180, 0)).toBe(180);
  });
});

describe('fita da bússola', () => {
  const pontos: NavPoint[] = [
    { id: 'a', name: 'À frente', kind: 'planet', position: { x: 0, y: 0, z: -500 }, color: 0xffffff },
    { id: 'b', name: 'Atrás', kind: 'planet', position: { x: 0, y: 0, z: 500 }, color: 0xffffff },
    { id: 'c', name: 'Perto', kind: 'belt', position: { x: 60, y: 0, z: -60 }, color: 0xffffff },
  ];

  it('quem está à frente cai no centro da fita', () => {
    const m = compassMarks(origem, 0, [pontos[0]!]);
    expect(m[0]!.ribbonPos).toBeCloseTo(0.5, 4);
  });

  it('quem está atrás sai da fita', () => {
    const m = compassMarks(origem, 0, [pontos[1]!]);
    expect(m[0]!.ribbonPos).toBeNull();
  });

  it('ordena do mais próximo ao mais distante', () => {
    const m = compassMarks(origem, 0, pontos);
    expect(m[0]!.point.id).toBe('c');
  });

  it('cardeais aparecem só dentro do campo da fita', () => {
    const c = cardinalMarks(0, 150);
    const labels = c.map((x) => x.label);
    expect(labels).toContain('N');
    // Sul está a 180°, fora de uma janela de ±75°.
    expect(labels).not.toContain('S');
  });

  it('a fita acompanha a virada da nave', () => {
    // Virando 45° para leste, o marco ao norte desliza para a esquerda
    // da fita. (A 90° ele já sairia dela: o campo é de 150°, ±75°.)
    const m = compassMarks(origem, 45, [pontos[0]!]);
    expect(m[0]!.ribbonPos).not.toBeNull();
    expect(m[0]!.ribbonPos!).toBeLessThan(0.5);
  });

  it('some da fita quando passa do campo de 150°', () => {
    const m = compassMarks(origem, 90, [pontos[0]!]);
    expect(m[0]!.ribbonPos).toBeNull();
  });
});

describe('marcador de borda', () => {
  it('fica dentro do retângulo, respeitando a margem', () => {
    const e = edgeMarker(120, 0, 1000, 800, 50);
    expect(e.x).toBeGreaterThanOrEqual(0);
    expect(e.x).toBeLessThanOrEqual(1000);
    expect(e.y).toBeGreaterThanOrEqual(0);
    expect(e.y).toBeLessThanOrEqual(800);
  });

  it('marca como visível o que está quase à frente', () => {
    expect(edgeMarker(5, 0, 1000, 800).onScreen).toBe(true);
    expect(edgeMarker(120, 0, 1000, 800).onScreen).toBe(false);
  });

  it('alvo à direita vai para a metade direita da tela', () => {
    expect(edgeMarker(90, 0, 1000, 800).x).toBeGreaterThan(500);
    expect(edgeMarker(-90, 0, 1000, 800).x).toBeLessThan(500);
  });

  it('alvo acima vai para a metade de cima', () => {
    expect(edgeMarker(0, 1, 1000, 800).y).toBeLessThan(400);
  });
});

describe('formatDistance', () => {
  it('usa unidades abaixo de 1000 e km acima', () => {
    expect(formatDistance(850)).toBe('850 u');
    expect(formatDistance(4200)).toBe('4.2 km');
    expect(formatDistance(18000)).toBe('18 km');
  });

  it('lida com entrada inválida', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDistance(-1)).toBe('—');
  });
});

describe('evolução visual da nave', () => {
  it('sem peças não há detalhe extra', () => {
    expect(detailFromTiers([])).toBe(0);
  });

  it('usa a MÉDIA dos tiers, não a soma', () => {
    // Oito peças comuns não podem parecer mais avançadas que três lendárias.
    expect(detailFromTiers([1, 1, 1, 1, 1, 1, 1, 1])).toBe(0);
    expect(detailFromTiers([5, 5, 5])).toBe(4);
  });

  it('satura no máximo', () => {
    expect(detailFromTiers([5, 5, 5, 5, 5, 5])).toBe(4);
  });

  it('cresce de forma monotônica com o tier médio', () => {
    const níveis = [1, 2, 3, 4, 5].map((t) => detailFromTiers([t, t]));
    for (let i = 1; i < níveis.length; i++) {
      expect(níveis[i]!).toBeGreaterThanOrEqual(níveis[i - 1]!);
    }
  });
});
