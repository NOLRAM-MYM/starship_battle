//! Templates de componentes carregados de JSON (data-driven).

use serde::{Deserialize, Serialize};

use super::{SlotKind, SlotPos};

/// Definição de um tipo de componente (engine_mk3, railgun_heavy, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentTemplate {
    /// Identificador único.
    pub id: String,
    /// Nome exibido no UI.
    pub display_name: String,
    /// Categoria (define em que slot pode entrar).
    pub kind: SlotKind,
    /// Tier (1..=5).
    pub tier: u8,
    /// Massa adicionada (toneladas).
    pub mass: f32,
    /// Consumo de energia (MW).
    pub power_draw: f32,
    /// Stats específicos da categoria.
    pub stats: ComponentStats,
}

/// Stats produzidos por um componente. Todos default = 0 (não contribui).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ComponentStats {
    /// Empuxo (N).
    pub thrust: f32,
    /// HP total do escudo.
    pub shield_hp: f32,
    /// Regeneração de escudo (HP/s).
    pub shield_regen: f32,
    /// Dano base.
    pub damage: f32,
    /// Cadência (tiros/s).
    pub fire_rate: f32,
    /// Alcance (m).
    pub range: f32,
    /// Alcance do sensor (m).
    pub sensor_range: f32,
    /// Capacidade de carga (t).
    pub cargo_capacity: f32,
    /// Redução de signature (0..1).
    pub stealth_rating: f32,
}

/// Definição de uma nave (slots disponíveis).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipTemplate {
    /// Identificador único.
    pub id: String,
    /// Nome exibido no UI.
    pub display_name: String,
    /// Massa do casco vazio (t).
    pub base_mass: f32,
    /// Capacidade de carga base (t).
    pub base_cargo: f32,
    /// Slots disponíveis.
    pub slots: Vec<SlotPos>,
}
