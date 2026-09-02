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
  reconnectDelayMs?: number;
  onStatus?: (status: 'connecting' | 'open' | 'closed') => void;
}

export function connect(opts: NetClientOptions): NetClient {
  const handlers: ((msg: ServerMsg) => void)[] = [];
  const reconnectDelay = opts.reconnectDelayMs ?? 1500;
  let ws: WebSocket | null = null;
  let intentionallyClosed = false;

  function open(): void {
    opts.onStatus?.('connecting');
    ws = new WebSocket(opts.url);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      console.info('[net] open', opts.url);
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
      if (!intentionallyClosed) {
        setTimeout(open, reconnectDelay);
      }
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
      } else {
        console.warn('[net] drop msg, socket not open', msg.type);
      }
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
