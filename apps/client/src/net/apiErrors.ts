/**
 * Tradução de falha de API para uma frase que o jogador possa agir.
 *
 * O que motivou: com o Postgres fora do ar, a API responde
 * `500 {"code":"ECONNREFUSED","error":"Internal Server Error"}` e a tela
 * de login mostrava exatamente isso — "Internal Server Error". Em
 * inglês, sem dizer o que houve nem o que fazer, e num lugar onde o
 * jogador não tem como investigar. O mesmo valia para a frota: "Failed
 * to list loadouts: Internal Server Error".
 *
 * A regra é uma só: a mensagem tem que dizer DE QUEM é o problema. Senha
 * errada é do jogador e ele resolve; banco fora do ar é do servidor e
 * ele não resolve — mas saber disso o impede de ficar redigitando a
 * senha achando que errou.
 *
 * Módulo puro (status + corpo, sem `fetch` nem DOM) para poder ser
 * testado sem servidor.
 */

/** Corpo de erro que a API devolve; todos os campos são opcionais. */
export interface CorpoDeErro {
  message?: string;
  error?: string;
  code?: string;
  statusCode?: number;
}

/**
 * A mensagem vinda da API serve para mostrar ao jogador?
 *
 * Serve quando é específica ("E-mail já cadastrado"). Não serve quando é
 * o rótulo genérico do status HTTP, que é o que o Fastify preenche
 * sozinho — repassar isso é mostrar o encanamento.
 */
function mensagemUtil(m: string | undefined): m is string {
  if (!m) return false;
  const generica = [
    'internal server error',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'bad request',
    'unauthorized',
    'forbidden',
    'not found',
    'conflict',
  ];
  return !generica.includes(m.trim().toLowerCase());
}

/**
 * Frase para o jogador, a partir do status e do corpo da resposta.
 *
 * `acao` completa a frase nos casos genéricos ("entrar", "carregar a
 * frota"), para o erro dizer o que falhou e não só que algo falhou.
 */
export function mensagemDeErro(
  status: number,
  corpo: CorpoDeErro | null | undefined,
  acao: string,
): string {
  const c = corpo ?? {};

  // Serviço fora do ar por trás da API — o caso que gerou este módulo.
  // Vem como 500 com `ECONNREFUSED` quando o Postgres, o Redis ou o NATS
  // não estão de pé.
  if (c.code === 'ECONNREFUSED' || c.code === 'ETIMEDOUT' || status === 503) {
    return `O servidor está no ar, mas os serviços de dados não respondem. Suba a infraestrutura (docker compose up -d em infra/) e tente de novo.`;
  }

  if (status === 401 || status === 403) {
    return mensagemUtil(c.message) ? c.message : 'E-mail ou senha incorretos.';
  }
  if (status === 409) {
    return mensagemUtil(c.message) ? c.message : 'Esse callsign ou e-mail já está em uso.';
  }
  if (status === 429) {
    return 'Tentativas demais em pouco tempo. Espere um instante.';
  }
  if (status >= 500) {
    return `O servidor falhou ao ${acao}. Não é a sua senha — veja o log da API.`;
  }
  if (status >= 400) {
    return mensagemUtil(c.message) ? c.message : `Não foi possível ${acao} (erro ${status}).`;
  }
  return `Não foi possível ${acao}.`;
}

/**
 * Frase para quando o `fetch` nem chegou a receber resposta.
 *
 * É o caso da API desligada: o navegador rejeita com `TypeError: Failed
 * to fetch`, uma mensagem que não diz a quem pertence o problema.
 */
export function mensagemDeRedeIndisponivel(acao: string): string {
  return `Não foi possível ${acao}: a API não respondeu. Verifique se ela está no ar (porta 8080).`;
}
