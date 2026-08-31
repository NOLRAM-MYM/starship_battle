//! Estado de simulação autoritativo.
//!
//! Para a Fase 2 MVP usamos estruturas próprias (Vec<Ship>, Vec<Projectile>) em vez
//! de bevy_ecs puro. Quando passarmos a 100 players e schedules complexas (Fase 3+),
//! migramos para `bevy_ecs` Schedule — a interface `step()` permanece estável.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::net::protocol::EntityKind;

/// ID autoritativo de uma entidade.
pub type EntityId = u32;

/// Componentes físicos.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f32, pub y: f32, pub z: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Velocity {
    pub x: f32, pub y: f32, pub z: f32,
}

/// Orientação em quaternion (x,y,z,w).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rotation {
    pub x: f32, pub y: f32, pub z: f32, pub w: f32,
}

impl Default for Rotation {
    fn default() -> Self { Self { x: 0.0, y: 0.0, z: 0.0, w: 1.0 } }
}

/// Estado de uma nave.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ship {
    pub owner_player_id: u32,
    pub name: String,
    pub thrust_input: f32,  // 0..=1
    pub steer_input: f32,   // -1..=1
    pub hull_hp: f32,
    pub hull_max: f32,
    pub thrust_capacity: f32, // aceleração máxima (m/s²)
    pub turn_rate: f32,       // rad/s
    pub drag: f32,            // coeficiente de arrasto linear
}

/// Estado de um projétil.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Projectile {
    pub owner_player_id: u32,
    pub damage: f32,
    pub ttl_remaining: f32, // segundos
}

/// Mundo de simulação.
#[derive(Debug, Default)]
pub struct World {
    pub tick: u64,
    pub elapsed: f32,
    pub ships: HashMap<EntityId, (Position, Velocity, Rotation, Ship)>,
    pub projectiles: HashMap<EntityId, (Position, Velocity, Projectile)>,
    next_id: EntityId,
}

impl World {
    pub fn new() -> Self {
        Self {
            next_id: 1, // 0 é reservado (invalid)
            ..Default::default()
        }
    }

    pub fn alloc_id(&mut self) -> EntityId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Avança a simulação em `dt` segundos (fixed timestep recomendado: 1/30).
    pub fn step(&mut self, dt: f32) {
        self.elapsed += dt;
        self.tick += 1;

        // Física de naves.
        let ship_ids: Vec<EntityId> = self.ships.keys().copied().collect();
        for id in ship_ids {
            let (pos, vel, rot, ship) = self.ships[&id].clone();
            // Yaw rotation based on steer input.
            let new_rot = rotate_y(&rot, ship.steer_input * ship.turn_rate * dt);
            // Thrust no eixo forward (local +Z → world +Z após rotação identity).
            let fwd = forward(&new_rot);
            let accel = ship.thrust_capacity * ship.thrust_input;
            let drag_factor = (1.0 - ship.drag * dt).max(0.0);
            let new_vel = Velocity {
                x: (vel.x + fwd[0] * accel * dt) * drag_factor,
                y: (vel.y + fwd[1] * accel * dt) * drag_factor,
                z: (vel.z + fwd[2] * accel * dt) * drag_factor,
            };
            let new_pos = Position {
                x: pos.x + new_vel.x * dt,
                y: pos.y + new_vel.y * dt,
                z: pos.z + new_vel.z * dt,
            };
            self.ships.insert(id, (new_pos, new_vel, new_rot, ship));
        }

        // Física de projéteis + TTL.
        let proj_ids: Vec<EntityId> = self.projectiles.keys().copied().collect();
        let mut to_remove = Vec::new();
        for id in proj_ids {
            let (pos, vel, mut proj) = self.projectiles.remove(&id).unwrap();
            proj.ttl_remaining -= dt;
            if proj.ttl_remaining <= 0.0 {
                to_remove.push(id);
                continue;
            }
            let new_pos = Position {
                x: pos.x + vel.x * dt,
                y: pos.y + vel.y * dt,
                z: pos.z + vel.z * dt,
            };
            self.projectiles.insert(id, (new_pos, vel, proj));
        }
        for id in to_remove {
            self.projectiles.remove(&id);
        }
    }

    /// Hash determinístico do estado (para testes de determinismo).
    pub fn state_hash(&self) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        self.tick.hash(&mut h);
        let mut ids: Vec<_> = self.ships.keys().collect();
        ids.sort();
        for id in ids {
            id.hash(&mut h);
            let (p, v, r, s) = &self.ships[id];
            pos_to_bits(*p).hash(&mut h);
            vel_to_bits(*v).hash(&mut h);
            rot_to_bits(*r).hash(&mut h);
            (s.hull_hp as u32).hash(&mut h);
        }
        h.finish()
    }
}

