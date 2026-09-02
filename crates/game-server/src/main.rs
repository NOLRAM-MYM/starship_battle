//! game-server: servidor de jogo autoritativo.
//! Roda em tokio, usa bevy_ecs para a simulação e tokio-tungstenite para rede.

#![deny(unsafe_code)]

mod net;
mod npc;
mod state;
mod world;

use tracing_subscriber::EnvFilter;

use crate::state::{run_simulation_loop, ServerState};
use crate::net::ws::serve;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // `[::]` e não `0.0.0.0`: o socket sai em dual-stack e atende tanto
    // 127.0.0.1 quanto ::1. Só em IPv4, um cliente que resolve
    // `localhost` para ::1 — o padrão no Windows — fica esperando a
    // conexão sem receber nem uma recusa.
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "[::]:7777".to_string());
    let server_state = ServerState::new();

    // Spawna o loop de simulação autoritativo.
    let sim_state = server_state.clone();
    tokio::spawn(async move {
        run_simulation_loop(sim_state).await;
    });

    tracing::info!(%bind_addr, "game-server starting");
    serve(&bind_addr, server_state).await?;
    Ok(())
}
