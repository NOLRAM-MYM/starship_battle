//! Servidor WebSocket. Aceita conexões, faz handshake, reencaminha msgs.
//!
//! O handler não toca no mundo: ele traduz frames em `PlayerCommand` e
//! empurra na fila que o loop de simulação drena uma vez por tick. Antes,
//! cada `Input` recebido tomava `world.write()` — com N jogadores a 30Hz
//! isso eram 30·N aquisições exclusivas por segundo disputando com o
//! próprio loop de simulação.

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tracing::{debug, info, warn};

use super::protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION, SNAPSHOT_RATE_HZ};
use crate::state::{encode_msg, PlayerCommand, ServerState};

/// Mensagem bruta (bincode) que o handler envia para a simulação.
#[allow(dead_code)] // mantido para compatibilidade com testes externos
#[derive(Debug, Clone)]
pub struct Inbound {
    pub player_id: u32,
    pub msg: ClientMsg,
}

/// Listener WebSocket que faz handshake e roteia mensagens.
pub async fn serve(
    bind: &str,
    state: ServerState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = bind_dual_stack(bind)?;
    info!(%bind, "ws listening");
    serve_on(listener, state).await
}

/// Abre o listener aceitando IPv4 E IPv6.
///
/// `TcpListener::bind("[::]:porta")` NÃO basta: `IPV6_V6ONLY` tem padrão
/// diferente por sistema — desligado no Linux (aceita os dois) e LIGADO
/// no Windows (só IPv6). Foi exatamente esse o defeito: o servidor subia
/// em `[::]:7777`, parecia no ar, e todo cliente que usasse `127.0.0.1`
/// levava ERR_CONNECTION_REFUSED.
///
/// Desligar a opção explicitamente faz o socket v6 atender também
/// endereços v4 mapeados, nos dois sistemas. Para um endereço IPv4 puro
/// (`0.0.0.0`) não há o que ajustar.
fn bind_dual_stack(bind: &str) -> Result<TcpListener, Box<dyn std::error::Error + Send + Sync>> {
    use socket2::{Domain, Protocol, Socket, Type};
    use std::net::{SocketAddr, ToSocketAddrs};

    let addr: SocketAddr = bind
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| format!("endereço inválido: {bind}"))?;

    let domain = Domain::for_address(addr);
    let socket = Socket::new(domain, Type::STREAM, Some(Protocol::TCP))?;
    if domain == Domain::IPV6 {
        socket.set_only_v6(false)?;
    }
    // Sem isto, reiniciar o servidor esbarra em TIME_WAIT da execução
    // anterior — no desenvolvimento isso acontece a cada rebuild.
    socket.set_reuse_address(true)?;
    socket.bind(&addr.into())?;
    socket.listen(1024)?;
    socket.set_nonblocking(true)?;

    Ok(TcpListener::from_std(std::net::TcpListener::from(socket))?)
}

/// Mesma coisa, sobre um listener JÁ vinculado.
///
/// Existe para os testes: quem quer uma porta efêmera precisa segurar o
/// listener desde o `bind`. Se soltasse para o `serve` religar, outro
/// teste rodando em paralelo poderia tomar a porta nesse intervalo — que
/// foi exatamente o flake observado ao rodar a suíte inteira.
pub async fn serve_on(
    listener: TcpListener,
    state: ServerState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    loop {
        // Um erro de accept (fd esgotado, cliente que fechou no meio do
        // handshake TCP) não pode derrubar o servidor inteiro — antes o
        // `?` propagava e matava o listener para todos os jogadores.
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                warn!(error = %e, "accept falhou, seguindo");
                continue;
            }
        };
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, peer.to_string(), state).await {
                warn!(%peer, error = %e, "connection ended with error");
            }
        });
    }
}

