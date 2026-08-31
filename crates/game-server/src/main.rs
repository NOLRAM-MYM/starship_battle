//! game-server: servidor de jogo autoritativo.
//! Roda em tokio, usa bevy_ecs para a simulação e tokio-tungstenite para rede.

#![deny(unsafe_code)]

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:7777".to_string());
    tracing::info!(%bind_addr, "game-server listening");

    // Mantém o processo vivo. Tasks de rede/simulação serão adicionadas em 2.2+.
    tokio::time::sleep(std::time::Duration::from_secs(u64::MAX / 4)).await;
    Ok(())
}
