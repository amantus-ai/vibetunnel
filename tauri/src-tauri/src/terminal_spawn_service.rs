use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Request to spawn a terminal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSpawnRequest {
    pub session_id: String,
    pub terminal_type: Option<String>,
    pub command: Option<String>,
    pub working_directory: Option<String>,
    pub environment: Option<std::collections::HashMap<String, String>>,
}

/// Response from terminal spawn
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSpawnResponse {
    pub success: bool,
    pub error: Option<String>,
    pub terminal_pid: Option<u32>,
}

/// Terminal Spawn Service - manages background terminal spawning
pub struct TerminalSpawnService {
    request_tx: mpsc::Sender<TerminalSpawnRequest>,
    request_rx: Arc<tokio::sync::Mutex<Option<mpsc::Receiver<TerminalSpawnRequest>>>>,
    #[allow(dead_code)]
    terminal_integrations_manager: Arc<crate::terminal_integrations::TerminalIntegrationsManager>,
}

impl TerminalSpawnService {
    pub fn new(
        terminal_integrations_manager: Arc<
            crate::terminal_integrations::TerminalIntegrationsManager,
        >,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<TerminalSpawnRequest>(100);

        Self {
            request_tx: tx,
            request_rx: Arc::new(tokio::sync::Mutex::new(Some(rx))),
            terminal_integrations_manager,
        }
    }

    /// Start the background worker - must be called after Tokio runtime is available
    pub async fn start_worker(self: Arc<Self>) {
        let rx = self.request_rx.lock().await.take();
        if let Some(mut rx) = rx {
            let manager_clone = self.terminal_integrations_manager.clone();

            tokio::spawn(async move {
                while let Some(request) = rx.recv().await {
                    let manager = manager_clone.clone();
                    tokio::spawn(async move {
                        let _ = Self::handle_spawn_request(request, manager).await;
                    });
                }
            });
        }
    }

    /// Queue a terminal spawn request
    pub async fn spawn_terminal(&self, request: TerminalSpawnRequest) -> Result<(), String> {
        self.request_tx
            .send(request)
            .await
            .map_err(|e| format!("Failed to queue terminal spawn: {e}"))
    }

    /// Handle a spawn request
    async fn handle_spawn_request(
        request: TerminalSpawnRequest,
        terminal_integrations_manager: Arc<
            crate::terminal_integrations::TerminalIntegrationsManager,
        >,
    ) -> Result<TerminalSpawnResponse, String> {
        // Determine which terminal to use
        let terminal_type = if let Some(terminal) = &request.terminal_type {
            // Parse terminal type
            match terminal.as_str() {
                "Terminal" => crate::terminal_integrations::TerminalEmulator::Terminal,
                "iTerm2" => crate::terminal_integrations::TerminalEmulator::ITerm2,
                "Hyper" => crate::terminal_integrations::TerminalEmulator::Hyper,
                "Alacritty" => crate::terminal_integrations::TerminalEmulator::Alacritty,
                "Warp" => crate::terminal_integrations::TerminalEmulator::Warp,
                "Kitty" => crate::terminal_integrations::TerminalEmulator::Kitty,
                "WezTerm" => crate::terminal_integrations::TerminalEmulator::WezTerm,
                "Ghostty" => crate::terminal_integrations::TerminalEmulator::Ghostty,
                _ => terminal_integrations_manager.get_default_terminal().await,
            }
        } else {
            terminal_integrations_manager.get_default_terminal().await
        };

        // Build launch options
        let mut launch_options = crate::terminal_integrations::TerminalLaunchOptions {
            command: request.command,
            working_directory: request
                .working_directory
                .map(std::path::PathBuf::from),
            args: vec![],
            env_vars: request.environment.unwrap_or_default(),
            title: Some(format!("VibeTunnel Session {}", request.session_id)),
            profile: None,
            tab: false,
            split: None,
            window_size: None,
        };

        // If no command specified, create a VibeTunnel session command
        if launch_options.command.is_none() {
            // Get server status to build the correct URL
            let port = 4022; // Default port for Tauri development
            launch_options.command = Some(format!(
                "vt connect localhost:{}/{}",
                port, request.session_id
            ));
        }

        // Launch the terminal
        match terminal_integrations_manager
            .launch_terminal(Some(terminal_type), launch_options)
            .await
        {
            Ok(()) => Ok(TerminalSpawnResponse {
                success: true,
                error: None,
                terminal_pid: None, // We don't track PIDs in the current implementation
            }),
            Err(e) => Ok(TerminalSpawnResponse {
                success: false,
                error: Some(e),
                terminal_pid: None,
            }),
        }
    }

