#[cfg(feature = "napi")]
pub mod bindings;
#[cfg(feature = "napi")]
pub mod manager;

#[cfg(feature = "napi")]
pub use bindings::{NativePty, ActivityDetector, Activity};