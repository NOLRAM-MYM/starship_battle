//! sim-core: lógica de jogo compartilhada (servidor + WASM cliente).
//! Tudo que afeta regras/balance vive aqui para garantir paridade.

#![deny(unsafe_code)]
#![allow(missing_docs)]

pub mod ai;
pub mod ship;
pub mod skills;
pub mod worldgen;

pub use ai::*;
pub use ship::*;
pub use skills::*;
pub use worldgen::*;
