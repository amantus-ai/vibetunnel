//! Core functionality for VibeTunnel PTY
//!
//! This crate provides the shared functionality between the NAPI addon and CLI tool.

pub mod activity;
pub mod protocol;
pub mod pty;
pub mod session;

// Re-export commonly used types
pub use activity::{Activity, ActivityDetector};
pub use protocol::{decode_message, encode_message, MessageType};
pub use pty::{create_pty, resize_pty, PtyConfig, PtyHandle};
pub use session::{SessionInfo, SessionStore};

// Re-export portable-pty types that are part of our API
pub use portable_pty::{MasterPty, PtySize};
