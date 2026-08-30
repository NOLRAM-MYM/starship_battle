//! Construtor de naves a partir de template + loadout de componentes.

use serde::{Deserialize, Serialize};

use super::template::{ComponentStats, ComponentTemplate, ShipTemplate};
use super::{ComponentInstance, SlotKind};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShipLoadout {
    pub ship_template_id: String,
    pub components: Vec<ComponentInstance>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum BuildError {
    #[error("slot {0} not found in template {1}")]
    SlotNotFound(u16, String),
    #[error("slot {0} expects {1:?}, got component for {2:?}")]
    SlotKindMismatch(u16, SlotKind, SlotKind),
    #[error("empty component id")]
    EmptyComponentId,
    #[error("unknown component template: {0}")]
    UnknownComponent(String),
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ShipStats {
    pub total_mass: f32,
    pub thrust: f32,
    pub shield_hp: f32,
    pub shield_regen: f32,
    pub damage: f32,
    pub sensor_range: f32,
    pub cargo_capacity: f32,
    pub stealth_rating: f32,
}

/// Resolve o loadout e devolve stats agregadas.
/// `resolve_component` é injetado para manter a função pura/testável.
pub fn build_ship<F>(
    template: &ShipTemplate,
    loadout: &ShipLoadout,
    mut resolve_component: F,
) -> Result<ShipStats, BuildError>
where
    F: FnMut(&str) -> Option<ComponentTemplate>,
{
    if loadout.components.iter().any(|c| c.template_id.is_empty()) {
        return Err(BuildError::EmptyComponentId);
    }

    let mut stats = ShipStats {
        total_mass: template.base_mass,
        cargo_capacity: template.base_cargo,
        ..Default::default()
    };

    for comp in &loadout.components {
        let ct = resolve_component(&comp.template_id)
            .ok_or_else(|| BuildError::UnknownComponent(comp.template_id.clone()))?;

        let slot = template
            .slots
            .iter()
            .find(|s| s.id == comp.slot_id)
            .ok_or_else(|| BuildError::SlotNotFound(comp.slot_id, template.id.clone()))?;

        if slot.kind != ct.kind {
            return Err(BuildError::SlotKindMismatch(slot.id, slot.kind, ct.kind));
        }

        stats.total_mass += ct.mass;
        merge_stats(&mut stats, &ct.stats);
    }

    Ok(stats)
}

fn merge_stats(out: &mut ShipStats, c: &ComponentStats) {
    out.thrust += c.thrust;
    out.shield_hp += c.shield_hp;
    out.shield_regen += c.shield_regen;
    out.damage += c.damage;
    out.sensor_range = out.sensor_range.max(c.sensor_range);
    out.cargo_capacity += c.cargo_capacity;
    out.stealth_rating = out.stealth_rating.max(c.stealth_rating);
}