fn rotate_y(r: &Rotation, angle: f32) -> Rotation {
    // Quaternion * Vector(0, angle, 0) — half-angle para esquerda.
    let half = angle * 0.5;
    let (s, c) = half.sin_cos();
    Rotation {
        x: r.x * c + r.y * s,
        y: r.y * c - r.x * s,
        z: r.z * c + r.w * s,
        w: r.w * c - r.z * s,
    }
}

fn forward(r: &Rotation) -> [f32; 3] {
    // Para quaternion (0,0,0,1) (identity), forward = (0,0,1).
    // Fórmula geral: 2 * (q.x*q.z + q.w*q.y), 2*(q.y*q.z - q.w*q.x), 1 - 2*(q.x²+q.y²)
    [
        2.0 * (r.x * r.z + r.w * r.y),
        2.0 * (r.y * r.z - r.w * r.x),
        1.0 - 2.0 * (r.x * r.x + r.y * r.y),
    ]
}

fn pos_to_bits(p: Position) -> [u32; 3] { [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()] }
fn vel_to_bits(v: Velocity) -> [u32; 3] { [v.x.to_bits(), v.y.to_bits(), v.z.to_bits()] }
fn rot_to_bits(r: Rotation) -> [u32; 4] { [r.x.to_bits(), r.y.to_bits(), r.z.to_bits(), r.w.to_bits()] }

/// Gera o snapshot serializável para os clientes.
pub fn build_snapshot(world: &World) -> crate::net::protocol::SnapshotData {
    use crate::net::protocol::{EntityState, SnapshotData};
    let mut entities = Vec::with_capacity(world.ships.len() + world.projectiles.len());

    let mut ship_ids: Vec<_> = world.ships.keys().copied().collect();
    ship_ids.sort();
    for id in ship_ids {
        let (p, v, r, s) = &world.ships[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Ship,
            pos: [p.x, p.y, p.z],
            rot: [r.x, r.y, r.z, r.w],
            vel: [v.x, v.y, v.z],
            hp_ratio: Some(s.hull_hp / s.hull_max),
            display_name: Some(s.name.clone()),
        });
    }

    let mut proj_ids: Vec<_> = world.projectiles.keys().copied().collect();
    proj_ids.sort();
    for id in proj_ids {
        let (p, v, _) = &world.projectiles[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Projectile,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [v.x, v.y, v.z],
            hp_ratio: None,
            display_name: None,
        });
    }

    SnapshotData {
        tick: world.tick,
        server_time_ms: (world.elapsed * 1000.0) as u64,
        entities,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ship(w: &mut World, name: &str) -> EntityId {
        let id = w.alloc_id();
        w.ships.insert(id, (
            Position::default(),
            Velocity::default(),
            Rotation::default(),
            Ship {
                owner_player_id: 0,
                name: name.into(),
                thrust_input: 0.0,
                steer_input: 0.0,
                hull_hp: 100.0,
                hull_max: 100.0,
                thrust_capacity: 10.0,
                turn_rate: 1.0,
                drag: 0.1,
            },
        ));
        id
    }

    #[test]
    fn step_advances_tick() {
        let mut w = World::new();
        assert_eq!(w.tick, 0);
        w.step(1.0 / 30.0);
        assert_eq!(w.tick, 1);
    }

    #[test]
    fn thrust_moves_ship() {
        let mut w = World::new();
        let id = make_ship(&mut w, "alpha");
        let (_, _, _, ship) = w.ships.get(&id).unwrap();
        let mut ship = ship.clone();
        ship.thrust_input = 1.0;
        w.ships.get_mut(&id).unwrap().3 = ship;
        for _ in 0..30 { w.step(1.0/30.0); }
        let (p, _, _, _) = w.ships[&id];
        assert!(p.z > 0.0, "esperado movimento +Z, got p={p:?}");
    }

    #[test]
    fn determinism_two_runs_match() {
        fn run() -> u64 {
            let mut w = World::new();
            let id = make_ship(&mut w, "alpha");
            let mut ship = w.ships[&id].3.clone();
            ship.thrust_input = 0.5;
            ship.steer_input = 0.3;
            w.ships.get_mut(&id).unwrap().3 = ship;
            for _ in 0..60 { w.step(1.0/30.0); }
            w.state_hash()
        }
        let a = run();
        let b = run();
        assert_eq!(a, b, "state hash divergente: {a} vs {b}");
    }

    #[test]
    fn snapshot_contains_all_ships() {
        let mut w = World::new();
        make_ship(&mut w, "alpha");
        make_ship(&mut w, "bravo");
        let snap = build_snapshot(&w);
        assert_eq!(snap.entities.len(), 2);
    }
}
