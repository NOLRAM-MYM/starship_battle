/**
 * Cliente WebSocket fino. Encapsula reconnect, binary framing e exposição
 * de callbacks para a aplicação.
 */

import {
  PROTOCOL_VERSION,
  encodeClientMsg,
  decodeServerMsg,
} from './protocol';
import type { ClientMsg, ConsumableSlot, ServerMsg } from './protocol';
import { DEFAULT_MAX_RETRIES, nextDelayMs } from './reconnect';

export interface NetClient {
  /** Envia uma mensagem. Se o socket não estiver aberto, descarta. */
  send(msg: ClientMsg): void;
  /** Registra um handler. Pode ser chamado múltiplas vezes. */
  onMessage(handler: (msg: ServerMsg) => void): void;
  /** Fecha o socket e desabilita reconnect. */
  close(): void;
  /** Indica se está aberto. */
  isOpen(): boolean;
}

export interface NetClientOptions {
  url: string;
  name: string;
  /**
   * `templateId`s equipados, em ordem de slot. O servidor deriva dano,
   * escudo e empuxo a partir deles — o cliente nunca envia números.
   */
  loadout?: string[];
  /**
   * Nós da árvore de skills desbloqueados pela conta.
   *
   * Mesma lógica do loadout: o cliente manda IDS, o servidor decide o
   * efeito. Antes as skills não saíam do cliente e a árvore inteira era
   * decorativa — o jogador gastava pontos e o tiro não mudava.
   */
  skills?: string[];
  /**
   * Consumíveis levados para a arena, vindos do inventário da conta.
   *
   * O servidor descarta ids desconhecidos e limita os slots, então isto
   * é uma declaração, não uma concessão.
   */
  consumables?: ConsumableSlot[];
  /** Entrar no campo de provas, com alvos de treino. */
  practice?: boolean;
  reconnectDelayMs?: number;
  /** Tentativas de reconexão antes de desistir. */
  maxRetries?: number;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'giveup') => void;
}

export function connect(opts: NetClientOptions): NetClient {
  const handlers: ((msg: ServerMsg) => void)[] = [];
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let ws: WebSocket | null = null;
  let intentionallyClosed = false;
  /** Reconexões seguidas sem nenhuma conexão bem-sucedida no meio. */
  let tentativas = 0;

  function open(): void {
    opts.onStatus?.('connecting');
    ws = new WebSocket(opts.url);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      console.info('[net] open', opts.url);
      // Conectou: o recuo volta ao início. Sem zerar aqui, uma queda
      // isolada depois de horas jogando já entraria esperando 30s.
      tentativas = 0;
      opts.onStatus?.('open');
      // Envia Join imediatamente após conectar.
      const join: ClientMsg = {
        type: 'Join',
        payload: {
          name: opts.name,
          protocol: PROTOCOL_VERSION,
          loadout: opts.loadout ?? [],
          skills: opts.skills ?? [],
          consumables: opts.consumables ?? [],
          practice: opts.practice ?? false,
        },
      };
      ws?.send(encodeClientMsg(join));
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      const buf = ev.data as ArrayBuffer;
      let msg: ServerMsg;
      try {
        msg = decodeServerMsg(buf);
      } catch (err) {
        console.error('[net] decode error', err);
        return;
      }
      for (const h of handlers) {
        try {
          h(msg);
        } catch (err) {
          console.error('[net] handler threw', err);
        }
      }
    });

    ws.addEventListener('close', () => {
      console.info('[net] closed');
      opts.onStatus?.('closed');
      if (intentionallyClosed) return;

      // Desistir faz parte. Antes o cliente tentava de novo a cada 1,5s
      // para sempre: com o servidor fora do ar isso é bater na porta
      // quarenta vezes por minuto, e com um cliente de protocolo
      // desatualizado — que é rejeitado na hora — o laço era infinito,
      // com um aviso na tela a cada volta e nenhuma saída.
      if (tentativas >= maxRetries) {
        console.warn('[net] desistindo da reconexão após', tentativas, 'tentativas');
        opts.onStatus?.('giveup');
        return;
      }
      const espera = opts.reconnectDelayMs ?? nextDelayMs(tentativas);
      tentativas += 1;
      setTimeout(open, espera);
    });

    ws.addEventListener('error', (ev: Event) => {
      console.error('[net] error', ev);
    });
  }

  open();

  return {
    send(msg: ClientMsg): void {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeClientMsg(msg));
        return;
      }
      // Enquanto CONECTA, descartar é o esperado: o laço de entrada roda
      // a 30Hz e começa antes do socket abrir, então toda partida
      // começava com um punhado de avisos que pareciam defeito e não
      // eram. Só o que acontece com o socket JÁ FECHADO merece registro.
      if (ws && ws.readyState === WebSocket.CONNECTING) return;
      console.warn('[net] mensagem descartada, socket fechado:', msg.type);
    },
    onMessage(handler): void {
      handlers.push(handler);
    },
    close(): void {
      intentionallyClosed = true;
      ws?.close();
    },
    isOpen(): boolean {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    },
  };
}
