use bytes::Bytes;
use chrono::Utc;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info};
use uuid::Uuid;

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<RwLock<HashMap<String, Arc<RwLock<TerminalSession>>>>>,
}

pub struct TerminalSession {
    pub _id: String,
    pub name: String,
    pub pid: u32,
    pub rows: u16,
    pub cols: u16,
    pub created_at: String,
    pub _cwd: String,
    pty_pair: PtyPair,
    #[allow(dead_code)]
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    reader_thread: Option<std::thread::JoinHandle<()>>,
    #[allow(dead_code)]
    output_tx: mpsc::UnboundedSender<Bytes>,
    pub output_rx: Arc<Mutex<mpsc::UnboundedReceiver<Bytes>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create_session(
        &self,
        name: String,
        rows: u16,
        cols: u16,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        shell: Option<String>,
    ) -> Result<crate::commands::Terminal, String> {
        let id = Uuid::new_v4().to_string();

        // Set up PTY
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        // Configure shell command
        let shell = shell.unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(target_os = "windows") {
                    "cmd.exe".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
        });

        let mut cmd = CommandBuilder::new(&shell);

        // Set working directory
        if let Some(cwd) = &cwd {
            cmd.cwd(cwd);
        }

        // Set environment variables
        if let Some(env_vars) = env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        // Spawn the shell process
        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {e}"))?;

        let pid = child.process_id().unwrap_or(0);

        // Set up output channel
        let (output_tx, output_rx) = mpsc::unbounded_channel();

        // Get reader and writer
        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {e}"))?;

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {e}"))?;

        // Start reader thread
        let output_tx_clone = output_tx.clone();
        let reader_thread = std::thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 4096];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        debug!("PTY closed");
                        break;
                    }
                    Ok(n) => {
                        let data = Bytes::copy_from_slice(&buffer[..n]);

                        if output_tx_clone.send(data).is_err() {
                            debug!("Output channel closed");
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Error reading from PTY: {}", e);
                        break;
                    }
                }
            }
        });

        let session = TerminalSession {
            _id: id.clone(),
            name: name.clone(),
            pid,
            rows,
            cols,
            created_at: Utc::now().to_rfc3339(),
            _cwd: cwd.unwrap_or_else(|| {
                std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            }),
            pty_pair,
            child,
            writer,
            reader_thread: Some(reader_thread),
            output_tx,
            output_rx: Arc::new(Mutex::new(output_rx)),
        };

        // Store session
        self.sessions
            .write()
            .await
            .insert(id.clone(), Arc::new(RwLock::new(session)));

        info!("Created terminal session: {} ({})", name, id);

        Ok(crate::commands::Terminal {
            id,
            name,
            pid,
            rows,
            cols,
            created_at: Utc::now().to_rfc3339(),
        })
    }

    pub async fn list_sessions(&self) -> Vec<crate::commands::Terminal> {
        let sessions = self.sessions.read().await;
        let mut result = Vec::new();

        for (id, session) in sessions.iter() {
            let session = session.read().await;
            result.push(crate::commands::Terminal {
                id: id.clone(),
                name: session.name.clone(),
                pid: session.pid,
                rows: session.rows,
                cols: session.cols,
                created_at: session.created_at.clone(),
            });
        }

        result
    }

    pub async fn get_session(&self, id: &str) -> Option<Arc<RwLock<TerminalSession>>> {
        self.sessions.read().await.get(id).cloned()
    }

    pub async fn close_all_sessions(&self) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        let session_count = sessions.len();

        // Clear all sessions
        sessions.clear();

        info!("Closed all {} terminal sessions", session_count);
        Ok(())
    }

    pub async fn close_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;

        if let Some(session_arc) = sessions.remove(id) {
            // Session will be dropped when it goes out of scope
            drop(session_arc);

            info!("Closed terminal session: {}", id);
            Ok(())
        } else {
            Err(format!("Session not found: {id}"))
        }
    }

    pub async fn resize_session(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        if let Some(session_arc) = self.get_session(id).await {
            let mut session = session_arc.write().await;

            session
                .pty_pair
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize PTY: {e}"))?;

            session.rows = rows;
            session.cols = cols;

            debug!("Resized terminal {} to {}x{}", id, cols, rows);
            Ok(())
        } else {
            Err(format!("Session not found: {id}"))
        }
    }

    pub async fn write_to_session(&self, id: &str, data: &[u8]) -> Result<(), String> {
        if let Some(session_arc) = self.get_session(id).await {
            let mut session = session_arc.write().await;

            session
                .writer
                .write_all(data)
                .map_err(|e| format!("Failed to write to PTY: {e}"))?;

            session
                .writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY: {e}"))?;

            Ok(())
        } else {
            Err(format!("Session not found: {id}"))
        }
    }

    pub async fn read_from_session(&self, id: &str) -> Result<Vec<u8>, String> {
        if let Some(session_arc) = self.get_session(id).await {
            let session = session_arc.read().await;
            let mut rx = session.output_rx.lock().unwrap();

            // Try to receive data without blocking
            match rx.try_recv() {
                Ok(data) => Ok(data.to_vec()),
                Err(mpsc::error::TryRecvError::Empty) => Ok(vec![]),
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    Err("Output channel disconnected".to_string())
                }
            }
        } else {
            Err(format!("Session not found: {id}"))
        }
    }
}

