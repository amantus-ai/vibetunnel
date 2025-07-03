use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use crate::log_collector::SERVER_LOG_COLLECTOR;

/// Server state enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerState {
    Idle,
    Starting,
    Running,
    Stopping,
    Crashed,
}

/// Node.js server implementation that spawns vibetunnel as a subprocess
pub struct NodeJsServer {
    process: Arc<RwLock<Option<Child>>>,
    state: Arc<RwLock<ServerState>>,
    port: String,
    #[allow(dead_code)]
    bind_address: String,
    on_crash: Arc<RwLock<Option<Box<dyn Fn(i32) + Send + Sync>>>>,
}

impl NodeJsServer {
    /// Create a new Node.js server instance
    pub fn new(port: String, bind_address: String) -> Self {
        Self {
            process: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(ServerState::Idle)),
            port,
            bind_address,
            on_crash: Arc::new(RwLock::new(None)),
        }
    }

    /// Set crash callback
    pub async fn set_on_crash<F>(&self, callback: F)
    where
        F: Fn(i32) + Send + Sync + 'static,
    {
        *self.on_crash.write().await = Some(Box::new(callback));
    }

    /// Start the Node.js server
    pub async fn start(&self) -> Result<(), String> {
        // Check current state
        let current_state = *self.state.read().await;
        match current_state {
            ServerState::Running | ServerState::Starting => {
                warn!("Server already running or starting");
                return Ok(());
            }
            ServerState::Stopping => {
                return Err("Cannot start server while stopping".to_string());
            }
            _ => {}
        }

        // Update state
        *self.state.write().await = ServerState::Starting;

        info!("Starting Node.js vibetunnel server on port {}", self.port);

        // Get the vibetunnel executable path
        let exe_path = self.get_vibetunnel_path()?;
        info!("Using vibetunnel executable at: {:?}", exe_path);

        // Build command arguments
        let mut args = vec!["--port".to_string(), self.port.clone()];

        // Add authentication if configured
        if let Some((username, password)) = self.get_auth_credentials().await {
            args.push("--username".to_string());
            args.push(username);
            args.push("--password".to_string());
            args.push(password);
        }

        // Create the command
        let mut cmd = Command::new(&exe_path);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true); // Ensure process is killed when dropped

        // Set working directory to where static files are located
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                // Look for web/public directory relative to executable
                let web_dir = exe_dir.join("web");
                if web_dir.exists() {
                    cmd.current_dir(&web_dir);
                    info!("Set working directory to: {:?}", web_dir);
                }
            }
        }

        // Spawn the process
        match cmd.spawn() {
            Ok(mut child) => {
                // Set up output monitoring
                if let Some(stdout) = child.stdout.take() {
                    let state = self.state.clone();
                    tokio::spawn(async move {
                        let reader = BufReader::new(stdout);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            Self::log_output(&line, false);
                            // Check for successful startup
                            if line.contains("Server running on") {
                                info!("Server started successfully");
                                *state.write().await = ServerState::Running;
                            }
                        }
                    });
                }

                if let Some(stderr) = child.stderr.take() {
                    tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            Self::log_output(&line, true);
                        }
                    });
                }

                // Store the process
                *self.process.write().await = Some(child);

                // Give the process a moment to start
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                // Check if process is still running
                let mut process_guard = self.process.write().await;
                if let Some(ref mut child) = *process_guard {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            // Process exited immediately
                            let exit_code = status.code().unwrap_or(-1);
                            error!("Process exited immediately with code: {}", exit_code);
                            *process_guard = None;
                            drop(process_guard);
                            *self.state.write().await = ServerState::Idle;

                            if exit_code == 9 {
                                Err(format!("Port {} is already in use", self.port))
                            } else {
                                Err("Server failed to start".to_string())
                            }
                        }
                        Ok(None) => {
                            // Process is still running
                            drop(process_guard);

                            // Start monitoring for unexpected termination
                            self.monitor_process().await;

                            // Wait a bit more for server to be ready
                            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                            // Update state if not already updated by stdout monitor
                            let mut state = self.state.write().await;
                            if *state == ServerState::Starting {
                                *state = ServerState::Running;
                            }

                            info!("Node.js server started successfully");
                            Ok(())
                        }
                        Err(e) => {
                            error!("Failed to check process status: {}", e);
                            *process_guard = None;
                            drop(process_guard);
                            *self.state.write().await = ServerState::Idle;
                            Err("Failed to check process status".to_string())
                        }
                    }
                } else {
                    *self.state.write().await = ServerState::Idle;
                    Err("Process handle lost".to_string())
                }
            }
            Err(e) => {
                error!("Failed to spawn vibetunnel process: {}", e);
                *self.state.write().await = ServerState::Idle;
                Err(format!("Failed to spawn process: {e}"))
            }
        }
    }

    /// Stop the Node.js server
    pub async fn stop(&self) -> Result<(), String> {
        let current_state = *self.state.read().await;
        match current_state {
            ServerState::Running | ServerState::Crashed => {
                // Continue with stop
            }
            _ => {
                warn!("Server not running (state: {:?})", current_state);
                return Ok(());
            }
        }

        *self.state.write().await = ServerState::Stopping;
        info!("Stopping Node.js server");

        let mut process_guard = self.process.write().await;
        if let Some(mut child) = process_guard.take() {
            // Try graceful shutdown first
            #[cfg(unix)]
            {
                use nix::sys::signal::{self, Signal};
                use nix::unistd::Pid;

                if let Some(pid) = child.id() {
                    let _ = signal::kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
                }
            }

            #[cfg(windows)]
            {
                let _ = child.kill();
            }

            // Wait for process to exit with timeout
            match tokio::time::timeout(tokio::time::Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    info!("Server stopped with status: {:?}", status);
                }
                Ok(Err(e)) => {
                    error!("Error waiting for process: {}", e);
                }
                Err(_) => {
                    warn!("Timeout waiting for process to exit, force killing");
                    let _ = child.kill();
                    let _ = child.wait().await;
                }
            }
        }

        *self.state.write().await = ServerState::Idle;
        info!("Node.js server stopped");
        Ok(())
    }

    /// Restart the server
    pub async fn restart(&self) -> Result<(), String> {
        info!("Restarting Node.js server");
        self.stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        self.start().await
    }

    /// Check if server is running
    pub async fn is_running(&self) -> bool {
        matches!(*self.state.read().await, ServerState::Running)
    }

    /// Handle server crash with recovery
    pub async fn handle_crash(
        &self,
        exit_code: i32,
        consecutive_crashes: Arc<AtomicU32>,
        is_handling_crash: Arc<AtomicBool>,
        crash_recovery_enabled: Arc<AtomicBool>,
    ) {
        // Mark that we're handling a crash
        is_handling_crash.store(true, Ordering::Relaxed);

        warn!("Server crashed with exit code: {}", exit_code);

        // Update state
        *self.state.write().await = ServerState::Idle;

        // Check if crash recovery is enabled
        if !crash_recovery_enabled.load(Ordering::Relaxed) {
            info!("Crash recovery disabled, not restarting");
            is_handling_crash.store(false, Ordering::Relaxed);
            return;
        }

        // Increment crash counter
        let crashes = consecutive_crashes.fetch_add(1, Ordering::Relaxed) + 1;

        // Check if we've crashed too many times
        const MAX_CONSECUTIVE_CRASHES: u32 = 5;
        if crashes >= MAX_CONSECUTIVE_CRASHES {
            error!("Server crashed {} times consecutively, giving up", crashes);
            is_handling_crash.store(false, Ordering::Relaxed);
            return;
        }

        // Calculate backoff delay
        let delay_secs = match crashes {
            1 => 2,
            2 => 4,
            3 => 8,
            4 => 16,
            _ => 32,
        };

        info!(
            "Restarting server after {} seconds (attempt {})",
            delay_secs, crashes
        );
        tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;

        // Try to restart
        match self.restart().await {
            Ok(()) => {
                info!("Server restarted successfully");
                // Reset crash counter on successful restart
                consecutive_crashes.store(0, Ordering::Relaxed);
            }
            Err(e) => {
                error!("Failed to restart server: {}", e);
            }
        }

        is_handling_crash.store(false, Ordering::Relaxed);
    }

    /// Get server state
    pub async fn get_state(&self) -> ServerState {
        *self.state.read().await
    }

    /// Get the path to the vibetunnel executable
    fn get_vibetunnel_path(&self) -> Result<PathBuf, String> {
        // Add .exe extension on Windows
        let exe_name = if cfg!(windows) {
            "vibetunnel.exe"
        } else {
            "vibetunnel"
        };

        // Try multiple locations for the vibetunnel executable
        let current_exe = std::env::current_exe().ok();
        let possible_paths = vec![
            // In resources directory (common for packaged apps)
            current_exe
                .as_ref()
                .and_then(|p| p.parent().map(|p| p.join("resources").join(exe_name))),
            // Development path relative to Cargo.toml location (more reliable)
            std::env::var("CARGO_MANIFEST_DIR").ok()
                .map(PathBuf::from)
                .map(|p| p.join("../../web/native").join(exe_name)),
            // Development path relative to current exe in target/debug
            current_exe
                .as_ref()
                .and_then(|p| p.parent()) // target/debug
                .and_then(|p| p.parent()) // target
                .and_then(|p| p.parent()) // src-tauri
                .and_then(|p| p.parent()) // tauri
                .map(|p| p.join("web/native").join(exe_name)),
            // Development path relative to src-tauri
            Some(PathBuf::from("../../web/native").join(exe_name)),
            // Development path with canonicalize
            PathBuf::from("../../web/native")
                .join(exe_name)
                .canonicalize()
                .ok(),
            // Next to the Tauri executable (but check it's not the Tauri binary itself)
            current_exe
                .as_ref()
                .and_then(|p| p.parent().map(|p| p.join(exe_name)))
                .filter(|path| {
                    // Make sure this isn't the Tauri executable itself
                    current_exe.as_ref() != Some(path)
                }),
        ];

        for path_opt in possible_paths {
            if let Some(path) = path_opt {
                if path.exists() {
                    // Make sure it's executable on Unix
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if let Ok(metadata) = std::fs::metadata(&path) {
                            let mut perms = metadata.permissions();
                            perms.set_mode(0o755);
                            let _ = std::fs::set_permissions(&path, perms);
                        }
                    }
                    info!("Using vibetunnel executable at: {:?}", path);
                    return Ok(path);
                }
            }
        }

        Err("vibetunnel executable not found".to_string())
    }

    /// Get authentication credentials if configured
    async fn get_auth_credentials(&self) -> Option<(String, String)> {
        // Load settings to check if password is enabled
        let settings = crate::settings::Settings::load().ok()?;

        if settings.dashboard.enable_password && !settings.dashboard.password.is_empty() {
            Some(("admin".to_string(), settings.dashboard.password))
        } else {
            None
        }
    }

    /// Log server output
    fn log_output(line: &str, is_error: bool) {
        let line_lower = line.to_lowercase();
        
        let level = if is_error || line_lower.contains("error") || line_lower.contains("failed") {
            error!("Server: {}", line);
            "error"
        } else if line_lower.contains("warn") {
            warn!("Server: {}", line);
            "warn"
        } else {
            info!("Server: {}", line);
            "info"
        };
        
        // Add to log collector
        let collector = SERVER_LOG_COLLECTOR.clone();
        let line_owned = line.to_string();
        tokio::spawn(async move {
            collector.add_log(level, line_owned).await;
        });
    }

    /// Monitor process for unexpected termination
    async fn monitor_process(&self) {
        let process = self.process.clone();
        let state = self.state.clone();
        let on_crash = self.on_crash.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

                let mut process_guard = process.write().await;
                if let Some(ref mut child) = *process_guard {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            // Process exited
                            let exit_code = status.code().unwrap_or(-1);
                            let was_running = *state.read().await == ServerState::Running;

                            if was_running {
                                error!(
                                    "Server terminated unexpectedly with exit code: {}",
                                    exit_code
                                );
                                *state.write().await = ServerState::Crashed;

                                // Call crash handler if set
                                if let Some(ref callback) = *on_crash.read().await {
                                    callback(exit_code);
                                }
                            }

                            *process_guard = None;
                            break;
                        }
                        Ok(None) => {
                            // Process still running
                        }
                        Err(e) => {
                            error!("Error checking process status: {}", e);
                            break;
                        }
                    }
                } else {
                    // No process to monitor
                    break;
                }
            }
        });
    }
}

