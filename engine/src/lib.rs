//! visual[flow]'s MilkDrop engine. See `docs/milkdrop-engine.md`.
//!
//! - [`preset`] reads a `.milk` file into its parts, keeping the text as written.
//! - [`shader`] turns a preset's warp and comp HLSL into a validated `naga` module.
//! - [`eel`] compiles and runs the equations.
//! - [`live`] is what a live player shares: the input ring and the window surface.

pub mod audio;
pub mod draw;
pub mod eel;
pub mod fx;
pub mod live;
pub mod noise;
pub mod picture;
pub mod preset;
pub mod render;
pub mod runtime;
pub mod shader;
