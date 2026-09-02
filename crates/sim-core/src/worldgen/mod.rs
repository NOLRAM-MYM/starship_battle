//! Geração procedural determinística de mundo.
//!
//! Camadas:
//! - `seed`: PRNG seeded (Mulberry32) + helpers de hash determinístico.
//! - `noise`: value noise em 3D para campos de densidade.
//! - `asteroid`: posiciona asteroides com tamanhos e composições.
//! - `anomaly`: anomalias (warp, radiation, gravity well).
//! - `wreck`: destroços de naves com loot.
//! - `sector`: gera um setor completo combinando todos acima.
//!
//! Tudo é determinístico para a mesma seed → snapshots idênticos cliente/servidor.

pub mod anomaly;
pub mod celestial;
pub mod asteroid;
pub mod noise;
pub mod seed;
pub mod sector;
pub mod wreck;

pub use anomaly::*;
pub use asteroid::*;
pub use noise::*;
pub use seed::*;
pub use sector::*;
pub use wreck::*;

use crate::ai::Vec3;

/// Tipos de conteúdo procedural.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ContentKind {
    Asteroid,
    Anomaly,
    Wreck,
}

/// Trait comum: qualquer objeto procedural tem posição, raio e "tick nascido".
pub trait WorldObject {
    fn position(&self) -> Vec3;
    fn radius(&self) -> f32;
    fn kind(&self) -> ContentKind;
}
