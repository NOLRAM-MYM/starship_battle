//! Servidor WebSocket. Aceita conexões, faz handshake, reencaminha msgs.

use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tracing::{debug, error, info, warn};

use super::protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION, SNAPSHOT_RATE_HZ};

/// Mensagem bruta (bincode) que o handler envia para a simulação.
#[allow(dead_code)] // usado em task 2.3+
#[derive(Debug, Clone)]
pub struct Inbound {
    pub player_id: u32,
    pub msg: ClientMsg,
}

/// Canal para broadcast de saída do servidor.
#[derive(Clone)]
pub struct Outbound {
    pub tx: mpsc::UnboundedSender<(u32, ServerMsg)>,
}

/// Listener WebSocket que faz handshake e roteia mensagens.
pub async fn serve(
    bind: &str,
    outbound: Outbound,
    next_player_id: Arc<tokio::sync::Mutex<u32>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(bind).await?;
    info!(%bind, "ws listening");

    loop {
        let (stream, peer) = listener.accept().await?;
        let outbound = outbound.clone();
        let next_player_id = next_player_id.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, peer.to_string(), outbound, next_player_id).await {
                warn!(%peer, error = %e, "connection ended with error");
            }
        });
    }
}

async fn handle_conn(
    stream: TcpStream,
    peer: String,
    outbound: Outbound,
    next_player_id: Arc<tokio::sync::Mutex<u32>>,
) -> Result<(), WsError> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    info!(%peer, "ws accepted");
    let (mut write, mut read) = ws.split();

    // Aloca player_id.
    let player_id = {
        let mut g = next_player_id.lock().await;
        let id = *g;
        *g += 1;
        id
    };

    // Envia Welcome.
    let welcome = ServerMsg::Welcome {
        player_id,
        protocol: PROTOCOL_VERSION,
        tick_rate: SNAPSHOT_RATE_HZ,
    };
    let bytes = bincode::serialize(&welcome).expect("Welcome is serializable");
    write.send(Message::Binary(bytes)).await?;

    // Spawna task que escuta broadcast e envia ao socket.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<ServerMsg>();
    outbound
        .tx
        .send((player_id, ServerMsg::Welcome {
            player_id,
            protocol: PROTOCOL_VERSION,
            tick_rate: SNAPSHOT_RATE_HZ,
        }))
        .ok();
    // Observação: o canal global `outbound.tx` é alimentado por sistemas; aqui só
    // re-emitimos para out_rx quando recebermos algo endereçado a este player.
    // Para MVP, deixamos out_rx vazio; snapshots virão via outro mecanismo em 2.3.
    drop(out_tx);

    loop {
        tokio::select! {
            // Mensagem recebida do cliente.
            ws_msg = read.next() => {
                let Some(msg) = ws_msg else { break; };
                let msg = match msg? {
                    Message::Binary(b) => b,
                    Message::Close(_) => break,
                    other => {
                        debug!(?other, "ignoring non-binary frame");
                        continue;
                    }
                };
                let parsed: Result<ClientMsg, _> = bincode::deserialize(&msg);
                let client_msg = match parsed {
                    Ok(m) => m,
                    Err(e) => {
                        warn!(%peer, error = %e, "bad client msg");
                        let err = ServerMsg::Error { reason: e.to_string() };
                        let bytes = bincode::serialize(&err).unwrap();
                        write.send(Message::Binary(bytes)).await?;
                        continue;
                    }
                };
                debug!(%peer, ?client_msg, "rx");
                if matches!(client_msg, ClientMsg::Ping { .. }) {
                    // Responde Pong diretamente.
                    if let ClientMsg::Ping { nonce } = client_msg {
                        let bytes = bincode::serialize(&ServerMsg::Pong { nonce }).unwrap();
                        write.send(Message::Binary(bytes)).await?;
                    }
                    continue;
                }
                // Encaminha para a simulação (registro de presença + input).
                if let Err(e) = handle_inbound(player_id, client_msg, &outbound).await {
                    error!(%peer, error = %e, "inbound handler failed");
                }
            }
            // Mensagem de saída (broadcast endereçado).
            Some(out_msg) = out_rx.recv() => {
                let bytes = bincode::serialize(&out_msg).expect("ServerMsg is serializable");
                write.send(Message::Binary(bytes)).await?;
            }
            else => break,
        }
    }
    info!(%peer, "ws closed");
    Ok(())
}

async fn handle_inbound(
    player_id: u32,
    msg: ClientMsg,
    outbound: &Outbound,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Stub: apenas repassa para o barramento global. Em 2.3+ o sistema de input
    // consome daqui para popular componentes ECS.
    let _ = (player_id, msg, outbound);
    Ok(())
}
