//! Teste de integração com DOIS JOGADORES SIMULTÂNEOS contra o servidor real.
//!
//! O teste de integração que já existia (`ws_integration.rs`) usava um
//! servidor **falso** montado dentro do próprio teste — nunca exercitou
//! `net::ws::serve` nem o loop de simulação. Aqui subimos o servidor de
//! verdade e conectamos dois clientes WebSocket reais, que é o único jeito
//! de validar o caminho novo ponta a ponta:
//!
//!   - fila de comandos (input não toma mais lock do mundo);
//!   - broadcast com frame serializado uma vez e compartilhado por Arc;
//!   - AOI (cada cliente recebe o snapshot centrado na sua nave);
//!   - `WorldChunk` para entidades estáticas;
//!   - limpeza de estado quando um jogador desconecta.

use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use game_server::net::protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION};
use game_server::state::{run_simulation_loop, ServerState};
use game_server::world::Position;

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsWrite = SplitSink<Ws, Message>;
type WsRead = SplitStream<Ws>;

/// Sobe o servidor real (listener + loop de simulação) numa porta livre.
async fn spawn_real_server(state: ServerState) -> u16 {
    // Segura o listener desde o bind e entrega pronto ao servidor: soltar
    // a porta para religar depois abre uma janela em que outro teste
    // paralelo pode tomá-la.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let sim_state = state.clone();
    tokio::spawn(async move { run_simulation_loop(sim_state).await });

    let serve_state = state.clone();
    tokio::spawn(async move {
        let _ = game_server::net::ws::serve_on(listener, serve_state).await;
    });

    // Espera o listener aceitar conexão antes de devolver a porta.
    for _ in 0..50 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return port;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("servidor não subiu na porta {port}");
}