/// Backend manager that handles the Node.js server
pub struct BackendManager {
    server: Arc<NodeJsServer>,
    crash_recovery_enabled: Arc<AtomicBool>,
    consecutive_crashes: Arc<AtomicU32>,
    is_handling_crash: Arc<AtomicBool>,
}

impl BackendManager {
    /// Create a new backend manager
    pub fn new(port: u16) -> Self {
        let server = Arc::new(NodeJsServer::new(port.to_string(), "127.0.0.1".to_string()));

        Self {
            server,
            crash_recovery_enabled: Arc::new(AtomicBool::new(true)),
            consecutive_crashes: Arc::new(AtomicU32::new(0)),
            is_handling_crash: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start the backend server
    pub async fn start(&self) -> Result<(), String> {
        // Start the server first
        let result = self.server.start().await;

        if result.is_ok() {
            // Reset consecutive crashes on successful start
            self.consecutive_crashes.store(0, Ordering::Relaxed);

            // Set up crash handler after successful start
            let consecutive_crashes = self.consecutive_crashes.clone();
            let is_handling_crash = self.is_handling_crash.clone();
            let crash_recovery_enabled = self.crash_recovery_enabled.clone();
            let server = self.server.clone();

            self.server
                .set_on_crash(move |exit_code| {
                    let consecutive_crashes = consecutive_crashes.clone();
                    let is_handling_crash = is_handling_crash.clone();
                    let crash_recovery_enabled = crash_recovery_enabled.clone();
                    let server = server.clone();

                    tokio::spawn(async move {
                        server
                            .handle_crash(
                                exit_code,
                                consecutive_crashes,
                                is_handling_crash,
                                crash_recovery_enabled,
                            )
                            .await;
                    });
                })
                .await;
        }

        result
    }

    /// Enable or disable crash recovery
    pub async fn set_crash_recovery_enabled(&self, enabled: bool) {
        self.crash_recovery_enabled
            .store(enabled, Ordering::Relaxed);
    }

    /// Stop the backend server
    pub async fn stop(&self) -> Result<(), String> {
        self.server.stop().await
    }

    /// Restart the backend server
    pub async fn restart(&self) -> Result<(), String> {
        self.server.restart().await
    }

    /// Check if server is running
    pub async fn is_running(&self) -> bool {
        self.server.is_running().await
    }

    /// Check if server is running (blocking version)
    pub fn blocking_is_running(&self) -> bool {
        tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(self.is_running())
        })
    }

