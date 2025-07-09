#![deny(clippy::all)]

pub mod core;

#[cfg(feature = "napi")]
pub mod napi;

// Export NAPI bindings when building as Node addon
#[cfg(feature = "napi")]
pub use napi::bindings::*;