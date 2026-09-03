/**
 * Suporte a controles.
 *
 * O que se protege aqui é a MATEMÁTICA dos eixos e o reconhecimento de
 * família — as duas coisas que quebram em silêncio. Uma zona morta
 * errada faz a nave derivar sozinha e o jogador culpa o servidor; um
 * rótulo de botão errado manda ele apertar outro botão.
 */

import { describe, it, expect } from 'vitest';
import {
  applyDeadzone,
  buttonLabel,
  detectFamily,
  DEADZONE,
  padBindings,
  readAxes,
  readButtons,
  responseCurve,
  type PadLike,
} from '../src/input/gamepad.js';

function pad(
  axes: number[],
  pressed: number[] = [],
  valores: Record<number, number> = {},
): PadLike {
  const buttons = Array.from({ length: 16 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: valores[i] ?? (pressed.includes(i) ? 1 : 0),
  }));
  return { index: 0, id: 'teste', axes, buttons };
}

describe('reconhecimento de família', () => {
  it('reconhece PlayStation pelos nomes usuais', () => {
    for (const id of [
      'DualSense Wireless Controller',
      'Sony DualShock 4',
      'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
    ]) {
      expect(detectFamily(id), id).toBe('playstation');
    }
  });

  it('reconhece Nintendo, incluindo Pro Controller e Joy-Con', () => {
    for (const id of [
      'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
      'Nintendo Switch Joy-Con (L)',
      'Nintendo Co., Ltd. Switch 2 Pro Controller',
    ]) {
      expect(detectFamily(id), id).toBe('nintendo');
    }
  });

  it('reconhece Xbox', () => {
    expect(detectFamily('Xbox Wireless Controller')).toBe('xbox');
    expect(detectFamily('xinput device')).toBe('xbox');
  });

  it('hardware desconhecido cai em genérico, e não quebra', () => {
    // É o que faz um controle novo funcionar no dia do lançamento, sem
    // esperar que alguém acrescente o id dele a uma lista.
    expect(detectFamily('Algum Controle Novo 2029')).toBe('generic');
    expect(detectFamily('')).toBe('generic');
  });
});

describe('rótulos de botão', () => {
  it('Nintendo tem A e B TROCADOS em relação ao Xbox', () => {
    // Os índices do standard mapping são iguais; o nome impresso não.
    // Chamar o botão 0 de "A" num controle Nintendo mandaria o jogador
    // apertar o botão errado.
    expect(buttonLabel('xbox', 0)).toBe('A');
    expect(buttonLabel('nintendo', 0)).toBe('B');
    expect(buttonLabel('xbox', 1)).toBe('B');
    expect(buttonLabel('nintendo', 1)).toBe('A');
  });

  it('PlayStation usa os símbolos', () => {
    expect(buttonLabel('playstation', 0)).toBe('✕');
    expect(buttonLabel('playstation', 3)).toBe('△');
  });

  it('um índice desconhecido não quebra o rótulo', () => {
    expect(buttonLabel('generic', 99)).toBe('B99');
  });

  it('a lista de comandos usa os nomes da família', () => {
    const ps = padBindings('playstation');
    const nin = padBindings('nintendo');
    expect(ps.find((b) => b.acao === 'Impulso')?.botao).toBe('✕');
    expect(nin.find((b) => b.acao === 'Impulso')?.botao).toBe('B');
    expect(ps.length).toBe(nin.length);
  });
});

