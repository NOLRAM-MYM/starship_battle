//! Máquina de Estados Finita (FSM) dos NPCs.
//!
//! Estados suportados:
//! - `Idle`     : parado, sem alvo. Pode escanhar ambiente.
//! - `Patrol`   : segue uma rota de waypoints.
//! - `Chase`    : persegue um alvo hostil (pred/pursue).
//! - `Attack`   : dentro do alcance de ataque, atira.
//! - `Flee`     : foge quando HP baixo ou ameaça poderosa.
//! - `Dead`     : estado terminal, NPC removido após `respawn_t`.
//!
//! Transições são puras: recebem o contexto (percepção + estado) e
//! decidem o próximo estado. Não mutam nada — o chamador aplica.
//!
//! O NPC é parametrizado por um `NpcArchetype` (agressividade, raiva, etc).

use super::behaviors::{arrive, flee, pursue};
use super::Vec3;

/// Arquétipo do NPC: define personalidade e thresholds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NpcArchetype {
    /// Velocidade máxima (m/s).
    pub max_speed: f32,
    /// Aceleração máxima (m/s²).
    pub max_accel: f32,
    /// Alcance do sensor (m) — além disso o NPC não vê.
    pub sensor_range: f32,
    /// Alcance da arma (m) — distância ideal para atirar.
    pub weapon_range: f32,
    /// HP em % (0..1). Abaixo disso, NPC foge.
    pub flee_hp_threshold: f32,
    /// Distância da chegada (m) ao waypoint para considerar "alcançado".
    pub waypoint_arrive_radius: f32,
}

impl Default for NpcArchetype {
    fn default() -> Self {
        Self {
            max_speed: 60.0,
            max_accel: 30.0,
            sensor_range: 800.0,
            weapon_range: 250.0,
            flee_hp_threshold: 0.25,
            waypoint_arrive_radius: 20.0,
        }
    }
}

/// Estado da FSM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NpcState {
    Idle,
    Patrol,
    Chase,
    Attack,
    Flee,
    Dead,
}

/// Memória mutável do NPC (atualizada a cada tick).
#[derive(Debug, Clone)]
pub struct NpcMemory {
    pub state: NpcState,
    /// Estado anterior (útil para transições que precisam reagir).
    pub prev_state: NpcState,
    /// Tick em que entrou no estado atual.
    pub state_entered_tick: u64,
    /// Índice do waypoint atual na rota de patrulha.
    pub patrol_index: usize,
    /// Ângulo de wander para behaviors::wander (estado).
    pub wander_angle: f32,
    /// HP em [0..1].
    pub hp_pct: f32,
}

impl NpcMemory {
    pub fn new(initial: NpcState, hp_pct: f32) -> Self {
        Self {
            state: initial,
            prev_state: initial,
            state_entered_tick: 0,
            patrol_index: 0,
            wander_angle: 0.0,
            hp_pct,
        }
    }

    pub fn transition(&mut self, next: NpcState, current_tick: u64) {
        if next != self.state {
            self.prev_state = self.state;
            self.state = next;
            self.state_entered_tick = current_tick;
        }
    }
}

/// Contexto de percepção passado a cada tick.
#[derive(Debug, Clone, Copy)]
pub struct Perception {
    pub self_pos: Vec3,
    pub self_vel: Vec3,
    /// Posição do alvo hostil mais próximo (None = nenhum detectado).
    pub enemy_pos: Option<Vec3>,
    /// Velocidade do alvo hostil (para predict).
    pub enemy_vel: Option<Vec3>,
    /// Distância ao waypoint atual (pre-computada pelo chamador).
    pub waypoint_dist: Option<f32>,
    /// Tick atual do servidor.
    pub current_tick: u64,
}

