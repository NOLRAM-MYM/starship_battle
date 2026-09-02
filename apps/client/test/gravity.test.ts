/**
 * Testes da previsão de trajetória.
 *
 * O risco principal aqui é DIVERGIR do servidor: a curva desenhada usa a
 * mesma fórmula, e se os dois lados discordarem o jogador vê uma linha
 * plausível levando ao lugar errado. Por isso as constantes chegam pela
 * rede e estes testes fixam o comportamento da matemática.
 */

import { describe, it, expect } from 'vitest';
import {
  captureRadius,
  dominantBody,
  escapeSpeed,
  gravityAt,
  gravityTotal,
  influenceRadius,
  influenceScale,
  magnitude,
  predictTrajectory,
  type GravityBody,
} from '../src/game/gravity.js';

const G = 125;

function corpo(over: Partial<GravityBody> = {}): GravityBody {
  return {
    id: 1,
    name: 'Teste',
    kind: 'Planet',
    pos: [0, 0, 0],
    radius: 500,
    mass: 500 * 500 * 6,
    color: 0xffffff,
    ...over,
  };
}

describe('campo gravitacional', () => {
  it('é nulo fora do raio de influência', () => {
    const b = corpo();
    const longe = { x: influenceRadius(b) * 2, y: 0, z: 0 };
    expect(magnitude(gravityAt(b, longe, G))).toBe(0);
  });

  it('aponta para o corpo', () => {
    const b = corpo();
    const g = gravityAt(b, { x: 1000, y: 0, z: 0 }, G);
    expect(g.x).toBeLessThan(0);
    expect(Math.abs(g.y)).toBeLessThan(1e-6);
  });

  it('cresce ao aproximar', () => {
    const b = corpo();
    const perto = magnitude(gravityAt(b, { x: 800, y: 0, z: 0 }, G));
    const longe = magnitude(gravityAt(b, { x: 3000, y: 0, z: 0 }, G));
    expect(perto).toBeGreaterThan(longe);
  });

  it('satura na superfície em vez de explodir', () => {
    const b = corpo();
    const superficie = magnitude(gravityAt(b, { x: b.radius, y: 0, z: 0 }, G));
    const dentro = magnitude(gravityAt(b, { x: 1, y: 0, z: 0 }, G));
    expect(Number.isFinite(dentro)).toBe(true);
    expect(dentro).toBeLessThanOrEqual(superficie * 1.001);
  });

  it('soma a contribuição de vários corpos', () => {
    // Dois corpos opostos e iguais se cancelam no meio.
    const a = corpo({ id: 1, pos: [-1000, 0, 0] });
    const b = corpo({ id: 2, pos: [1000, 0, 0] });
    const g = gravityTotal([a, b], { x: 0, y: 0, z: 0 }, G);
    expect(Math.abs(g.x)).toBeLessThan(1e-4);
  });

  it('corpos compactos têm influência relativa maior', () => {
    // Espelha `BodyKind::influence_scale` no servidor.
    expect(influenceScale('BlackHole')).toBeGreaterThan(influenceScale('Planet'));
    expect(influenceScale('NeutronStar')).toBeGreaterThan(influenceScale('GasGiant'));
    expect(influenceScale('Planet')).toBe(14);
  });
});

describe('previsão de trajetória', () => {
  it('sem gravidade, a curva é uma reta', () => {
    const t = predictTrajectory([], { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, G, {
      step: 0.5,
      steps: 10,
    });
    expect(t.impact).toBeNull();
    // Todos os pontos sobre o eixo X.
    for (const p of t.points) {
      expect(Math.abs(p.y)).toBeLessThan(1e-6);
      expect(Math.abs(p.z)).toBeLessThan(1e-6);
    }
    // E avançando sempre no mesmo sentido.
    expect(t.points[t.points.length - 1]!.x).toBeGreaterThan(t.points[0]!.x);
  });

  it('detecta impacto quando a nave cai no corpo', () => {
    const b = corpo();
    // Parada logo acima da superfície: só pode cair.
    const t = predictTrajectory(
      [b],
      { x: b.radius * 1.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      G,
      { step: 0.2, steps: 400 },
    );
    expect(t.impact?.id).toBe(b.id);
    expect(t.timeToImpact).toBeGreaterThan(0);
  });

  it('não acusa impacto quando a velocidade é suficiente', () => {
    const b = corpo();
    const dist = b.radius * 3;
    // Bem acima da velocidade de escape, afastando-se.
    const v = escapeSpeed(b, dist, G) * 3;
    const t = predictTrajectory([b], { x: dist, y: 0, z: 0 }, { x: v, y: 0, z: 0 }, G, {
      step: 0.2,
      steps: 300,
    });
    expect(t.impact).toBeNull();
  });

  it('a curva encurva na direção do corpo', () => {
    const b = corpo();
    // Passando de lado, sem componente radial inicial.
    const t = predictTrajectory(
      [b],
      { x: b.radius * 2, y: 0, z: -2000 },
      { x: 0, y: 0, z: 60 },
      G,
      { step: 0.3, steps: 60 },
    );
    const inicio = t.points[0]!;
    const fim = t.points[t.points.length - 1]!;
    // Aproximou-se em X (o corpo está em x=0).
    expect(fim.x).toBeLessThan(inicio.x);
  });

  it('o arrasto encurta a trajetória', () => {
    const semArrasto = predictTrajectory([], { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, G, {
      step: 0.2,
      steps: 50,
      drag: 0,
    });
    const comArrasto = predictTrajectory([], { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, G, {
      step: 0.2,
      steps: 50,
      drag: 0.5,
    });
    const fimSem = semArrasto.points[semArrasto.points.length - 1]!.x;
    const fimCom = comArrasto.points[comArrasto.points.length - 1]!.x;
    expect(fimCom).toBeLessThan(fimSem);
  });

  it('limita o número de passos para não travar o frame', () => {
    const t = predictTrajectory([], { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, G, {
      steps: 999999,
    });
    expect(t.points.length).toBeLessThanOrEqual(2001);
  });

  it('sempre inclui a posição inicial', () => {
    const p = { x: 7, y: 8, z: 9 };
    const t = predictTrajectory([], p, { x: 0, y: 0, z: 0 }, G, { steps: 3 });
    expect(t.points[0]).toEqual(p);
  });
});

describe('corpo dominante', () => {
  it('devolve null fora de qualquer raio de captura', () => {
    const b = corpo();
    expect(dominantBody([b], { x: captureRadius(b) * 2, y: 0, z: 0 })).toBeNull();
  });

  it('escolhe o mais próximo quando há sobreposição', () => {
    const planeta = corpo({ id: 1, pos: [0, 0, 0] });
    const lua = corpo({ id: 2, pos: [900, 0, 0], radius: 150, mass: 150 * 150 * 3 });
    const dom = dominantBody([planeta, lua], { x: 800, y: 0, z: 0 });
    expect(dom?.body.id).toBe(2);
  });
});

describe('velocidade de escape', () => {
  it('é maior perto do corpo', () => {
    const b = corpo();
    expect(escapeSpeed(b, 600, G)).toBeGreaterThan(escapeSpeed(b, 5000, G));
  });

  it('não explode dentro da superfície', () => {
    const b = corpo();
    expect(Number.isFinite(escapeSpeed(b, 0, G))).toBe(true);
  });
});