async fn handle_conn(
    stream: tokio::net::TcpStream,
    peer: String,
    state: ServerState,
) -> Result<(), WsError> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    info!(%peer, "ws accepted");
    let (mut write, mut read) = ws.split();

    // Aloca player_id e fila de saída limitada.
    let player_id = state.alloc_player_id();
    let mut rx = state.register_client(player_id).await;

    // Envia Welcome.
    let world_seed = state.world_seed().await;
    let welcome = ServerMsg::Welcome {
        player_id,
        protocol: PROTOCOL_VERSION,
        tick_rate: SNAPSHOT_RATE_HZ,
        world_seed,
    };
    write.send(encode_msg(&welcome)).await?;

    // Corpos celestes do setor: enviados UMA vez, logo após o Welcome.
    // São cenário fixo com massa — o cliente precisa deles para desenhar
    // e para o HUD avisar sobre poço gravitacional.
    let bodies = state.sector_bodies().await;
    write
        .send(encode_msg(&ServerMsg::Sector {
            bodies,
            gravity_constant: sim_core::worldgen::celestial::GRAVITY_CONSTANT,
            ship_drag: crate::world::PLAYER_SHIP_DRAG,
        }))
        .await?;

    // Loop principal: select entre mensagens recebidas e frames de saída.
    let result = loop {
        tokio::select! {
            ws_msg = read.next() => {
                let Some(msg) = ws_msg else { break Ok(()); };
                let bytes = match msg {
                    Ok(Message::Binary(b)) => b,
                    Ok(Message::Close(_)) => break Ok(()),
                    Ok(other) => {
                        debug!(?other, "ignoring non-binary frame");
                        continue;
                    }
                    Err(e) => break Err(e),
                };
                let client_msg = match bincode::deserialize::<ClientMsg>(&bytes) {
                    Ok(m) => m,
                    Err(e) => {
                        warn!(%peer, error = %e, "bad client msg");
                        let err = ServerMsg::Error { reason: e.to_string() };
                        if let Err(e) = write.send(encode_msg(&err)).await {
                            break Err(e);
                        }
                        continue;
                    }
                };

                match client_msg {
                    // Pong é respondido no próprio handler: é uma medida
                    // de RTT, passar pela fila do tick a distorceria.
                    ClientMsg::Ping { nonce } => {
                        if let Err(e) = write.send(encode_msg(&ServerMsg::Pong { nonce })).await {
                            break Err(e);
                        }
                    }
                    ClientMsg::Join {
                        name,
                        protocol,
                        loadout,
                        skills,
                        consumables,
                        practice,
                    } => {
                        if protocol != PROTOCOL_VERSION {
                            // Cliente desatualizado: avisa e encerra, em vez
                            // de deixá-lo interpretar bytes com outro layout.
                            let reason = format!(
                                "protocolo incompatível: cliente v{protocol}, servidor v{PROTOCOL_VERSION}"
                            );
                            warn!(%peer, player_id, protocol, "join rejeitado");
                            let _ = write.send(encode_msg(&ServerMsg::Error { reason })).await;
                            break Ok(());
                        }
                        info!(
                            %peer,
                            player_id,
                            %name,
                            modulos = loadout.len(),
                            skills = skills.len(),
                            cargas = consumables.len(),
                            "player joined"
                        );
                        state.enqueue(PlayerCommand::Join {
                            player_id,
                            name,
                            loadout,
                            skills,
                            consumables,
                            practice,
                        });
                    }
                    ClientMsg::Input {
                        steer,
                        pitch,
                        roll,
                        thrust,
                        fire,
                        fire_charge,
                        skill,
                        use_consumable,
                        launch_torpedo,
                        deploy_decoys,
                        fine_control,
                    } => {
                        state.enqueue(PlayerCommand::Input {
                            player_id,
                            steer,
                            pitch,
                            roll,
                            thrust,
                            fire,
                            fire_charge,
                            skill,
                            use_consumable,
                            launch_torpedo,
                            deploy_decoys,
                            fine_control,
                        });
                    }
                }
            }
            frame = rx.recv() => {
                let Some(frame) = frame else { break Ok(()); };
                // O frame já vem serializado e compartilhado por Arc:
                // nenhuma cópia do payload por cliente.
                if let Err(e) = write.send(Message::Binary(frame.as_ref().clone())).await {
                    break Err(e);
                }
            }
        }
    };

    info!(%peer, player_id, "ws closed");
    state.unregister_client(player_id).await;
    result
}