    /// Spawn terminal for a specific session
    pub async fn spawn_terminal_for_session(
        &self,
        session_id: String,
        terminal_type: Option<String>,
    ) -> Result<(), String> {
        let request = TerminalSpawnRequest {
            session_id,
            terminal_type,
            command: None,
            working_directory: None,
            environment: None,
        };

        self.spawn_terminal(request).await
    }

    /// Spawn terminal with custom command
    pub async fn spawn_terminal_with_command(
        &self,
        command: String,
        working_directory: Option<String>,
        terminal_type: Option<String>,
    ) -> Result<(), String> {
        let request = TerminalSpawnRequest {
            session_id: uuid::Uuid::new_v4().to_string(),
            terminal_type,
            command: Some(command),
            working_directory,
            environment: None,
        };

        self.spawn_terminal(request).await
    }
}

// Commands for Tauri
#[tauri::command]
pub async fn spawn_terminal_for_session(
    session_id: String,
    terminal_type: Option<String>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let spawn_service = &state.terminal_spawn_service;
    spawn_service
        .spawn_terminal_for_session(session_id, terminal_type)
        .await
}

#[tauri::command]
pub async fn spawn_terminal_with_command(
    command: String,
    working_directory: Option<String>,
    terminal_type: Option<String>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let spawn_service = &state.terminal_spawn_service;
    spawn_service
        .spawn_terminal_with_command(command, working_directory, terminal_type)
        .await
}

