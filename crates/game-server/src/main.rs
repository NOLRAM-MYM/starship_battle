//! game-server: servidor de jogo autoritativo.
//! Roda em tokio, usa bevy_ecs para a simulação e tokio-tungstenite para rede.

#![deny(unsafe_code)]

mod net;

use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing_subscriber::EnvFilter;

use crate::net::ws::{serve, Outbound};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:7777".to_string());

    let (tx, _rx) = mpsc::unbounded_channel::<(u32, net::protocol::ServerMsg)>();
    let outbound = Outbound { tx };
    let next_player_id = Arc::new(Mutex::new(0u32));

    tracing::info!(%bind_addr, "game-server starting");
    serve(&bind_addr, outbound, next_player_id).await?;
    Ok(())
}
