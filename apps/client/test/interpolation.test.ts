/**
 * Testes da interpolação de snapshots.
 *
 * O bug que motivou isto: o servidor manda ~15 atualizações por segundo
 * e o cliente desenha 60 quadros — cada posição era repetida 4 vezes e o
 * movimento saía aos saltos. Nada disso quebrava teste: era só o valor
 * certo na hora errada.
 */

import { describe, it, expect } from 'vitest';
import {
  averageInterval,
  extrapolateWithVelocity,
  lerpVec3,
  MAX_EXTRAPOLATION_MS,
  MAX_SAMPLES,
  nlerpQuat,
  pushSample,
  renderDelay,
  sampleAt,
  type History,
} from '../src/game/interpolation.js';

const IDENT: [number, number, number, number] = [0, 0, 0, 1];

function hist(...amostras: Array<[number, number]>): History {
  const h: History = [];
  for (const [t, x] of amostras) {
    pushSample(h, { t, pos: [x, 0, 0], quat: IDENT });
  }
  return h;
}

describe('buffer de amostras', () => {
  it('descarta as mais antigas além do limite', () => {
    const h: History = [];
    for (let i = 0; i < MAX_SAMPLES + 5; i++) {
      pushSample(h, { t: i * 66, pos: [i, 0, 0], quat: IDENT });
    }
    expect(h.length).toBe(MAX_SAMPLES);
    // Ficou com as mais RECENTES.
    expect(h[h.length - 1]!.pos[0]).toBe(MAX_SAMPLES + 4);
  });

  it('ignora amostra fora de ordem', () => {
    // Um pacote atrasado não pode fazer a entidade andar para trás.
    const h = hist([100, 10], [200, 20]);
    pushSample(h, { t: 150, pos: [15, 0, 0], quat: IDENT });
    expect(h.length).toBe(2);
    expect(h[1]!.pos[0]).toBe(20);
  });

  it('mede o intervalo real em vez de assumir', () => {
    // O tick do servidor oscila; assumir 66ms fixo geraria travadas.
    const h = hist([0, 0], [80, 1], [160, 2]);
    expect(averageInterval(h)).toBe(80);
  });

  it('usa o fallback com histórico insuficiente', () => {
    expect(averageInterval([], 66)).toBe(66);
    expect(averageInterval(hist([0, 0]), 66)).toBe(66);
  });
});

describe('amostragem no tempo', () => {
  it('interpola no meio do caminho', () => {
    const h = hist([0, 0], [100, 10]);
    const s = sampleAt(h, 50)!;
    expect(s.pos[0]).toBeCloseTo(5, 5);
    expect(s.extrapolated).toBe(false);
  });

  it('produz posições DIFERENTES em quadros consecutivos', () => {
    // É o cerne da correção: a 60fps, quadros a cada ~16ms dentro de um
    // intervalo de 66ms tinham todos o mesmo valor.
    const h = hist([0, 0], [66, 66]);
    const vistos = new Set<number>();
    for (let t = 0; t <= 66; t += 16) {
      vistos.add(sampleAt(h, t)!.pos[0]);
    }
    expect(vistos.size).toBeGreaterThan(3);
  });

  it('antes do histórico devolve a amostra mais antiga', () => {
    const h = hist([100, 10], [200, 20]);
    expect(sampleAt(h, 0)!.pos[0]).toBe(10);
  });

  it('extrapola além do último snapshot, com limite', () => {
    const h = hist([0, 0], [100, 10]);
    const curto = sampleAt(h, 150)!;
    expect(curto.extrapolated).toBe(true);
    expect(curto.pos[0]).toBeGreaterThan(10);

    // Muito além, a extrapolação satura em vez de sair voando.
    const longe = sampleAt(h, 100 + MAX_EXTRAPOLATION_MS * 10)!;
    const limite = sampleAt(h, 100 + MAX_EXTRAPOLATION_MS)!;
    expect(longe.pos[0]).toBeCloseTo(limite.pos[0], 5);
  });

  it('não extrapola a ORIENTAÇÃO', () => {
    // Girar sem dado novo produz rotação falsa muito mais visível que
    // uma posição levemente adiantada.
    const h: History = [];
    pushSample(h, { t: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1] });
    pushSample(h, { t: 100, pos: [1, 0, 0], quat: [0, 0.3, 0, 0.954] });
    const s = sampleAt(h, 200)!;
    expect(s.quat).toEqual([0, 0.3, 0, 0.954]);
  });

  it('devolve null sem histórico', () => {
    expect(sampleAt([], 100)).toBeNull();
  });

  it('lida com uma única amostra', () => {
    const h = hist([50, 7]);
    expect(sampleAt(h, 999)!.pos[0]).toBe(7);
  });

  it('não divide por zero com amostras de mesmo instante', () => {
    const h: History = [
      { t: 100, pos: [0, 0, 0], quat: IDENT },
      { t: 100, pos: [10, 0, 0], quat: IDENT },
    ];
    const s = sampleAt(h, 100)!;
    expect(Number.isFinite(s.pos[0])).toBe(true);
  });
});

