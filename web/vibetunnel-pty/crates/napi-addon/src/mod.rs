#[cfg(feature = "napi")]
pub mod bindings;
#[cfg(feature = "napi")]
pub mod manager;

#[cfg(feature = "napi")]
pub use bindings::{Activity, ActivityDetector, NativePty};
