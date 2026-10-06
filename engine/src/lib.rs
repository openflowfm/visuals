//! visual[flow]'s MilkDrop engine. See `docs/milkdrop-engine.md`.
//!
//! - [`preset`] reads a `.milk` file into its parts, keeping the text as written.
//! - [`shader`] turns a preset's warp and comp HLSL into a validated `naga` module.
//! - [`eel`] compiles and runs the equations.

pub mod eel;
pub mod preset;
pub mod shader;