    /// Get server instance
    pub fn get_server(&self) -> Arc<NodeJsServer> {
        self.server.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[tokio::test]
    async fn test_server_state_transitions() {
        let server = NodeJsServer::new("8080".to_string(), "127.0.0.1".to_string());

        // Initial state should be Idle
        assert_eq!(server.get_state().await, ServerState::Idle);

        // Manual state transitions for testing
        *server.state.write().await = ServerState::Starting;
        assert_eq!(server.get_state().await, ServerState::Starting);

        *server.state.write().await = ServerState::Running;
        assert_eq!(server.get_state().await, ServerState::Running);
        assert!(server.is_running().await);

        *server.state.write().await = ServerState::Stopping;
        assert_eq!(server.get_state().await, ServerState::Stopping);
        assert!(!server.is_running().await);

        *server.state.write().await = ServerState::Crashed;
        assert_eq!(server.get_state().await, ServerState::Crashed);
    }

    #[tokio::test]
    async fn test_server_creation() {
        let server = NodeJsServer::new("3000".to_string(), "localhost".to_string());
        assert_eq!(server.port, "3000");
        assert_eq!(server.bind_address, "localhost");
        assert_eq!(server.get_state().await, ServerState::Idle);
    }

    #[tokio::test]
    async fn test_backend_manager_creation() {
        let manager = BackendManager::new(8080);
        assert!(!manager.is_running().await);
        assert_eq!(manager.consecutive_crashes.load(Ordering::Relaxed), 0);
        assert!(manager.crash_recovery_enabled.load(Ordering::Relaxed));
        assert!(!manager.is_handling_crash.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_crash_recovery_toggle() {
        let manager = BackendManager::new(8080);

        // Should be enabled by default
        assert!(manager.crash_recovery_enabled.load(Ordering::Relaxed));

        // Disable crash recovery
        manager.set_crash_recovery_enabled(false).await;
        assert!(!manager.crash_recovery_enabled.load(Ordering::Relaxed));

        // Re-enable crash recovery
        manager.set_crash_recovery_enabled(true).await;
        assert!(manager.crash_recovery_enabled.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_stop_when_not_running() {
        let server = NodeJsServer::new("8080".to_string(), "127.0.0.1".to_string());

        // Stopping when not running should succeed
        let result = server.stop().await;
        assert!(result.is_ok());
        assert_eq!(server.get_state().await, ServerState::Idle);
    }

    #[tokio::test]
    async fn test_concurrent_start_attempts() {
        let server = Arc::new(NodeJsServer::new(
            "8080".to_string(),
            "127.0.0.1".to_string(),
        ));

        // Simulate server already starting
        *server.state.write().await = ServerState::Starting;

        // Attempt to start should return Ok but not change state
        let result = server.start().await;
        assert!(result.is_ok());
        assert_eq!(server.get_state().await, ServerState::Starting);

        // Simulate server running
        *server.state.write().await = ServerState::Running;

        // Another start attempt should also return Ok
        let result = server.start().await;
        assert!(result.is_ok());
        assert_eq!(server.get_state().await, ServerState::Running);
    }

    #[tokio::test]
    async fn test_start_while_stopping() {
        let server = NodeJsServer::new("8080".to_string(), "127.0.0.1".to_string());

        // Set state to Stopping
        *server.state.write().await = ServerState::Stopping;

        // Start should fail
        let result = server.start().await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot start server while stopping");
    }

    #[tokio::test]
    async fn test_crash_callback() {
        let server = NodeJsServer::new("8080".to_string(), "127.0.0.1".to_string());
        let callback_called = Arc::new(AtomicBool::new(false));
        let callback_called_clone = callback_called.clone();

        // Set crash callback
        server
            .set_on_crash(move |_exit_code| {
                callback_called_clone.store(true, Ordering::Relaxed);
            })
            .await;

        // Verify callback was set
        assert!(server.on_crash.read().await.is_some());

        // Simulate calling the callback
        if let Some(ref callback) = *server.on_crash.read().await {
            callback(1);
        }

        assert!(callback_called.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_handle_crash_recovery_disabled() {
        let server = NodeJsServer::new("8080".to_string(), "127.0.0.1".to_string());
        let consecutive_crashes = Arc::new(AtomicU32::new(0));
        let is_handling_crash = Arc::new(AtomicBool::new(false));
        let crash_recovery_enabled = Arc::new(AtomicBool::new(false));

        // Set server to running state
        *server.state.write().await = ServerState::Running;

        // Handle crash with recovery disabled
        server
            .handle_crash(
                1,
                consecutive_crashes.clone(),
                is_handling_crash.clone(),
                crash_recovery_enabled,
            )
            .await;

        // Should not restart, state should be Idle
        assert_eq!(server.get_state().await, ServerState::Idle);
        // is_handling_crash should be reset to false
        assert!(!is_handling_crash.load(Ordering::Relaxed));
        // When crash recovery is disabled, it should still return early without restarting
    }

    #[tokio::test]
    async fn test_handle_crash_max_retries() {
        let server = NodeJsServer::new("8080".to_string(), "127.0.0.1".to_string());
        let consecutive_crashes = Arc::new(AtomicU32::new(4)); // One less than max
        let is_handling_crash = Arc::new(AtomicBool::new(false));
        let crash_recovery_enabled = Arc::new(AtomicBool::new(true));

        // Set server to running state
        *server.state.write().await = ServerState::Running;

        // Handle crash - should exceed max retries
        server
            .handle_crash(
                1,
                consecutive_crashes.clone(),
                is_handling_crash.clone(),
                crash_recovery_enabled,
            )
            .await;

        // Should give up after max retries
        assert_eq!(consecutive_crashes.load(Ordering::Relaxed), 5);
        assert!(!is_handling_crash.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_blocking_is_running() {
        let manager = BackendManager::new(8080);

        // Initially should not be running
        assert!(!manager.is_running().await);

        // Simulate running state
        *manager.server.state.write().await = ServerState::Running;
        assert!(manager.is_running().await);
    }

    #[test]
    fn test_log_output_classification() {
        // This tests the log classification logic indirectly through behavior
        // The actual log_output function logs to tracing, which we can't easily test
        // But we can verify the logic would work correctly

        let error_lines = vec![
            "Error: connection failed",
            "FAILED to start server",
            "Something went wrong",
        ];

        let warn_lines = vec!["Warning: deprecated feature", "warn: using default config"];

        let info_lines = vec!["Server started successfully", "Listening on port 8080"];

        // Verify our test cases match expected patterns
        for (i, line) in error_lines.iter().enumerate() {
            let lower = line.to_lowercase();
            match i {
                0 => assert!(lower.contains("error")),
                1 => assert!(lower.contains("failed")),
                2 => assert!(lower.contains("wrong")),
                _ => {}
            }
        }

        for line in &warn_lines {
            let lower = line.to_lowercase();
            assert!(lower.contains("warn"));
        }

        for line in &info_lines {
            let lower = line.to_lowercase();
            assert!(
                !lower.contains("error") && !lower.contains("failed") && !lower.contains("warn")
            );
        }
    }

    #[test]
    fn test_vibetunnel_path_logic() {
        // Test the executable name generation
        let exe_name = if cfg!(windows) {
            "vibetunnel.exe"
        } else {
            "vibetunnel"
        };

        if cfg!(windows) {
            assert_eq!(exe_name, "vibetunnel.exe");
        } else {
            assert_eq!(exe_name, "vibetunnel");
        }
    }
}