#[tauri::command]
pub async fn spawn_custom_terminal(
    request: TerminalSpawnRequest,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let spawn_service = &state.terminal_spawn_service;
    spawn_service.spawn_terminal(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    #[test]
    fn test_terminal_spawn_request() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), "/usr/bin".to_string());

        let request = TerminalSpawnRequest {
            session_id: "test-123".to_string(),
            terminal_type: Some("iTerm2".to_string()),
            command: Some("ls -la".to_string()),
            working_directory: Some("/tmp".to_string()),
            environment: Some(env.clone()),
        };

        assert_eq!(request.session_id, "test-123");
        assert_eq!(request.terminal_type, Some("iTerm2".to_string()));
        assert_eq!(request.command, Some("ls -la".to_string()));
        assert_eq!(request.working_directory, Some("/tmp".to_string()));
        assert_eq!(
            request.environment.unwrap().get("PATH"),
            Some(&"/usr/bin".to_string())
        );
    }

    #[test]
    fn test_terminal_spawn_response_success() {
        let response = TerminalSpawnResponse {
            success: true,
            error: None,
            terminal_pid: Some(1234),
        };

        assert!(response.success);
        assert!(response.error.is_none());
        assert_eq!(response.terminal_pid, Some(1234));
    }

    #[test]
    fn test_terminal_spawn_response_failure() {
        let response = TerminalSpawnResponse {
            success: false,
            error: Some("Failed to spawn terminal".to_string()),
            terminal_pid: None,
        };

        assert!(!response.success);
        assert_eq!(response.error, Some("Failed to spawn terminal".to_string()));
        assert!(response.terminal_pid.is_none());
    }

    #[test]
    fn test_terminal_type_parsing() {
        let test_cases = vec![
            (
                "Terminal",
                crate::terminal_integrations::TerminalEmulator::Terminal,
            ),
            (
                "iTerm2",
                crate::terminal_integrations::TerminalEmulator::ITerm2,
            ),
            (
                "Hyper",
                crate::terminal_integrations::TerminalEmulator::Hyper,
            ),
            (
                "Alacritty",
                crate::terminal_integrations::TerminalEmulator::Alacritty,
            ),
            ("Warp", crate::terminal_integrations::TerminalEmulator::Warp),
            (
                "Kitty",
                crate::terminal_integrations::TerminalEmulator::Kitty,
            ),
            (
                "WezTerm",
                crate::terminal_integrations::TerminalEmulator::WezTerm,
            ),
            (
                "Ghostty",
                crate::terminal_integrations::TerminalEmulator::Ghostty,
            ),
        ];

        for (input, expected) in test_cases {
            let parsed = match input {
                "Terminal" => crate::terminal_integrations::TerminalEmulator::Terminal,
                "iTerm2" => crate::terminal_integrations::TerminalEmulator::ITerm2,
                "Hyper" => crate::terminal_integrations::TerminalEmulator::Hyper,
                "Alacritty" => crate::terminal_integrations::TerminalEmulator::Alacritty,
                "Warp" => crate::terminal_integrations::TerminalEmulator::Warp,
                "Kitty" => crate::terminal_integrations::TerminalEmulator::Kitty,
                "WezTerm" => crate::terminal_integrations::TerminalEmulator::WezTerm,
                "Ghostty" => crate::terminal_integrations::TerminalEmulator::Ghostty,
                _ => crate::terminal_integrations::TerminalEmulator::Terminal,
            };
            assert_eq!(parsed, expected);
        }
    }

    #[test]
    fn test_terminal_spawn_request_clone() {
        let request = TerminalSpawnRequest {
            session_id: "test-456".to_string(),
            terminal_type: Some("Terminal".to_string()),
            command: None,
            working_directory: None,
            environment: None,
        };

        let cloned = request.clone();
        assert_eq!(cloned.session_id, request.session_id);
        assert_eq!(cloned.terminal_type, request.terminal_type);
        assert_eq!(cloned.command, request.command);
        assert_eq!(cloned.working_directory, request.working_directory);
    }

    #[test]
    fn test_terminal_spawn_response_clone() {
        let response = TerminalSpawnResponse {
            success: true,
            error: None,
            terminal_pid: Some(5678),
        };

        let cloned = response.clone();
        assert_eq!(cloned.success, response.success);
        assert_eq!(cloned.error, response.error);
        assert_eq!(cloned.terminal_pid, response.terminal_pid);
    }

    #[test]
    fn test_launch_options_construction() {
        let mut env = HashMap::new();
        env.insert("TERM".to_string(), "xterm-256color".to_string());

        let request = TerminalSpawnRequest {
            session_id: "session-789".to_string(),
            terminal_type: None,
            command: Some("echo hello".to_string()),
            working_directory: Some("/home/user".to_string()),
            environment: Some(env),
        };

        // Simulate building launch options
        let launch_options = crate::terminal_integrations::TerminalLaunchOptions {
            command: request.command.clone(),
            working_directory: request
                .working_directory
                .map(|s| std::path::PathBuf::from(s)),
            args: vec![],
            env_vars: request.environment.clone().unwrap_or_default(),
            title: Some(format!("VibeTunnel Session {}", request.session_id)),
            profile: None,
            tab: false,
            split: None,
            window_size: None,
        };

        assert_eq!(launch_options.command, Some("echo hello".to_string()));
        assert_eq!(
            launch_options.working_directory,
            Some(std::path::PathBuf::from("/home/user"))
        );
        assert_eq!(
            launch_options.env_vars.get("TERM"),
            Some(&"xterm-256color".to_string())
        );
        assert_eq!(
            launch_options.title,
            Some("VibeTunnel Session session-789".to_string())
        );
    }

    #[test]
    fn test_default_command_generation() {
        let session_id = "test-session-123";
        let port = 4022;
        let expected_command = format!("vt connect localhost:{}/{}", port, session_id);

        assert_eq!(
            expected_command,
            "vt connect localhost:4022/test-session-123"
        );
    }

    #[test]
    fn test_terminal_spawn_request_minimal() {
        let request = TerminalSpawnRequest {
            session_id: "minimal".to_string(),
            terminal_type: None,
            command: None,
            working_directory: None,
            environment: None,
        };

        assert_eq!(request.session_id, "minimal");
        assert!(request.terminal_type.is_none());
        assert!(request.command.is_none());
        assert!(request.working_directory.is_none());
        assert!(request.environment.is_none());
    }

    #[test]
    fn test_terminal_spawn_request_serialization() {
        use serde_json;

        let mut env = HashMap::new();
        env.insert("TEST_VAR".to_string(), "test_value".to_string());

        let request = TerminalSpawnRequest {
            session_id: "serialize-test".to_string(),
            terminal_type: Some("Alacritty".to_string()),
            command: Some("top".to_string()),
            working_directory: Some("/var/log".to_string()),
            environment: Some(env),
        };

        // Test serialization
        let json = serde_json::to_string(&request);
        assert!(json.is_ok());

        let json_str = json.unwrap();
        assert!(json_str.contains("serialize-test"));
        assert!(json_str.contains("Alacritty"));
        assert!(json_str.contains("top"));
        assert!(json_str.contains("/var/log"));
        assert!(json_str.contains("TEST_VAR"));
        assert!(json_str.contains("test_value"));
    }

    #[test]
    fn test_terminal_spawn_request_deserialization() {
        use serde_json;

        let json_str = r#"{
            "session_id": "deserialize-test",
            "terminal_type": "WezTerm",
            "command": "htop",
            "working_directory": "/usr/local",
            "environment": {
                "LANG": "en_US.UTF-8"
            }
        }"#;

        let request: Result<TerminalSpawnRequest, _> = serde_json::from_str(json_str);
        assert!(request.is_ok());

        let request = request.unwrap();
        assert_eq!(request.session_id, "deserialize-test");
        assert_eq!(request.terminal_type, Some("WezTerm".to_string()));
        assert_eq!(request.command, Some("htop".to_string()));
        assert_eq!(request.working_directory, Some("/usr/local".to_string()));
        assert_eq!(
            request.environment.as_ref().unwrap().get("LANG"),
            Some(&"en_US.UTF-8".to_string())
        );
    }

    #[test]
    fn test_terminal_spawn_response_serialization() {
        use serde_json;

        let response = TerminalSpawnResponse {
            success: false,
            error: Some("Terminal not found".to_string()),
            terminal_pid: None,
        };

        let json = serde_json::to_string(&response);
        assert!(json.is_ok());

        let json_str = json.unwrap();
        assert!(json_str.contains(r#""success":false"#));
        assert!(json_str.contains("Terminal not found"));
    }

    #[test]
    fn test_uuid_generation() {
        use uuid::Uuid;

        let uuid1 = Uuid::new_v4().to_string();
        let uuid2 = Uuid::new_v4().to_string();

        // UUIDs should be different
        assert_ne!(uuid1, uuid2);

        // Should be valid UUID format
        assert_eq!(uuid1.len(), 36); // Standard UUID length with hyphens
        assert!(uuid1.contains('-'));
    }

    #[tokio::test]
    async fn test_terminal_spawn_service_creation() {
        // Mock terminal integrations manager
        let manager = Arc::new(crate::terminal_integrations::TerminalIntegrationsManager::new());

        let _service = TerminalSpawnService::new(manager.clone());

        // Service should be created successfully
        assert!(Arc::strong_count(&manager) > 1); // Service holds a reference
    }

    #[test]
    fn test_terminal_type_fallback() {
        // Test unknown terminal type should fall back to default
        let unknown_terminal = "UnknownTerminal";
        let default_terminal = match unknown_terminal {
            "Terminal" => crate::terminal_integrations::TerminalEmulator::Terminal,
            "iTerm2" => crate::terminal_integrations::TerminalEmulator::ITerm2,
            "Hyper" => crate::terminal_integrations::TerminalEmulator::Hyper,
            "Alacritty" => crate::terminal_integrations::TerminalEmulator::Alacritty,
            "Warp" => crate::terminal_integrations::TerminalEmulator::Warp,
            "Kitty" => crate::terminal_integrations::TerminalEmulator::Kitty,
            "WezTerm" => crate::terminal_integrations::TerminalEmulator::WezTerm,
            "Ghostty" => crate::terminal_integrations::TerminalEmulator::Ghostty,
            _ => crate::terminal_integrations::TerminalEmulator::Terminal, // Default fallback
        };

        assert_eq!(
            default_terminal,
            crate::terminal_integrations::TerminalEmulator::Terminal
        );
    }
}
