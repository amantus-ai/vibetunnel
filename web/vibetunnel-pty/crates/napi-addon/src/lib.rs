//! NAPI bindings for VibeTunnel PTY

#![deny(clippy::all)]

mod bindings;
mod manager;

// Re-export NAPI functions
pub use bindings::*;
