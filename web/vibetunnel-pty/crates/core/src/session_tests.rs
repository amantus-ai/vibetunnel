#[cfg(test)]
mod tests {
    use crate::session::*;
    use chrono::{TimeZone, Utc};

    fn create_test_session(id: &str) -> SessionInfo {
        SessionInfo {
            id: id.to_string(),
            name: format!("Test Session {}", id),
            command: vec!["/bin/bash".to_string()],
            pid: Some(12345),
            created_at: Utc::now(),
            status: "running".to_string(),
            working_dir: "/home/user".to_string(),
            cols: 80,
            rows: 24,
            exit_code: None,
            title_mode: Some("static".to_string()),
            is_external_terminal: false,
        }
    }

    #[test]
    fn test_session_info_serialization() {
        let session = create_test_session("test-123");
        
        // Serialize to JSON
        let json = serde_json::to_string(&session).expect("Failed to serialize");
        
        // Check that camelCase is used
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"workingDir\""));
        assert!(json.contains("\"titleMode\""));
        assert!(json.contains("\"isExternalTerminal\""));
        assert!(json.contains("\"exitCode\""));
        
        // Deserialize back
        let deserialized: SessionInfo = serde_json::from_str(&json).expect("Failed to deserialize");
        
        assert_eq!(deserialized.id, session.id);
        assert_eq!(deserialized.name, session.name);
        assert_eq!(deserialized.command, session.command);
        assert_eq!(deserialized.pid, session.pid);
        assert_eq!(deserialized.status, session.status);
        assert_eq!(deserialized.working_dir, session.working_dir);
        assert_eq!(deserialized.cols, session.cols);
        assert_eq!(deserialized.rows, session.rows);
        assert_eq!(deserialized.exit_code, session.exit_code);
        assert_eq!(deserialized.title_mode, session.title_mode);
        assert_eq!(deserialized.is_external_terminal, session.is_external_terminal);
    }

    #[test]
    fn test_session_info_optional_fields() {
        let mut session = create_test_session("test-456");
        session.pid = None;
        session.exit_code = Some(0);
        session.title_mode = None;
        
        let json = serde_json::to_string(&session).expect("Failed to serialize");
        let deserialized: SessionInfo = serde_json::from_str(&json).expect("Failed to deserialize");
        
        assert_eq!(deserialized.pid, None);
        assert_eq!(deserialized.exit_code, Some(0));
        assert_eq!(deserialized.title_mode, None);
    }

    #[test]
    fn test_memory_session_store_create() {
        let mut store = MemorySessionStore::new();
        let session = create_test_session("create-test");
        
        let result = store.create_session(session.clone());
        assert!(result.is_ok());
        
        // Verify session was stored
        let retrieved = store.get_session("create-test");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, "create-test");
    }

    #[test]
    fn test_memory_session_store_get_nonexistent() {
        let store = MemorySessionStore::new();
        let result = store.get_session("nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_memory_session_store_update() {
        let mut store = MemorySessionStore::new();
        let mut session = create_test_session("update-test");
        
        // Create initial session
        store.create_session(session.clone()).expect("Failed to create");
        
        // Update session
        session.status = "exited".to_string();
        session.exit_code = Some(0);
        session.cols = 120;
        session.rows = 40;
        
        let result = store.update_session("update-test", session.clone());
        assert!(result.is_ok());
        
        // Verify updates
        let retrieved = store.get_session("update-test").unwrap();
        assert_eq!(retrieved.status, "exited");
        assert_eq!(retrieved.exit_code, Some(0));
        assert_eq!(retrieved.cols, 120);
        assert_eq!(retrieved.rows, 40);
    }

    #[test]
    fn test_memory_session_store_remove() {
        let mut store = MemorySessionStore::new();
        let session = create_test_session("remove-test");
        
        // Create session
        store.create_session(session.clone()).expect("Failed to create");
        
        // Verify it exists
        assert!(store.get_session("remove-test").is_some());
        
        // Remove session
        let removed = store.remove_session("remove-test");
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, "remove-test");
        
        // Verify it's gone
        assert!(store.get_session("remove-test").is_none());
    }

    #[test]
    fn test_memory_session_store_remove_nonexistent() {
        let mut store = MemorySessionStore::new();
        let removed = store.remove_session("nonexistent");
        assert!(removed.is_none());
    }

    #[test]
    fn test_memory_session_store_multiple_sessions() {
        let mut store = MemorySessionStore::new();
        
        // Create multiple sessions
        let sessions = vec![
            create_test_session("session-1"),
            create_test_session("session-2"),
            create_test_session("session-3"),
        ];
        
        for session in &sessions {
            store.create_session(session.clone()).expect("Failed to create");
        }
        
        // Verify all exist
        for session in &sessions {
            let retrieved = store.get_session(&session.id);
            assert!(retrieved.is_some());
            assert_eq!(retrieved.unwrap().id, session.id);
        }
        
        // Update one
        let mut updated = sessions[1].clone();
        updated.status = "stopped".to_string();
        store.update_session("session-2", updated).expect("Failed to update");
        
        // Remove one
        let removed = store.remove_session("session-1");
        assert!(removed.is_some());
        
        // Verify final state
        assert!(store.get_session("session-1").is_none());
        assert_eq!(store.get_session("session-2").unwrap().status, "stopped");
        assert_eq!(store.get_session("session-3").unwrap().status, "running");
    }

    #[test]
    fn test_session_info_with_specific_datetime() {
        let specific_time = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 45).unwrap();
        
        let mut session = create_test_session("time-test");
        session.created_at = specific_time;
        
        let json = serde_json::to_string(&session).expect("Failed to serialize");
        assert!(json.contains("2024-01-15"));
        
        let deserialized: SessionInfo = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.created_at, specific_time);
    }

    #[test]
    fn test_session_info_command_variations() {
        let test_cases = vec![
            vec!["bash".to_string()],
            vec!["zsh".to_string(), "-l".to_string()],
            vec!["python3".to_string(), "script.py".to_string(), "--arg".to_string()],
            vec![],  // Empty command
        ];
        
        for command in test_cases {
            let mut session = create_test_session("cmd-test");
            session.command = command.clone();
            
            let json = serde_json::to_string(&session).expect("Failed to serialize");
            let deserialized: SessionInfo = serde_json::from_str(&json).expect("Failed to deserialize");
            
            assert_eq!(deserialized.command, command);
        }
    }

    #[test]
    fn test_session_store_trait_implementation() {
        // This test ensures the trait is properly implemented
        fn use_session_store<S: SessionStore>(store: &mut S) {
            let session = create_test_session("trait-test");
            
            // All trait methods should work
            store.create_session(session.clone()).expect("Failed to create");
            let retrieved = store.get_session("trait-test");
            assert!(retrieved.is_some());
            
            let mut updated = session.clone();
            updated.status = "updated".to_string();
            store.update_session("trait-test", updated).expect("Failed to update");
            
            let removed = store.remove_session("trait-test");
            assert!(removed.is_some());
        }
        
        let mut store = MemorySessionStore::new();
        use_session_store(&mut store);
    }

    #[test]
    fn test_session_clone() {
        let original = create_test_session("clone-test");
        let cloned = original.clone();
        
        assert_eq!(cloned.id, original.id);
        assert_eq!(cloned.name, original.name);
        assert_eq!(cloned.command, original.command);
        assert_eq!(cloned.pid, original.pid);
        assert_eq!(cloned.status, original.status);
        assert_eq!(cloned.working_dir, original.working_dir);
        assert_eq!(cloned.cols, original.cols);
        assert_eq!(cloned.rows, original.rows);
        assert_eq!(cloned.exit_code, original.exit_code);
        assert_eq!(cloned.title_mode, original.title_mode);
        assert_eq!(cloned.is_external_terminal, original.is_external_terminal);
    }

    #[test]
    fn test_session_debug_format() {
        let session = create_test_session("debug-test");
        let debug_str = format!("{:?}", session);
        
        // Verify Debug trait includes key fields
        assert!(debug_str.contains("SessionInfo"));
        assert!(debug_str.contains("debug-test"));
        assert!(debug_str.contains("running"));
    }
}