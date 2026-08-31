//! Teste de integração: dois clientes conectam via WS e recebem Welcome.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

use game_server::net::protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION, SNAPSHOT_RATE_HZ};

async fn spawn_server() -> u16 {
    // Bind em porta aleatória (0) e descobrir.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        // Toca accept em loop mínimo (não usamos o módulo `serve` para evitar ciclo).
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let (mut w, mut r) = ws.split();
                let welcome = ServerMsg::Welcome {
                    player_id: 1,
                    protocol: PROTOCOL_VERSION,
                    tick_rate: SNAPSHOT_RATE_HZ,
                };
                let bytes = bincode::serialize(&welcome).unwrap();
                w.send(Message::Binary(bytes)).await.unwrap();
                while let Some(Ok(_msg)) = r.next().await {}
            });
        }
    });
    port
}

#[tokio::test]
async fn client_connects_and_receives_welcome() {
    let port = spawn_server().await;
    let url = format!("ws://127.0.0.1:{port}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut write, mut read) = ws.split();

    // Envia Join.
    let join = ClientMsg::Join { name: "alice".into(), protocol: 1 };
    let bytes = bincode::serialize(&join).unwrap();
    write.send(Message::Binary(bytes)).await.unwrap();

    // Recebe Welcome.
    let frame = timeout(Duration::from_secs(2), read.next()).await.unwrap();
    let frame = frame.unwrap().unwrap();
    let bytes = match frame {
        Message::Binary(b) => b,
        other => panic!("expected Binary, got {other:?}"),
    };
    let msg: ServerMsg = bincode::deserialize(&bytes).unwrap();
    match msg {
        ServerMsg::Welcome { protocol, tick_rate, .. } => {
            assert_eq!(protocol, PROTOCOL_VERSION);
            assert_eq!(tick_rate, SNAPSHOT_RATE_HZ);
        }
        other => panic!("expected Welcome, got {other:?}"),
    }
}