describe('zona morta', () => {
  it('alavanca em repouso não produz movimento', () => {
    // Alavancas usadas marcam ~0.05 paradas. Sem zona morta a nave gira
    // sozinha e parece deriva do servidor.
    const [x, y] = applyDeadzone(0.05, -0.04);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it('é RADIAL, não por eixo', () => {
    // Cortar X e Y separadamente cria uma cruz morta no centro e um
    // degrau na diagonal — o clássico "a mira trava nos eixos". Uma
    // diagonal acima da zona morta tem que passar, mesmo com cada eixo
    // isoladamente abaixo dela.
    const comp = DEADZONE * 0.8;
    expect(Math.hypot(comp, comp)).toBeGreaterThan(DEADZONE);
    const [x, y] = applyDeadzone(comp, comp);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it('reescala o resto, sem salto no início do curso', () => {
    // Sem reescalar, o menor movimento útil já sairia com a intensidade
    // da zona morta.
    const [x] = applyDeadzone(DEADZONE + 0.001, 0);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.02);
  });

  it('o curso cheio continua chegando a 1', () => {
    const [x] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1, 3);
  });

  it('preserva a direção da diagonal', () => {
    const [x, y] = applyDeadzone(0.7, 0.7);
    expect(x).toBeCloseTo(y, 6);
  });

  it('não produz NaN no centro exato', () => {
    const [x, y] = applyDeadzone(0, 0);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe('curva de resposta', () => {
  it('dá resolução fina perto do centro', () => {
    // Metade do curso tem que render menos da metade da rotação: é onde
    // as correções de mira acontecem.
    expect(responseCurve(0.5)).toBeLessThan(0.5);
  });

  it('o curso cheio continua valendo 1', () => {
    expect(responseCurve(1)).toBeCloseTo(1, 6);
    expect(responseCurve(-1)).toBeCloseTo(-1, 6);
  });

  it('é simétrica e monotônica', () => {
    expect(responseCurve(-0.4)).toBeCloseTo(-responseCurve(0.4), 6);
    expect(responseCurve(0.8)).toBeGreaterThan(responseCurve(0.3));
  });

  it('satura acima de 1', () => {
    expect(responseCurve(5)).toBeCloseTo(1, 6);
  });
});

describe('leitura dos eixos', () => {
  it('empurrar a alavanca para frente ABAIXA o nariz', () => {
    // O eixo Y do controle cresce para baixo; arfagem positiva é nariz
    // para cima. Sem inverter, o manche fica ao contrário de qualquer
    // aeronave.
    const a = readAxes(pad([0, -1, 0, 0]));
    expect(a.pitch).toBeGreaterThan(0);
  });

  it('a alavanca direita rola a nave', () => {
    const a = readAxes(pad([0, 0, 1, 0]));
    expect(a.roll).toBeGreaterThan(0.9);
  });

  it('o gatilho de aceleração é ANALÓGICO', () => {
    // É o que permite atravessar um campo de asteroides a um terço da
    // potência — o teclado nunca permitiu.
    const a = readAxes(pad([0, 0, 0, 0], [], { 7: 0.35 }));
    expect(a.thrust).toBeCloseTo(0.35, 3);
  });

  it('gatilho digital antigo ainda acelera', () => {
    // Alguns controles marcam `value` 0 e só `pressed`.
    const a = readAxes(pad([0, 0, 0, 0], [7], { 7: 0 }));
    expect(a.thrust).toBe(1);
  });

  it('controle parado não gera entrada nenhuma', () => {
    const a = readAxes(pad([0.03, -0.02, 0.04, 0.01]));
    expect(a.steer).toBe(0);
    expect(a.pitch).toBe(0);
    expect(a.roll).toBe(0);
  });

  it('eixos ausentes não quebram a leitura', () => {
    // Controles exóticos podem expor menos eixos que o padrão.
    const a = readAxes({ index: 0, id: 'x', axes: [], buttons: [] });
    expect(a.steer).toBe(0);
    expect(a.thrust).toBe(0);
  });
});

describe('botões', () => {
  it('a habilidade dispara UMA vez por toque', () => {
    // Sem borda de subida, segurar dispararia 60 vezes por segundo — e
    // gastaria o cinto de consumíveis inteiro num toque.
    const prev = new Set<number>();
    expect(readButtons(pad([], [0]), prev).skill).toBe('Dash');
    expect(readButtons(pad([], [0]), prev).skill, 'segurando não repete').toBeNull();
  });

  it('o tiro sai ao SOLTAR, como no teclado', () => {
    const prev = new Set<number>();
    const segurando = readButtons(pad([], [5]), prev);
    expect(segurando.fire).toBe(false);
    expect(segurando.fireHeld).toBe(true);
    const soltou = readButtons(pad([], []), prev);
    expect(soltou.fire).toBe(true);
  });

  it('o direcional usa os dois consumíveis', () => {
    const prev = new Set<number>();
    expect(readButtons(pad([], [14]), prev).useConsumable).toBe(0);
    prev.clear();
    expect(readButtons(pad([], [15]), prev).useConsumable).toBe(1);
  });

  it('torpedo e iscas têm botões distintos', () => {
    const prev = new Set<number>();
    expect(readButtons(pad([], [3]), prev).launchTorpedo).toBe(true);
    prev.clear();
    expect(readButtons(pad([], [13]), prev).deployDecoys).toBe(true);
  });
});
