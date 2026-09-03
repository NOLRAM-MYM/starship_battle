//! Definições de componentes de nave e ship loadout.

pub mod team;
pub mod torpedo;
pub mod training;
pub mod warp;
pub mod aim;
pub mod aim_assist;
pub mod consumables;
pub mod flight;
pub mod skills;
pub mod weapons;
pub mod builder;
pub mod template;

use serde::{Deserialize, Serialize};

/// Categorias de slot em uma nave.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SlotKind {
    /// Propulsão principal/secundária.
    Engine,
    /// Arma fixa ou turret.
    Weapon,
    /// Gerador de escudo.
    Shield,
    /// Sensores passivos/ativos.
    Sensor,
    /// Compartimento de carga (expansível).
    Cargo,
    /// Sistema de camuflagem (stealth).
    Stealth,
}

/// Posição de slot em uma nave (grid 3D simplificado).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SlotPos {
    /// Identificador único do slot dentro da nave.
    pub id: u16,
    /// Categoria aceita neste slot.
    pub kind: SlotKind,
}

/// Componente instanciado ocupando um slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentInstance {
    /// ID do template (ex.: "engine_mk3", "railgun_heavy").
    pub template_id: String,
    /// Slot da nave onde este componente é instalado.
    pub slot_id: u16,
    /// Tier (1..=5).
    pub tier: u8,
    /// Carga de upgrade aplicada (0..=100).
    pub upgrade_points: u16,
}

pub use builder::{build_ship, BuildError, ShipLoadout, ShipStats};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_kinds_are_distinct() {
        let kinds = [SlotKind::Engine, SlotKind::Weapon, SlotKind::Shield,
                     SlotKind::Sensor, SlotKind::Cargo, SlotKind::Stealth];
        for (i, a) in kinds.iter().enumerate() {
            for b in &kinds[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }
}
