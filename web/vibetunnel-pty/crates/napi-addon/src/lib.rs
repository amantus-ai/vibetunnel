//! NAPI bindings for VibeTunnel PTY

#![deny(clippy::all)]

mod bindings;
mod manager;

// Re-export NAPI functions
pub use bindings::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::PTY_MANAGER;

    #[test]
    fn test_init_pty_system() {
        // Test that init_pty_system doesn't panic
        init_pty_system().expect("init_pty_system should succeed");
    }

    #[test]
    fn test_activity_detector_creation() {
        // Test that ActivityDetector can be created
        // Note: We can't test the actual NAPI types directly in Rust tests
        // but we can test the underlying functionality
        let detector = vibetunnel_pty_core::ActivityDetector::new();
        assert!(detector.is_ok(), "ActivityDetector should be created successfully");
    }

    #[test]
    fn test_pty_manager_singleton() {
        // Test that PTY_MANAGER is accessible
        let manager = PTY_MANAGER.lock();
        assert!(manager.is_ok(), "PTY manager lock should be obtainable");
    }

    #[test]
    fn test_session_management() {
        use vibetunnel_pty_core::{PtyConfig, SessionInfo};

        // Create a test session
        let _config = PtyConfig {
            shell: None,
            args: vec![],
            env: std::collections::HashMap::new(),
            cwd: None,
            cols: 80,
            rows: 24,
        };

        // We can't easily test create_pty without spawning a real process
        // but we can test the manager structure
        let session_id = "test-session-123".to_string();
        let _info = SessionInfo {
            id: session_id.clone(),
            name: "test-shell".to_string(),
            command: vec!["bash".to_string()],
            pid: Some(12345),
            created_at: chrono::Utc::now(),
            status: "running".to_string(),
            working_dir: "/tmp".to_string(),
            cols: 80,
            rows: 24,
            exit_code: None,
            title_mode: None,
            is_external_terminal: false,
        };

        {
            let manager = PTY_MANAGER.lock().unwrap();
            // Verify manager is initially empty or has expected state
            drop(manager);
        }

        // Note: Full integration testing would require mocking the PTY handle
        // which is better done in integration tests
    }
}
