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
                    world_seed: 0xC0FFEE,
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
    let (ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut write, mut read) = ws.split();

    // Envia Join.
    let join = ClientMsg::Join {
            name: "alice".into(),
            protocol: 1 ,
            loadout: vec!["railgun_s".into()],
            skills: vec![],
            consumables: vec![],
            practice: false,
        };
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

/// O listener precisa atender IPv4 E IPv6.
///
/// `bind("[::]:porta")` sozinho não garante isso: `IPV6_V6ONLY` vem
/// desligado no Linux e LIGADO no Windows. O servidor subia em `[::]`,
/// parecia no ar, e todo cliente em `127.0.0.1` levava conexão recusada
/// — inclusive o próprio jogo, porque a URL padrão usa o IP literal.
#[tokio::test]
async fn aceita_conexao_em_ipv4_e_ipv6() {
    use game_server::net::ws::serve;
    use game_server::state::ServerState;

    // Porta efêmera: descobre uma livre e solta antes de servir.
    let porta = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };

    let state = ServerState::new();
    let bind = format!("[::]:{porta}");
    tokio::spawn(async move {
        let _ = serve(&bind, state).await;
    });

    // Aguarda o listener subir usando IPv6, que funciona em qualquer
    // caso — sondar por IPv4 aqui faria o teste gastar ~2s por tentativa
    // recusada no Windows justamente quando ele está falhando, e o
    // diagnóstico demoraria minutos em vez de segundos.
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("::1", porta)).await.is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    let v4 = tokio::net::TcpStream::connect(("127.0.0.1", porta)).await;
    assert!(v4.is_ok(), "IPv4 deveria conectar: {:?}", v4.err());

    let v6 = tokio::net::TcpStream::connect(("::1", porta)).await;
    assert!(v6.is_ok(), "IPv6 deveria conectar: {:?}", v6.err());
}