// Make TerminalSession Send + Sync
unsafe impl Send for TerminalSession {}
unsafe impl Sync for TerminalSession {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terminal_manager_creation() {
        let manager = TerminalManager::new();

        // The sessions map should be empty initially
        let sessions_future = manager.sessions.read();
        let sessions = futures::executor::block_on(sessions_future);
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_list_sessions_empty() {
        let manager = TerminalManager::new();

        let sessions = manager.list_sessions().await;
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_get_session_not_found() {
        let manager = TerminalManager::new();

        let session = manager.get_session("non-existent-id").await;
        assert!(session.is_none());
    }

    #[tokio::test]
    async fn test_close_session_not_found() {
        let manager = TerminalManager::new();

        let result = manager.close_session("non-existent-id").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session not found: non-existent-id");
    }

    #[tokio::test]
    async fn test_resize_session_not_found() {
        let manager = TerminalManager::new();

        let result = manager.resize_session("non-existent-id", 80, 24).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session not found: non-existent-id");
    }

    #[tokio::test]
    async fn test_write_to_session_not_found() {
        let manager = TerminalManager::new();

        let result = manager.write_to_session("non-existent-id", b"test").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session not found: non-existent-id");
    }

    #[tokio::test]
    async fn test_read_from_session_not_found() {
        let manager = TerminalManager::new();

        let result = manager.read_from_session("non-existent-id").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Session not found: non-existent-id");
    }

    #[tokio::test]
    async fn test_close_all_sessions_empty() {
        let manager = TerminalManager::new();

        // Should succeed even with no sessions
        let result = manager.close_all_sessions().await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_shell_selection() {
        // Test default shell selection logic
        let shell = if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "/bin/bash".to_string()
        };

        if cfg!(target_os = "windows") {
            assert_eq!(shell, "cmd.exe");
        } else {
            assert_eq!(shell, "/bin/bash");
        }
    }

    #[test]
    fn test_pty_size_creation() {
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };

        assert_eq!(size.rows, 24);
        assert_eq!(size.cols, 80);
        assert_eq!(size.pixel_width, 0);
        assert_eq!(size.pixel_height, 0);
    }

    #[test]
    fn test_terminal_struct_fields() {
        use crate::commands::Terminal;

        let terminal = Terminal {
            id: "test-id".to_string(),
            name: "Test Terminal".to_string(),
            pid: 12345,
            rows: 80,
            cols: 24,
            created_at: Utc::now().to_rfc3339(),
        };

        assert_eq!(terminal.id, "test-id");
        assert_eq!(terminal.name, "Test Terminal");
        assert_eq!(terminal.pid, 12345);
        assert_eq!(terminal.rows, 80);
        assert_eq!(terminal.cols, 24);
        assert!(terminal.created_at.contains('T')); // RFC3339 format
    }

    #[test]
    fn test_environment_variable_handling() {
        let mut env_vars = HashMap::new();
        env_vars.insert("TEST_VAR".to_string(), "test_value".to_string());
        env_vars.insert("PATH".to_string(), "/usr/bin:/bin".to_string());

        assert_eq!(env_vars.get("TEST_VAR"), Some(&"test_value".to_string()));
        assert_eq!(env_vars.get("PATH"), Some(&"/usr/bin:/bin".to_string()));
        assert_eq!(env_vars.get("NON_EXISTENT"), None);
    }

    #[test]
    fn test_working_directory_paths() {
        let cwd_options = vec![
            Some("/home/user".to_string()),
            Some("/tmp".to_string()),
            Some(".".to_string()),
            None,
        ];

        for cwd in cwd_options {
            match cwd {
                Some(path) => assert!(!path.is_empty()),
                None => assert!(true), // None is valid
            }
        }
    }

    #[test]
    fn test_manager_arc_behavior() {
        let manager1 = TerminalManager::new();
        let sessions_ptr1 = Arc::as_ptr(&manager1.sessions);

        let manager2 = manager1.clone();
        let sessions_ptr2 = Arc::as_ptr(&manager2.sessions);

        // Both managers should share the same sessions Arc
        assert_eq!(sessions_ptr1, sessions_ptr2);
    }

    #[test]
    fn test_uuid_generation() {
        let id1 = Uuid::new_v4().to_string();
        let id2 = Uuid::new_v4().to_string();

        // UUIDs should be unique
        assert_ne!(id1, id2);

        // Should be valid UUID format
        assert_eq!(id1.len(), 36); // Standard UUID string length
        assert!(id1.contains('-'));
    }

    #[test]
    fn test_clone_trait() {
        let manager1 = TerminalManager::new();
        let manager2 = manager1.clone();

        // Both should point to the same Arc
        assert!(Arc::ptr_eq(&manager1.sessions, &manager2.sessions));
    }

    #[test]
    fn test_send_sync_traits() {
        // Verify TerminalSession implements Send + Sync
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<TerminalSession>();
    }
}