async fn connect(port: u16) -> (WsWrite, WsRead) {
    let url = format!("ws://127.0.0.1:{port}");
    let (ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    ws.split()
}

async fn send(write: &mut WsWrite, msg: &ClientMsg) {
    let bytes = bincode::serialize(msg).unwrap();
    write.send(Message::Binary(bytes)).await.unwrap();
}

/// Lê a próxima mensagem do servidor, com timeout.
async fn recv(read: &mut WsRead) -> Option<ServerMsg> {
    let frame = timeout(Duration::from_secs(3), read.next()).await.ok()??;
    match frame.ok()? {
        Message::Binary(b) => bincode::deserialize(&b).ok(),
        _ => None,
    }
}

/// Consome mensagens até achar a primeira que satisfaz `pred`.
/// Devolve `None` se estourar o limite de frames.
async fn recv_until<F, T>(read: &mut WsRead, mut pred: F) -> Option<T>
where
    F: FnMut(ServerMsg) -> Result<T, ServerMsg>,
{
    for _ in 0..200 {
        let msg = recv(read).await?;
        match pred(msg) {
            Ok(v) => return Some(v),
            Err(_) => continue,
        }
    }
    None
}

/// Extrai o snapshot, se a mensagem for um.
fn as_snapshot(msg: ServerMsg) -> Result<game_server::net::protocol::SnapshotData, ServerMsg> {
    match msg {
        ServerMsg::Snapshot(s) => Ok(s),
        other => Err(other),
    }
}

#[tokio::test]
async fn dois_jogadores_se_veem_e_se_movem() {
    let state = ServerState::new();
    let port = spawn_real_server(state.clone()).await;

    // --- Jogador 1 conecta e entra ---
    let (mut w1, mut r1) = connect(port).await;
    let welcome1 = recv(&mut r1).await.expect("welcome do jogador 1");
    let id1 = match welcome1 {
        ServerMsg::Welcome {
            player_id, protocol, ..
        } => {
            assert_eq!(protocol, PROTOCOL_VERSION, "servidor anuncia v3");
            player_id
        }
        other => panic!("esperado Welcome, veio {other:?}"),
    };
    send(
        &mut w1,
        &ClientMsg::Join {
            name: "alice".into(),
            protocol: PROTOCOL_VERSION,
            loadout: vec!["engine_mk3".into(), "railgun_s".into()],
            skills: vec![],
        },
    )
    .await;

    // --- Jogador 2 conecta e entra, simultaneamente ---
    let (mut w2, mut r2) = connect(port).await;
    let welcome2 = recv(&mut r2).await.expect("welcome do jogador 2");
    let id2 = match welcome2 {
        ServerMsg::Welcome { player_id, .. } => player_id,
        other => panic!("esperado Welcome, veio {other:?}"),
    };
    send(
        &mut w2,
        &ClientMsg::Join {
            name: "bob".into(),
            protocol: PROTOCOL_VERSION,
            loadout: vec!["engine_mk3".into(), "railgun_s".into()],
            skills: vec![],
        },
    )
    .await;

    assert_ne!(id1, id2, "cada conexão recebe um player_id próprio");

    // --- Ambos aceleram para frente ---
    for _ in 0..10 {
        send(
            &mut w1,
            &ClientMsg::Input {
                steer: 0.0,
                pitch: 0.0,
                roll: 0.0,
                thrust: 1.0,
                fire: false,
                fire_charge: 0.0,
                skill: None,
            },
        )
        .await;
        send(
            &mut w2,
            &ClientMsg::Input {
                // Sobe o nariz enquanto curva: prova que o voo saiu do
                // plano horizontal (a v3 só tinha yaw).
                steer: 1.0,
                pitch: 0.6,
                roll: 0.0,
                thrust: 1.0,
                fire: false,
                fire_charge: 0.0,
                skill: None,
            },
        )
        .await;
        tokio::time::sleep(Duration::from_millis(40)).await;
    }

    // --- Cada cliente vê as DUAS naves no seu snapshot ---
    let snap1 = recv_until(&mut r1, |m| {
        as_snapshot(m).and_then(|s| if s.entities.len() >= 2 { Ok(s) } else { Err(ServerMsg::Pong { nonce: 0 }) })
    })
    .await
    .expect("jogador 1 recebeu snapshot com as duas naves");

    let nomes1: Vec<String> = snap1
        .entities
        .iter()
        .filter_map(|e| e.display_name.clone())
        .collect();
    assert!(
        nomes1.iter().any(|n| n == "alice") && nomes1.iter().any(|n| n == "bob"),
        "jogador 1 deveria ver alice e bob, viu {nomes1:?}"
    );

    let snap2 = recv_until(&mut r2, |m| {
        as_snapshot(m).and_then(|s| if s.entities.len() >= 2 { Ok(s) } else { Err(ServerMsg::Pong { nonce: 0 }) })
    })
    .await
    .expect("jogador 2 recebeu snapshot com as duas naves");
    let nomes2: Vec<String> = snap2
        .entities
        .iter()
        .filter_map(|e| e.display_name.clone())
        .collect();
    assert!(
        nomes2.iter().any(|n| n == "alice") && nomes2.iter().any(|n| n == "bob"),
        "jogador 2 deveria ver alice e bob, viu {nomes2:?}"
    );

    // --- O input passou pela fila e moveu as naves de verdade ---
    {
        let world = state.world.read().await;
        assert_eq!(world.ships.len(), 2, "duas naves no mundo");
        assert!(world.player_ships.contains_key(&id1));
        assert!(world.player_ships.contains_key(&id2));

        let p1 = world.player_position(id1).unwrap();
        let p2 = world.player_position(id2).unwrap();
        let dist1 = (p1.x * p1.x + p1.y * p1.y + p1.z * p1.z).sqrt();
        let dist2 = (p2.x * p2.x + p2.y * p2.y + p2.z * p2.z).sqrt();
        assert!(dist1 > 0.5, "alice não saiu da origem: {p1:?}");
        assert!(dist2 > 0.5, "bob não saiu da origem: {p2:?}");

        // bob virou (steer=1) e alice foi reto: trajetórias diferentes.
        assert_ne!(
            (p1.x.to_bits(), p1.z.to_bits()),
            (p2.x.to_bits(), p2.z.to_bits()),
            "as duas naves não deveriam estar exatamente na mesma posição"
        );
    }

    // --- Desconectar o jogador 2 limpa o estado do servidor ---
    drop(w2);
    drop(r2);
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(40)).await;
        let world = state.world.read().await;
        if !world.player_ships.contains_key(&id2) {
            break;
        }
    }
    let world = state.world.read().await;
    assert!(
        !world.player_ships.contains_key(&id2),
        "nave do jogador desconectado ficou órfã no mundo"
    );
    assert!(
        world.player_ships.contains_key(&id1),
        "jogador que continuou conectado foi removido junto"
    );
}