describe('interpolação de orientação', () => {
  it('escolhe o caminho curto entre q e -q', () => {
    // `q` e `-q` são a MESMA orientação; sem corrigir o sinal a nave
    // daria uma cambalhota ao cruzar essa fronteira.
    const a: [number, number, number, number] = [0, 0, 0, 1];
    const b: [number, number, number, number] = [0, 0, 0, -1];
    const meio = nlerpQuat(a, b, 0.5);
    // O resultado tem de continuar sendo a identidade, não zero.
    expect(Math.abs(meio[3])).toBeCloseTo(1, 5);
  });

  it('devolve sempre um quaternion normalizado', () => {
    const a: [number, number, number, number] = [0, 0, 0, 1];
    const b: [number, number, number, number] = [0, 0.707, 0, 0.707];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const q = nlerpQuat(a, b, t);
      expect(Math.hypot(...q)).toBeCloseTo(1, 5);
    }
  });
});

describe('projeção pela velocidade (nave do próprio jogador)', () => {
  it('avança a partir do último snapshot usando a velocidade', () => {
    // A nave local é desenhada no PRESENTE; interpolá-la como as outras
    // acrescentava ~100ms entre a tecla e a reação na tela.
    const h = hist([0, 0], [100, 10]);
    const s = extrapolateWithVelocity(h, [100, 0, 0], 200)!;
    // 100 ms além do último snapshot a 100 u/s = +10 unidades.
    expect(s.pos[0]).toBeCloseTo(20, 3);
    expect(s.extrapolated).toBe(true);
  });

  it('limita a projeção para a nave não sair voando sozinha', () => {
    const h = hist([0, 0], [100, 10]);
    const longe = extrapolateWithVelocity(h, [100, 0, 0], 100 + 5000)!;
    const limite = extrapolateWithVelocity(h, [100, 0, 0], 100 + MAX_EXTRAPOLATION_MS)!;
    expect(longe.pos[0]).toBeCloseTo(limite.pos[0], 5);
  });

  it('cai na interpolação normal para instantes passados', () => {
    const h = hist([0, 0], [100, 10]);
    const s = extrapolateWithVelocity(h, [100, 0, 0], 50)!;
    expect(s.pos[0]).toBeCloseTo(5, 5);
    expect(s.extrapolated).toBe(false);
  });

  it('não projeta a orientação', () => {
    const h: History = [];
    pushSample(h, { t: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1] });
    pushSample(h, { t: 100, pos: [1, 0, 0], quat: [0, 0.3, 0, 0.954] });
    const s = extrapolateWithVelocity(h, [10, 0, 0], 200)!;
    expect(s.quat).toEqual([0, 0.3, 0, 0.954]);
  });

  it('devolve null sem histórico', () => {
    expect(extrapolateWithVelocity([], [1, 0, 0], 100)).toBeNull();
  });
});

describe('atraso de renderização', () => {
  it('cresce com o intervalo dos snapshots', () => {
    const rapido = hist([0, 0], [30, 1], [60, 2]);
    const lento = hist([0, 0], [150, 1], [300, 2]);
    expect(renderDelay(lento)).toBeGreaterThan(renderDelay(rapido));
  });

  it('fica dentro de limites jogáveis', () => {
    const absurdo = hist([0, 0], [5000, 1]);
    expect(renderDelay(absurdo)).toBeLessThanOrEqual(140);
    const instantaneo = hist([0, 0], [1, 1]);
    expect(renderDelay(instantaneo)).toBeGreaterThanOrEqual(30);
  });

  it('é curto o bastante para não parecer lento', () => {
    // A ~15Hz (66ms) o atraso tem de ficar bem abaixo de 100ms, senão o
    // jogo inteiro parece atrasado — foi o relato com o fator 1.6x.
    const tipico = hist([0, 0], [66, 1], [132, 2]);
    expect(renderDelay(tipico)).toBeLessThan(80);
  });
});

describe('lerpVec3', () => {
  it('respeita os extremos', () => {
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0)).toEqual([0, 0, 0]);
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 1)).toEqual([10, 20, 30]);
  });
});
