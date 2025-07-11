use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;
use vibetunnel_pty_core::{SessionInfo, SessionStore};

/// File-based session store for CLI
pub struct FileSessionStore {
    control_dir: PathBuf,
    session_info: Option<SessionInfo>,
}

impl FileSessionStore {
    pub fn new(session_id: &str) -> Result<Self> {
        let base_dir = if let Ok(dir) = std::env::var("VIBETUNNEL_SESSIONS_DIR") {
            PathBuf::from(dir)
        } else {
            dirs::home_dir().context("Failed to get home directory")?.join(".vibetunnel")
        };

        let control_dir = base_dir.join("control").join(session_id);

        // Create directory
        fs::create_dir_all(&control_dir).context("Failed to create control directory")?;

        Ok(Self { control_dir, session_info: None })
    }

    pub fn socket_path(&self) -> PathBuf {
        self.control_dir.join("ipc.sock")
    }

    pub fn stdout_path(&self) -> PathBuf {
        self.control_dir.join("stdout")
    }

    pub fn stdin_path(&self) -> PathBuf {
        self.control_dir.join("stdin")
    }
}

impl SessionStore for FileSessionStore {
    fn create_session(&mut self, info: SessionInfo) -> Result<()> {
        let session_path = self.control_dir.join("session.json");
        let content = serde_json::to_string_pretty(&info)?;
        fs::write(&session_path, content).context("Failed to write session.json")?;

        // Store in memory as well
        self.session_info = Some(info);

        // Create empty files
        fs::write(self.stdout_path(), "").context("Failed to create stdout file")?;
        fs::write(self.stdin_path(), "").context("Failed to create stdin file")?;

        Ok(())
    }

    fn get_session(&self, id: &str) -> Option<&SessionInfo> {
        self.session_info.as_ref().filter(|s| s.id == id)
    }

    fn update_session(&mut self, _id: &str, info: SessionInfo) -> Result<()> {
        self.create_session(info)
    }

    fn remove_session(&mut self, id: &str) -> Option<SessionInfo> {
        if self.session_info.as_ref().map(|s| s.id == id).unwrap_or(false) {
            self.session_info.take()
        } else {
            None
        }
    }
}