#[tokio::test]
async fn entidades_estaticas_chegam_por_world_chunk_e_nao_no_snapshot() {
    let state = ServerState::new();
    // Um asteroide perto da origem, onde as naves nascem.
    {
        let mut world = state.world.write().await;
        world.spawn_asteroid(
            Position {
                x: 60.0,
                y: 0.0,
                z: 0.0,
            },
            1,
            20.0,
            50,
        );
    }
    let port = spawn_real_server(state.clone()).await;

    let (mut w, mut r) = connect(port).await;
    let _ = recv(&mut r).await;
    send(
        &mut w,
        &ClientMsg::Join {
            name: "scout".into(),
            protocol: PROTOCOL_VERSION,
            loadout: vec!["engine_mk3".into(), "railgun_s".into()],
            skills: vec![],
        },
    )
    .await;

    let mut viu_chunk_com_asteroide = false;
    let mut estatico_em_snapshot = false;

    for _ in 0..80 {
        match recv(&mut r).await {
            Some(ServerMsg::WorldChunk(c)) => {
                if c.entities.iter().any(|e| {
                    matches!(e.kind, game_server::net::protocol::EntityKind::Asteroid)
                }) {
                    viu_chunk_com_asteroide = true;
                }
            }
            Some(ServerMsg::Snapshot(s)) => {
                if s.entities.iter().any(|e| {
                    matches!(e.kind, game_server::net::protocol::EntityKind::Asteroid)
                }) {
                    estatico_em_snapshot = true;
                }
            }
            Some(_) => {}
            None => break,
        }
        if viu_chunk_com_asteroide {
            break;
        }
    }

    assert!(
        viu_chunk_com_asteroide,
        "o asteroide deveria chegar via WorldChunk"
    );
    assert!(
        !estatico_em_snapshot,
        "entidade estática vazou para o snapshot de 20Hz — a economia de banda da v3 depende disso"
    );
}

#[tokio::test]
async fn cliente_com_protocolo_antigo_e_recusado() {
    let state = ServerState::new();
    let port = spawn_real_server(state.clone()).await;

    let (mut w, mut r) = connect(port).await;
    let _ = recv(&mut r).await; // Welcome

    send(
        &mut w,
        &ClientMsg::Join {
            name: "legado".into(),
            protocol: PROTOCOL_VERSION - 1,
            loadout: vec!["engine_mk3".into(), "railgun_s".into()],
            skills: vec![],
        },
    )
    .await;

    // O servidor manda `Sector` logo após o Welcome; o erro de
    // protocolo vem depois dele.
    let msg = recv_until(&mut r, |m| match m {
        ServerMsg::Error { reason } => Ok(ServerMsg::Error { reason }),
        other => Err(other),
    })
    .await
    .expect("servidor responde ao join inválido");
    match msg {
        ServerMsg::Error { reason } => {
            assert!(
                reason.contains("protocolo"),
                "erro deveria explicar a incompatibilidade, veio: {reason}"
            );
        }
        other => panic!("esperado Error de protocolo, veio {other:?}"),
    }

    // E o jogador não deve ter entrado no mundo.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let world = state.world.read().await;
    assert!(
        world.ships.is_empty(),
        "cliente recusado não pode ter nave no mundo"
    );
}