/// Decide o próximo estado baseado no contexto. NÃO muta `mem` (pura).
pub fn next_state(arch: &NpcArchetype, mem: &NpcMemory, per: &Perception) -> NpcState {
    // Dead é terminal.
    if mem.state == NpcState::Dead {
        return NpcState::Dead;
    }
    if mem.hp_pct <= 0.0 {
        return NpcState::Dead;
    }

    // HP baixo → fugir.
    if mem.hp_pct < arch.flee_hp_threshold {
        return NpcState::Flee;
    }

    // Há inimigo no sensor range?
    let enemy_visible = per
        .enemy_pos
        .zip(per.enemy_vel)
        .filter(|(pos, _)| per.self_pos.distance_squared(*pos) <= arch.sensor_range.powi(2));

    match (mem.state, enemy_visible) {
        (NpcState::Dead, _) => NpcState::Dead,
        (_, Some((epos, _evel))) => {
            let dist = per.self_pos.distance(epos);
            if dist <= arch.weapon_range {
                NpcState::Attack
            } else {
                NpcState::Chase
            }
        }
        // Fora de combate:
        (NpcState::Patrol, None) => NpcState::Patrol,
        (NpcState::Attack | NpcState::Chase, None) => {
            // Perdeu o alvo. Volta a patrulhar.
            NpcState::Patrol
        }
        (NpcState::Flee, None) => {
            // Recuperou-se, volta a patrulhar.
            NpcState::Patrol
        }
        (NpcState::Idle, None) => NpcState::Idle,
    }
}

/// Aplica a transição calculada a `mem`.
pub fn apply_transition(arch: &NpcArchetype, mem: &mut NpcMemory, per: &Perception) {
    let next = next_state(arch, mem, per);
    mem.transition(next, per.current_tick);
}

