#![allow(dead_code)]

//! Integração de NPCs no game-server.
//!
//! Usa `sim_core::ai` (FSM, behaviors, percepção) para gerenciar NPCs
//! no mundo autoritativo. NPCs são persistidos no `World` (não bevy_ecs
//! ainda) e entram no snapshot binário como `EntityKind::Npc` com
//! `EntityPayload::Npc`.
//!
//! Cada NPC tem:
//! - `NpcKind`      : arquétipo (pirata, patrulheiro, minerador).
//! - `NpcAiState`   : wrapper de `sim_core::ai::NpcMemory`.
//! - `NpcRuntime`   : posição/velocidade + cooldown de ataque.

use sim_core::ai::{apply_transition, NpcArchetype, NpcMemory, NpcState, Perception, Vec3};
use sim_core::worldgen::{AsteroidKind, AnomalyKind};

use crate::net::protocol::{EntityPayload, NpcPayload};
use crate::world::{Position, Velocity};

/// Arquétipos de NPC disponíveis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NpcKind {
    Pirate = 1,
    Patrol = 2,
    Miner = 3,
}

impl NpcKind {
    pub fn archetype(self) -> NpcArchetype {
        match self {
            NpcKind::Pirate => NpcArchetype {
                max_speed: 70.0,
                max_accel: 35.0,
                sensor_range: 900.0,
                weapon_range: 280.0,
                flee_hp_threshold: 0.2,
                waypoint_arrive_radius: 25.0,
            },
            NpcKind::Patrol => NpcArchetype {
                max_speed: 55.0,
                max_accel: 25.0,
                sensor_range: 700.0,
                weapon_range: 220.0,
                flee_hp_threshold: 0.15,
                waypoint_arrive_radius: 20.0,
            },
            NpcKind::Miner => NpcArchetype {
                max_speed: 35.0,
                max_accel: 15.0,
                sensor_range: 500.0,
                weapon_range: 150.0,
                flee_hp_threshold: 0.4,
                waypoint_arrive_radius: 15.0,
            },
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Estado completo de um NPC no servidor.
#[derive(Debug, Clone)]
pub struct Npc {
    pub kind: NpcKind,
    pub memory: NpcMemory,
    pub radius: f32,
    pub hull_hp: f32,
    pub hull_max: f32,
    pub attack_cooldown: f32,
    /// Alvo atual (entity_id do player ou outro NPC). None se sem alvo.
    pub target_id: Option<u32>,
}

impl Npc {
    pub fn new(kind: NpcKind, _position: Vec3) -> Self {
        Self {
            kind,
            memory: NpcMemory::new(NpcState::Patrol, 1.0),
            radius: 5.0,
            hull_hp: 100.0,
            hull_max: 100.0,
            attack_cooldown: 0.0,
            target_id: None,
        }
    }

    /// Computa `ai_state` como u8 (índice na enum).
    pub fn ai_state_u8(&self) -> u8 {
        match self.memory.state {
            NpcState::Idle => 0,
            NpcState::Patrol => 1,
            NpcState::Chase => 2,
            NpcState::Attack => 3,
            NpcState::Flee => 4,
            NpcState::Dead => 5,
        }
    }

    pub fn hp_ratio(&self) -> f32 {
        (self.hull_hp / self.hull_max).clamp(0.0, 1.0)
    }
}

/// Helper para construir `EntityPayload::Npc` a partir de um NPC.
pub fn build_npc_payload(npc: &Npc) -> EntityPayload {
    EntityPayload::Npc(NpcPayload {
        archetype: npc.kind.as_u8(),
        ai_state: npc.ai_state_u8(),
        radius: npc.radius,
        target_id: npc.target_id,
    })
}

/// Helper para construir percepção a partir de estado do servidor.
pub fn make_perception(
    self_pos: Vec3,
    self_vel: Vec3,
    enemy_pos: Option<Vec3>,
    enemy_vel: Option<Vec3>,
    tick: u64,
) -> Perception {
    Perception {
        self_pos,
        self_vel,
        enemy_pos,
        enemy_vel,
        waypoint_dist: None,
        current_tick: tick,
    }
}

/// Avança a FSM de um NPC (apenas transição de estado, sem física).
pub fn step_npc_ai(
    npc: &mut Npc,
    self_pos: Vec3,
    self_vel: Vec3,
    enemy_pos: Option<Vec3>,
    enemy_vel: Option<Vec3>,
    tick: u64,
) {
    let arch = npc.kind.archetype();
    let per = make_perception(self_pos, self_vel, enemy_pos, enemy_vel, tick);
    apply_transition(&arch, &mut npc.memory, &per);
}

/// Helpers para converter tipos do game-server ↔ sim-core.
pub mod conv {
    use super::Position;
    use super::Velocity;
    use sim_core::ai::Vec3;

    pub fn pos_to_vec3(p: Position) -> Vec3 {
        Vec3::new(p.x, p.y, p.z)
    }

    pub fn vel_to_vec3(v: Velocity) -> Vec3 {
        Vec3::new(v.x, v.y, v.z)
    }

    pub fn vec3_to_pos(v: Vec3) -> Position {
        Position { x: v.x, y: v.y, z: v.z }
    }

    pub fn vec3_to_vel(v: Vec3) -> Velocity {
        Velocity { x: v.x, y: v.y, z: v.z }
    }
}

/// Converte AsteroidKind do sim-core para u8 do protocolo.
pub fn asteroid_kind_to_u8(k: AsteroidKind) -> u8 {
    match k {
        AsteroidKind::Rock => 0,
        AsteroidKind::Iron => 1,
        AsteroidKind::Gold => 2,
        AsteroidKind::DarkMatter => 3,
    }
}

/// Converte AnomalyKind do sim-core para u8 do protocolo.
pub fn anomaly_kind_to_u8(k: AnomalyKind) -> u8 {
    match k {
        AnomalyKind::Warp => 0,
        AnomalyKind::Radiation => 1,
        AnomalyKind::GravityWell => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npc_kind_archetype_varies() {
        let pirate = NpcKind::Pirate.archetype();
        let miner = NpcKind::Miner.archetype();
        assert!(pirate.max_speed > miner.max_speed);
        assert!(pirate.weapon_range > miner.weapon_range);
    }

    #[test]
    fn ai_state_u8_covers_all_states() {
        let mut npc = Npc::new(NpcKind::Pirate, Vec3::ZERO);
        npc.memory.state = NpcState::Idle;
        assert_eq!(npc.ai_state_u8(), 0);
        npc.memory.state = NpcState::Patrol;
        assert_eq!(npc.ai_state_u8(), 1);
        npc.memory.state = NpcState::Chase;
        assert_eq!(npc.ai_state_u8(), 2);
        npc.memory.state = NpcState::Attack;
        assert_eq!(npc.ai_state_u8(), 3);
        npc.memory.state = NpcState::Flee;
        assert_eq!(npc.ai_state_u8(), 4);
        npc.memory.state = NpcState::Dead;
        assert_eq!(npc.ai_state_u8(), 5);
    }

    #[test]
    fn hp_ratio_clamped() {
        let mut npc = Npc::new(NpcKind::Pirate, Vec3::ZERO);
        npc.hull_hp = 50.0;
        npc.hull_max = 100.0;
        assert!((npc.hp_ratio() - 0.5).abs() < 1e-6);
        npc.hull_hp = -10.0;
        assert_eq!(npc.hp_ratio(), 0.0);
        npc.hull_hp = 200.0;
        assert_eq!(npc.hp_ratio(), 1.0);
    }

    #[test]
    fn step_ai_updates_memory() {
        let mut npc = Npc::new(NpcKind::Pirate, Vec3::ZERO);
        // Inimigo muito perto → deve ir para Attack.
        step_npc_ai(
            &mut npc,
            Vec3::ZERO,
            Vec3::ZERO,
            Some(Vec3::new(100.0, 0.0, 0.0)),
            Some(Vec3::ZERO),
            1,
        );
        assert_eq!(npc.memory.state, NpcState::Attack);
    }

    #[test]
    fn build_npc_payload_uses_correct_kind() {
        let npc = Npc::new(NpcKind::Patrol, Vec3::ZERO);
        let payload = build_npc_payload(&npc);
        match payload {
            EntityPayload::Npc(p) => {
                assert_eq!(p.archetype, 2);
                assert_eq!(p.ai_state, 1); // Patrol
            }
            _ => panic!("esperado EntityPayload::Npc"),
        }
    }

    #[test]
    fn asteroid_kind_u8_mapping() {
        assert_eq!(asteroid_kind_to_u8(AsteroidKind::Rock), 0);
        assert_eq!(asteroid_kind_to_u8(AsteroidKind::Iron), 1);
        assert_eq!(asteroid_kind_to_u8(AsteroidKind::Gold), 2);
        assert_eq!(asteroid_kind_to_u8(AsteroidKind::DarkMatter), 3);
    }

    #[test]
    fn anomaly_kind_u8_mapping() {
        assert_eq!(anomaly_kind_to_u8(AnomalyKind::Warp), 0);
        assert_eq!(anomaly_kind_to_u8(AnomalyKind::Radiation), 1);
        assert_eq!(anomaly_kind_to_u8(AnomalyKind::GravityWell), 2);
    }

    #[test]
    fn conv_roundtrips_position() {
        let p = Position { x: 1.0, y: 2.0, z: 3.0 };
        let v = conv::pos_to_vec3(p);
        assert_eq!(v, Vec3::new(1.0, 2.0, 3.0));
        let p2 = conv::vec3_to_pos(v);
        assert_eq!(p, p2);
    }

    #[test]
    fn next_state_dead_is_terminal() {
        use sim_core::ai::next_state;
        let mut npc = Npc::new(NpcKind::Patrol, Vec3::ZERO);
        npc.memory.state = NpcState::Dead;
        let arch = npc.kind.archetype();
        let per = make_perception(Vec3::ZERO, Vec3::ZERO, None, None, 1);
        let next = next_state(&arch, &npc.memory, &per);
        assert_eq!(next, NpcState::Dead);
    }
}
