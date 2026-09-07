/**
 * Testes da política de reconexão do cliente de rede.
 *
 * O que se está protegendo: um cliente que perde a conexão não pode nem
 * desistir na primeira falha nem martelar o servidor para sempre.
 *
 * O `client.ts` tinha a sua própria política — um intervalo fixo de 1,5s,
 * sem limite — enquanto o `reconnect.ts`, com recuo exponencial e jitter
 * e coberto por testes, não era importado por ninguém. Com o servidor
 * fora do ar isso é bater na porta quarenta vezes por minuto; e como o
 * `Join` de um cliente com protocolo desatualizado é rejeitado na hora, o
 * laço não tinha fim — um aviso na tela a cada volta e nenhuma saída.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_RETRIES, nextDelayMs } from '../src/net/reconnect.js';

describe('espera entre tentativas de reconexão', () => {
  it('cresce com o número de tentativas', () => {
    // O ponto do recuo: a décima tentativa não pode custar o mesmo que a
    // primeira, senão o cliente vira uma enxurrada contra um servidor
    // que já está em apuros.
    const cedo = nextDelayMs(0);
    const tarde = nextDelayMs(6);
    expect(tarde).toBeGreaterThan(cedo);
  });

  it('a primeira tentativa é rápida', () => {
    // Uma queda momentânea de rede tem que se resolver sozinha, sem o
    // jogador esperar meio minuto por uma falha de um segundo.
    for (let i = 0; i < 50; i++) {
      expect(nextDelayMs(0)).toBeLessThanOrEqual(1000);
    }
  });

  it('tem teto: nunca passa de 30s', () => {
    // Sem teto, 2^n cresce até uma espera que o jogador lê como "travou
    // de vez".
    for (const tentativa of [10, 20, 40, 100]) {
      expect(nextDelayMs(tentativa)).toBeLessThanOrEqual(30_000);
    }
  });

  it('tem jitter: dois clientes não voltam no mesmo instante', () => {
    // Sem jitter, todo mundo derrubado junto reconecta junto e derruba
    // o servidor de novo no mesmo segundo.
    const amostras = new Set(Array.from({ length: 40 }, () => nextDelayMs(4)));
    expect(amostras.size).toBeGreaterThan(1);
  });

  it('nunca devolve zero nem negativo', () => {
    // Uma espera de zero é um laço apertado disfarçado de recuo.
    for (let i = 0; i < 12; i++) {
      expect(nextDelayMs(i)).toBeGreaterThan(0);
    }
  });

  it('o limite de tentativas é finito', () => {
    // É o que garante que existe uma saída do laço.
    expect(Number.isFinite(DEFAULT_MAX_RETRIES)).toBe(true);
    expect(DEFAULT_MAX_RETRIES).toBeGreaterThan(0);
  });

  it('desistir leva minutos, não segundos', () => {
    // Desistir cedo demais transformaria uma oscilação de rede em "vá
    // recarregar a página". Somando o pior caso das tentativas até o
    // limite, o jogador tem uma janela generosa.
    let total = 0;
    for (let i = 0; i < DEFAULT_MAX_RETRIES; i++) total += nextDelayMs(i);
    expect(total).toBeGreaterThan(60_000);
  });
});