/// Load session from file
pub fn load_session(session_id: &str) -> Result<(SessionInfo, FileSessionStore)> {
    let base_dir = if let Ok(dir) = std::env::var("VIBETUNNEL_SESSIONS_DIR") {
        PathBuf::from(dir)
    } else {
        dirs::home_dir().context("Failed to get home directory")?.join(".vibetunnel")
    };

    let control_dir = base_dir.join("control").join(session_id);
    let session_path = control_dir.join("session.json");

    let content = fs::read_to_string(&session_path).context("Failed to read session.json")?;
    let info: SessionInfo =
        serde_json::from_str(&content).context("Failed to parse session.json")?;

    let store = FileSessionStore { control_dir, session_info: Some(info.clone()) };

    Ok((info, store))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::TempDir;

    // Ensure tests that modify VIBETUNNEL_SESSIONS_DIR don't run concurrently
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    #[test]
    fn test_file_session_store_paths() -> Result<()> {
        let _guard = ENV_MUTEX.lock().unwrap();
        let temp_dir = TempDir::new()?;
        let original_dir = std::env::var("VIBETUNNEL_SESSIONS_DIR").ok();
        std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

        let result = (|| -> Result<()> {
            let store = FileSessionStore::new("test-session")?;

            let socket_path = store.socket_path();
            assert!(socket_path.to_string_lossy().contains("test-session"));
            assert!(socket_path.to_string_lossy().contains("ipc.sock"));

            let stdout_path = store.stdout_path();
            assert!(stdout_path.to_string_lossy().contains("stdout"));

            let stdin_path = store.stdin_path();
            assert!(stdin_path.to_string_lossy().contains("stdin"));

            Ok(())
        })();

        // Restore original env var
        match original_dir {
            Some(dir) => std::env::set_var("VIBETUNNEL_SESSIONS_DIR", dir),
            None => std::env::remove_var("VIBETUNNEL_SESSIONS_DIR"),
        }

        result
    }

    #[test]
    fn test_session_lifecycle() -> Result<()> {
        let _guard = ENV_MUTEX.lock().unwrap();
        let temp_dir = TempDir::new()?;
        let original_dir = std::env::var("VIBETUNNEL_SESSIONS_DIR").ok();
        std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

        let result = (|| -> Result<()> {
            let mut store = FileSessionStore::new("test-lifecycle")?;

            let session_info = SessionInfo {
                id: "test-lifecycle".to_string(),
                name: "test session".to_string(),
                command: vec!["echo".to_string(), "test".to_string()],
                pid: Some(9999),
                created_at: chrono::Utc::now(),
                status: "running".to_string(),
                working_dir: "/tmp".to_string(),
                cols: 80,
                rows: 24,
                exit_code: None,
                title_mode: Some("none".to_string()),
                is_external_terminal: true,
            };

            // Create session
            store.create_session(session_info.clone())?;

            // Verify files were created
            assert!(store.control_dir.join("session.json").exists());
            assert!(store.stdout_path().exists());
            assert!(store.stdin_path().exists());

            // Get session
            let retrieved = store.get_session("test-lifecycle");
            assert!(retrieved.is_some());
            assert_eq!(retrieved.unwrap().name, "test session");

            // Update session
            let mut updated_info = session_info.clone();
            updated_info.status = "completed".to_string();
            updated_info.exit_code = Some(0);
            store.update_session("test-lifecycle", updated_info)?;

            // Verify update
            let updated = store.get_session("test-lifecycle");
            assert!(updated.is_some());
            assert_eq!(updated.unwrap().status, "completed");

            // Remove session
            let removed = store.remove_session("test-lifecycle");
            assert!(removed.is_some());
            assert!(store.get_session("test-lifecycle").is_none());

            Ok(())
        })();

        // Restore original env var
        match original_dir {
            Some(dir) => std::env::set_var("VIBETUNNEL_SESSIONS_DIR", dir),
            None => std::env::remove_var("VIBETUNNEL_SESSIONS_DIR"),
        }

        result
    }

    #[test]
    fn test_load_session() -> Result<()> {
        let _guard = ENV_MUTEX.lock().unwrap();
        let temp_dir = TempDir::new()?;
        let original_dir = std::env::var("VIBETUNNEL_SESSIONS_DIR").ok();
        std::env::set_var("VIBETUNNEL_SESSIONS_DIR", temp_dir.path());

        let result = (|| -> Result<()> {
            // First create a session
            let mut store = FileSessionStore::new("test-load")?;
            let session_info = SessionInfo {
                id: "test-load".to_string(),
                name: "load test".to_string(),
                command: vec!["ls".to_string()],
                pid: Some(7777),
                created_at: chrono::Utc::now(),
                status: "running".to_string(),
                working_dir: "/home".to_string(),
                cols: 120,
                rows: 40,
                exit_code: None,
                title_mode: None,
                is_external_terminal: false,
            };

            store.create_session(session_info)?;

            // Ensure the file was created
            let session_file = store.control_dir.join("session.json");
            assert!(session_file.exists(), "Session file should exist at {:?}", session_file);

            // Load it back
            let (loaded_info, loaded_store) = load_session("test-load")?;

            assert_eq!(loaded_info.id, "test-load");
            assert_eq!(loaded_info.name, "load test");
            assert_eq!(loaded_info.pid, Some(7777));
            assert_eq!(loaded_info.cols, 120);

            // Verify loaded store works
            let retrieved = loaded_store.get_session("test-load");
            assert!(retrieved.is_some());

            Ok(())
        })();

        // Restore original env var
        match original_dir {
            Some(dir) => std::env::set_var("VIBETUNNEL_SESSIONS_DIR", dir),
            None => std::env::remove_var("VIBETUNNEL_SESSIONS_DIR"),
        }

        result
    }
}
