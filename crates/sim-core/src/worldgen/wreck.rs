//! Destroços de naves (wrecks) com loot.

use crate::ai::Vec3;

use super::seed::Rng;
use super::{ContentKind, WorldObject};

/// Tipos de loot possível.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LootKind {
    Credits,
    ModPart,
    Consumable,
    Rare,
}

impl LootKind {
    pub fn pick(rng: &mut Rng) -> Self {
        let r = rng.next_f32();
        if r < 0.5 {
            Self::Credits
        } else if r < 0.8 {
            Self::ModPart
        } else if r < 0.95 {
            Self::Consumable
        } else {
            Self::Rare
        }
    }
}

/// Entrada de loot num destroço.
#[derive(Debug, Clone, PartialEq)]
pub struct LootEntry {
    pub kind: LootKind,
    /// Quantidade ou item id (semântica depende do kind).
    pub amount: u32,
}

/// Destroço gerado.
#[derive(Debug, Clone, PartialEq)]
pub struct Wreck {
    pub position: Vec3,
    pub radius: f32,
    /// Identificador do template de nave original (pode ser "unknown" se não identificado).
    pub ship_template: String,
    /// Loot disponível (drops ao saquear).
    pub loot: Vec<LootEntry>,
    /// Tempo de vida em ticks (após o qual o wreck desaparece).
    pub ttl_ticks: u64,
}

impl Wreck {
    pub fn new(position: Vec3, radius: f32, ship_template: String, loot: Vec<LootEntry>, ttl_ticks: u64) -> Self {
        Self { position, radius, ship_template, loot, ttl_ticks }
    }
}

impl WorldObject for Wreck {
    fn position(&self) -> Vec3 { self.position }
    fn radius(&self) -> f32 { self.radius }
    fn kind(&self) -> ContentKind { ContentKind::Wreck }
}

/// Gera `count` wrecks espalhados em uma bounding box.
pub fn generate_wrecks(
    rng: &mut Rng,
    min: Vec3,
    max: Vec3,
    count: usize,
    ttl_ticks: u64,
) -> Vec<Wreck> {
    let templates = [
        "scout_basic",
        "fighter_mk1",
        "hauler_light",
        "explorer_v1",
        "pirate_skiff",
    ];
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let pos = Vec3::new(
            rng.range_f32(min.x, max.x),
            rng.range_f32(min.y, max.y),
            rng.range_f32(min.z, max.z),
        );
        let tpl = templates[rng.next_u32() as usize % templates.len()].to_string();
        let n_loot = rng.range_i32(1, 4) as usize;
        let mut loot = Vec::with_capacity(n_loot);
        for _ in 0..n_loot {
            let kind = LootKind::pick(rng);
            let amount = match kind {
                LootKind::Credits => rng.range_i32(20, 500) as u32,
                LootKind::ModPart => rng.range_i32(1, 3) as u32,
                LootKind::Consumable => rng.range_i32(1, 5) as u32,
                LootKind::Rare => 1,
            };
            loot.push(LootEntry { kind, amount });
        }
        out.push(Wreck::new(pos, rng.range_f32(8.0, 25.0), tpl, loot, ttl_ticks));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_wrecks_count() {
        let mut rng = Rng::new(1);
        let wrecks = generate_wrecks(
            &mut rng,
            Vec3::ZERO,
            Vec3::new(1000.0, 1000.0, 1000.0),
            10,
            5000,
        );
        assert_eq!(wrecks.len(), 10);
    }

    #[test]
    fn each_wreck_has_loot() {
        let mut rng = Rng::new(2);
        let wrecks = generate_wrecks(
            &mut rng,
            Vec3::ZERO,
            Vec3::new(500.0, 500.0, 500.0),
            5,
            1000,
        );
        for w in &wrecks {
            assert!(!w.loot.is_empty());
            assert!(w.ttl_ticks == 1000);
        }
    }

    #[test]
    fn wreck_within_bounds() {
        let mut rng = Rng::new(3);
        let min = Vec3::new(0.0, 0.0, 0.0);
        let max = Vec3::new(1000.0, 1000.0, 1000.0);
        let wrecks = generate_wrecks(&mut rng, min, max, 20, 100);
        for w in &wrecks {
            assert!(w.position.x >= min.x && w.position.x < max.x);
            assert!(w.position.y >= min.y && w.position.y < max.y);
            assert!(w.position.z >= min.z && w.position.z < max.z);
        }
    }

    #[test]
    fn deterministic_for_same_seed() {
        let mut a = Rng::new(99);
        let mut b = Rng::new(99);
        let ra = generate_wrecks(&mut a, Vec3::ZERO, Vec3::new(500.0, 500.0, 500.0), 6, 1000);
        let rb = generate_wrecks(&mut b, Vec3::ZERO, Vec3::new(500.0, 500.0, 500.0), 6, 1000);
        for (x, y) in ra.iter().zip(rb.iter()) {
            assert_eq!(x.position, y.position);
            assert_eq!(x.loot.len(), y.loot.len());
        }
    }

    #[test]
    fn world_object_trait() {
        let w = Wreck::new(
            Vec3::new(1.0, 2.0, 3.0),
            10.0,
            "test".to_string(),
            vec![LootEntry { kind: LootKind::Credits, amount: 100 }],
            1000,
        );
        assert_eq!(w.kind(), ContentKind::Wreck);
        assert_eq!(w.position(), Vec3::new(1.0, 2.0, 3.0));
        assert_eq!(w.radius(), 10.0);
    }
}
