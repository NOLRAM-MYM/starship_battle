//! sim-core: lógica de jogo compartilhada (servidor + WASM cliente).
//! Tudo que afeta regras/balance vive aqui para garantir paridade.

#![deny(unsafe_code)]
#![allow(missing_docs)]

pub mod ship;

pub use ship::*;