/// Calcula o vetor de steering (desejo) para o estado atual.
///
/// Retorna Vec3 que deve ser aplicado como `acceleration` (não velocidade).
pub fn steering_for_state(
    arch: &NpcArchetype,
    mem: &NpcMemory,
    per: &Perception,
    patrol_route: &[Vec3],
) -> Vec3 {
    match mem.state {
        NpcState::Idle => Vec3::ZERO,
        NpcState::Patrol => {
            if let Some(wp) = patrol_route.get(mem.patrol_index) {
                arrive(per.self_pos, per.self_vel, *wp, arch.max_speed, arch.waypoint_arrive_radius)
            } else {
                Vec3::ZERO
            }
        }
        NpcState::Chase => {
            if let (Some(epos), Some(evel)) = (per.enemy_pos, per.enemy_vel) {
                pursue(per.self_pos, per.self_vel, epos, evel, arch.max_speed, 0.5)
            } else {
                Vec3::ZERO
            }
        }
        NpcState::Attack => {
            // Pairar / orbitar o alvo. Para simplificar, fica parado e atira.
            Vec3::ZERO
        }
        NpcState::Flee => {
            if let (Some(epos), Some(evel)) = (per.enemy_pos, per.enemy_vel) {
                let away = flee(per.self_pos, per.self_vel, epos, arch.max_speed);
                // Combina com pursuit do safe-point: aqui, só foge.
                let _ = evel;
                away
            } else {
                Vec3::ZERO
            }
        }
        NpcState::Dead => Vec3::ZERO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn dead_state_is_terminal() {
        let arch = NpcArchetype::default();
        let mut mem = NpcMemory::new(NpcState::Dead, 0.0);
        let per = Perception {
            self_pos: Vec3::new(0.0, 0.0, 0.0),
            self_vel: Vec3::ZERO,
            enemy_pos: None,
            enemy_vel: None,
            waypoint_dist: None,
            current_tick: 0,
        };
        apply_transition(&arch, &mut mem, &per);
        assert_eq!(mem.state, NpcState::Dead);
    }

    #[test]
    fn zero_hp_transitions_to_dead() {
        let arch = NpcArchetype::default();
        let mut mem = NpcMemory::new(NpcState::Patrol, 0.0);
        let per = Perception {
            self_pos: Vec3::ZERO,
            self_vel: Vec3::ZERO,
            enemy_pos: None,
            enemy_vel: None,
            waypoint_dist: None,
            current_tick: 1,
        };
        apply_transition(&arch, &mut mem, &per);
        assert_eq!(mem.state, NpcState::Dead);
    }

    #[test]
    fn low_hp_transitions_to_flee() {
        let arch = NpcArchetype { flee_hp_threshold: 0.5, ..Default::default() };
        let mut mem = NpcMemory::new(NpcState::Patrol, 0.4);
        let per = Perception {
            self_pos: Vec3::ZERO,
            self_vel: Vec3::ZERO,
            enemy_pos: None,
            enemy_vel: None,
            waypoint_dist: None,
            current_tick: 1,
        };
        apply_transition(&arch, &mut mem, &per);
        assert_eq!(mem.state, NpcState::Flee);
    }

    #[test]
    fn enemy_in_range_chases_then_attacks() {
        let arch = NpcArchetype::default();
        // Perto o suficiente para Attack.
        let mut mem = NpcMemory::new(NpcState::Patrol, 1.0);
        let per = Perception {
            self_pos: Vec3::new(0.0, 0.0, 0.0),
            self_vel: Vec3::ZERO,
            enemy_pos: Some(Vec3::new(100.0, 0.0, 0.0)),
            enemy_vel: Some(Vec3::ZERO),
            waypoint_dist: None,
            current_tick: 1,
        };
        apply_transition(&arch, &mut mem, &per);
        assert_eq!(mem.state, NpcState::Attack);

        // Longe: Chase.
        let per2 = Perception {
            enemy_pos: Some(Vec3::new(500.0, 0.0, 0.0)),
            ..per
        };
        apply_transition(&arch, &mut mem, &per2);
        assert_eq!(mem.state, NpcState::Chase);
    }

    #[test]
    fn enemy_out_of_sensor_returns_to_patrol() {
        let arch = NpcArchetype { sensor_range: 100.0, ..Default::default() };
        let mut mem = NpcMemory::new(NpcState::Chase, 1.0);
        // Inimigo muito longe.
        let per = Perception {
            self_pos: Vec3::ZERO,
            self_vel: Vec3::ZERO,
            enemy_pos: Some(Vec3::new(5000.0, 0.0, 0.0)),
            enemy_vel: Some(Vec3::ZERO),
            waypoint_dist: None,
            current_tick: 1,
        };
        apply_transition(&arch, &mut mem, &per);
        assert_eq!(mem.state, NpcState::Patrol);
    }

    #[test]
    fn steering_for_patrol_returns_nonzero() {
        let arch = NpcArchetype::default();
        let mem = NpcMemory::new(NpcState::Patrol, 1.0);
        let per = Perception {
            self_pos: Vec3::ZERO,
            self_vel: Vec3::ZERO,
            enemy_pos: None,
            enemy_vel: None,
            waypoint_dist: None,
            current_tick: 0,
        };
        let route = vec![Vec3::new(100.0, 0.0, 0.0)];
        let s = steering_for_state(&arch, &mem, &per, &route);
        assert!(s.length() > 0.0);
    }

    #[test]
    fn memory_transition_increments_tick() {
        let mut mem = NpcMemory::new(NpcState::Idle, 1.0);
        mem.transition(NpcState::Patrol, 42);
        assert_eq!(mem.state, NpcState::Patrol);
        assert_eq!(mem.prev_state, NpcState::Idle);
        assert_eq!(mem.state_entered_tick, 42);
    }

    #[test]
    fn no_op_transition_keeps_state() {
        let mut mem = NpcMemory::new(NpcState::Patrol, 1.0);
        mem.state_entered_tick = 10;
        mem.transition(NpcState::Patrol, 99);
        assert_eq!(mem.state_entered_tick, 10);
    }

    #[test]
    fn archetype_default_has_sane_values() {
        let a = NpcArchetype::default();
        assert!(approx(a.max_speed, 60.0));
        assert!(a.flee_hp_threshold > 0.0 && a.flee_hp_threshold < 1.0);
    }
}
