//! game-server: servidor de jogo autoritativo.
//! Roda em tokio, usa bevy_ecs para a simulação e tokio-tungstenite para rede.

#![deny(unsafe_code)]

pub mod net;
