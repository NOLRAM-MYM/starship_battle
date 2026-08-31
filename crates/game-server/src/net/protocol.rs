//! Tipos de mensagem trocados entre cliente e servidor.
//! Codificados com bincode para baixa banda.

use serde::{Deserialize, Serialize};

/// Versão do protocolo. Incrementar em mudanças incompatíveis.
pub const PROTOCOL_VERSION: u16 = 1;
/// Tick rate de snapshot (Hz).
pub const SNAPSHOT_RATE_HZ: u32 = 20;
/// Frequência sugerida de input do cliente (Hz).
#[allow(dead_code)] // usado em tasks 2.5+
pub const INPUT_RATE_HZ: u32 = 30;

/// Mensagem do cliente para o servidor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ClientMsg {
    /// Handshake inicial.
    Join { name: String, protocol: u16 },
    /// Input contínuo (enviado a ~30Hz).
    Input {
        /// -1..=1 (yaw esquerda/direita).
        steer: f32,
        /// 0..=1 (thrust para frente).
        thrust: f32,
        /// Disparo de arma primária.
        fire: bool,
    },
    /// Heartbeat (liveness).
    Ping { nonce: u32 },
}

/// Mensagem do servidor para o cliente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ServerMsg {
    /// Resposta ao Join, atribui player_id.
    Welcome {
        player_id: u32,
        protocol: u16,
        tick_rate: u32,
    },
    /// Snapshot completo do estado do mundo visível ao player.
    Snapshot(SnapshotData),
    /// Entidade foi destruída (HP=0, TTL expirado, etc).
    EntityDestroyed { entity_id: u32 },
    /// Resposta a Ping.
    Pong { nonce: u32 },
    /// Erro de protocolo.
    Error { reason: String },
}

/// Dados de um snapshot. Serializado com bincode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotData {
    /// Tick do servidor.
    pub tick: u64,
    /// Server time em ms desde epoch.
    pub server_time_ms: u64,
    /// Entidades visíveis (incluindo self).
    pub entities: Vec<EntityState>,
}

/// Estado serializado de uma entidade.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityState {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: [f32; 3],
    pub rot: [f32; 4], // quaternion (x,y,z,w)
    pub vel: [f32; 3],
    /// HP ratio (0..=1). 0 = destruído. None = não aplicável.
    pub hp_ratio: Option<f32>,
    /// Nome exibido (ex.: player name).
    pub display_name: Option<String>,
}

/// Tipo da entidade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityKind {
    Ship,
    Projectile,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_msg_roundtrips() {
        let original = ClientMsg::Input { steer: 0.5, thrust: 1.0, fire: true };
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ClientMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn server_msg_welcome_roundtrips() {
        let original = ServerMsg::Welcome { player_id: 42, protocol: 1, tick_rate: 20 };
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn snapshot_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 100,
            server_time_ms: 5_000,
            entities: vec![EntityState {
                id: 1,
                kind: EntityKind::Ship,
                pos: [1.0, 2.0, 3.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [10.0, 0.0, 0.0],
                hp_ratio: Some(0.75),
                display_name: Some("tester".into()),
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }
}
