/**
 * Solução de mira no cliente.
 *
 * O retículo refaz em TypeScript a conta que o servidor tem em Rust,
 * porque precisa dela a cada quadro. Uma divergência não quebra nada —
 * só faz a mira apontar para o lugar errado, em silêncio, que é o pior
 * modo de falha possível num recurso de pontaria. Daí a fixture dourada.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aimBand, aimBandColor, aimBandLabel, solveAim, type AimInput } from '../src/game/aim.js';

const base = (): AimInput => ({
  shooterPos: [0, 0, 0],
  shooterVel: [0, 0, 0],
  targetPos: [0, 0, 200],
  targetVel: [0, 0, 0],
  projectileSpeed: 200,
  gravity: [0, 0, 0],
  projectileTtl: 4,
});

describe('solução de mira', () => {
  it('alvo parado sem gravidade: mira nele mesmo', () => {
    const s = solveAim(base());
    expect(s.leadPoint[2]).toBeCloseTo(200, 1);
    expect(s.timeOfFlight).toBeCloseTo(1, 1);
    expect(s.reachable).toBe(true);
  });

  it('alvo cruzando exige antecipação à frente', () => {
    const i = base();
    i.targetVel = [50, 0, 0];
    expect(solveAim(i).leadPoint[0]).toBeGreaterThan(40);
  });

  it('gravidade faz a mira subir contra a queda', () => {
    const i = base();
    i.gravity = [0, -30, 0];
    expect(solveAim(i).leadPoint[1]).toBeGreaterThan(10);
  });

  it('a velocidade da própria nave é descontada', () => {
    // O projétil herda a velocidade da nave: viajando juntos, não há
    // antecipação a fazer. Esquecer isto faria a mira errar sempre que
    // o jogador estivesse se movendo — ou seja, quase sempre.
    const i = base();
    i.shooterVel = [50, 0, 0];
    i.targetVel = [50, 0, 0];
    expect(Math.abs(solveAim(i).leadPoint[0])).toBeLessThan(2);
  });
});

describe('dificuldade do tiro', () => {
  it('alvo parado e perto é fácil', () => {
    const s = solveAim(base());
    expect(s.difficulty).toBeLessThan(0.25);
    expect(aimBand(s.difficulty, s.reachable)).toBe('easy');
  });

  it('cruzar rápido é mais difícil que ficar parado', () => {
    const i = base();
    i.targetVel = [80, 0, 0];
    expect(solveAim(i).difficulty).toBeGreaterThan(solveAim(base()).difficulty);
  });

  it('vir de frente é mais fácil que cruzar na mesma velocidade', () => {
    // O que separa uma medida útil de um número decorativo: velocidade
    // RADIAL quase não atrapalha, TRANSVERSAL sim.
    const frontal = base();
    frontal.targetVel = [0, 0, -80];
    const lateral = base();
    lateral.targetVel = [80, 0, 0];
    expect(solveAim(frontal).difficulty).toBeLessThan(solveAim(lateral).difficulty);
  });

  it('gravidade forte aumenta a dificuldade', () => {
    const i = base();
    i.gravity = [0, -60, 0];
    expect(solveAim(i).difficulty).toBeGreaterThan(solveAim(base()).difficulty);
  });

  it('alvo além do alcance não tem solução', () => {
    const i = base();
    i.targetPos = [0, 0, 5000];
    const s = solveAim(i);
    expect(s.reachable).toBe(false);
    expect(aimBand(s.difficulty, s.reachable)).toBe('extreme');
  });

  it('valores extremos não produzem NaN', () => {
    // A interface usa `difficulty` direto como fator de cor e tamanho.
    const i = base();
    i.targetVel = [9999, 9999, 9999];
    i.gravity = [0, -9999, 0];
    const s = solveAim(i);
    expect(Number.isFinite(s.difficulty)).toBe(true);
    expect(s.difficulty).toBeGreaterThanOrEqual(0);
    expect(s.difficulty).toBeLessThanOrEqual(1);
  });

  it('alvo em cima do atirador não produz NaN', () => {
    const i = base();
    i.targetPos = [0, 0, 0];
    const s = solveAim(i);
    expect(s.leadPoint.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(s.difficulty)).toBe(true);
  });

  it('cada faixa tem rótulo e cor próprios', () => {
    // Cor sozinha não serve para quem enxerga cores de outro jeito, e o
    // rótulo é o que garante a leitura.
    const faixas = ['easy', 'moderate', 'hard', 'extreme'] as const;
    const rotulos = faixas.map(aimBandLabel);
    const cores = faixas.map(aimBandColor);
    expect(new Set(rotulos).size).toBe(4);
    expect(new Set(cores).size).toBe(4);
  });
});

describe('paridade com o solucionador do servidor', () => {
  // Gerado por `cargo test -p game-server --lib aim_fixture`.
  const FIXTURE = join(process.cwd(), 'src/net/__fixtures__/aim.json');

  it('a fixture existe', () => {
    expect(existsSync(FIXTURE), 'gere com `cargo test -p game-server --lib aim_fixture`').toBe(
      true,
    );
  });

  it('todos os casos batem com o Rust', () => {
    const casos: Record<
      string,
      {
        input: AimInput;
        leadPoint: [number, number, number];
        timeOfFlight: number;
        difficulty: number;
        reachable: boolean;
      }
    > = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    for (const [nome, esperado] of Object.entries(casos)) {
      const s = solveAim(esperado.input);
      // Tolerância de 1e-3: os dois lados fazem a mesma iteração, mas em
      // f32 (Rust) e f64 (JS).
      expect(s.reachable, `${nome}: alcançável`).toBe(esperado.reachable);
      expect(s.timeOfFlight, `${nome}: tempo de voo`).toBeCloseTo(esperado.timeOfFlight, 3);
      expect(s.difficulty, `${nome}: dificuldade`).toBeCloseTo(esperado.difficulty, 3);
      for (let k = 0; k < 3; k++) {
        expect(s.leadPoint[k]!, `${nome}: mira eixo ${k}`).toBeCloseTo(esperado.leadPoint[k]!, 2);
      }
    }
  });
});
