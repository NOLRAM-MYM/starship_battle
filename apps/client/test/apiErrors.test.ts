/**
 * Testes da tradução de falha de API.
 *
 * O caso que motivou o módulo: com o Postgres fora do ar, a tela de
 * login mostrava "Internal Server Error". O jogador redigitava a senha
 * achando que tinha errado — a mensagem não dizia de quem era o
 * problema, e essa é a única coisa que ela precisava dizer.
 */

import { describe, it, expect } from 'vitest';
import { mensagemDeErro, mensagemDeRedeIndisponivel } from '../src/net/apiErrors.js';

describe('mensagem de erro da API', () => {
  it('serviço de dados fora do ar é dito como tal', () => {
    // Exatamente o corpo que a API devolveu com o Postgres desligado.
    const m = mensagemDeErro(
      500,
      { statusCode: 500, code: 'ECONNREFUSED', error: 'Internal Server Error', message: '' },
      'entrar',
    );
    expect(m).toMatch(/serviços de dados/i);
    expect(m).toMatch(/docker compose/i);
    expect(m).not.toMatch(/internal server error/i);
  });

  it('nenhuma mensagem devolve o rótulo cru do status', () => {
    // É o defeito genérico: repassar "Internal Server Error",
    // "Unauthorized" ou "Bad Request" é mostrar o encanamento.
    const genericos = [
      [500, 'Internal Server Error'],
      [401, 'Unauthorized'],
      [400, 'Bad Request'],
      [409, 'Conflict'],
      [503, 'Service Unavailable'],
    ] as const;
    for (const [status, rotulo] of genericos) {
      const m = mensagemDeErro(status, { error: rotulo, message: rotulo }, 'entrar');
      expect(m.toLowerCase(), `${status} vazou "${rotulo}"`).not.toContain(rotulo.toLowerCase());
    }
  });

  it('senha errada aponta para o jogador, falha do servidor não', () => {
    // A distinção é o ponto: uma o jogador resolve, a outra não.
    expect(mensagemDeErro(401, {}, 'entrar')).toMatch(/senha/i);
    expect(mensagemDeErro(500, {}, 'entrar')).toMatch(/não é a sua senha/i);
  });

  it('mensagem específica da API é preservada', () => {
    // Traduzir não pode virar engolir: "E-mail já cadastrado" diz mais
    // do que qualquer texto genérico nosso.
    expect(mensagemDeErro(409, { message: 'E-mail já cadastrado' }, 'registrar')).toBe(
      'E-mail já cadastrado',
    );
    expect(mensagemDeErro(400, { message: 'Senha curta demais' }, 'registrar')).toBe(
      'Senha curta demais',
    );
  });

  it('a ação aparece na frase', () => {
    // "Não foi possível" sem dizer o quê não ajuda ninguém.
    expect(mensagemDeErro(500, {}, 'carregar a frota')).toContain('carregar a frota');
    expect(mensagemDeRedeIndisponivel('entrar')).toContain('entrar');
  });

  it('API desligada é distinguida de API com defeito', () => {
    // Uma se resolve subindo o processo; a outra, olhando o log.
    expect(mensagemDeRedeIndisponivel('entrar')).toMatch(/não respondeu|8080/i);
    expect(mensagemDeErro(500, {}, 'entrar')).toMatch(/log da API/i);
  });

  it('corpo ausente ou inválido não quebra', () => {
    // A API pode responder com HTML de proxy, ou nada.
    for (const corpo of [null, undefined, {}]) {
      expect(typeof mensagemDeErro(502, corpo, 'entrar')).toBe('string');
      expect(mensagemDeErro(502, corpo, 'entrar').length).toBeGreaterThan(0);
    }
  });

  it('excesso de tentativas é dito sem culpar a senha', () => {
    expect(mensagemDeErro(429, {}, 'entrar')).toMatch(/tentativas/i);
  });
});
