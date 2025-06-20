use tokio::sync::mpsc;
use std::sync::Arc;
use serde::{Deserialize, Serialize};

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
    terminal_integrations_manager: Arc<crate::terminal_integrations::TerminalIntegrationsManager>,
}

impl TerminalSpawnService {
    pub fn new(
        terminal_integrations_manager: Arc<crate::terminal_integrations::TerminalIntegrationsManager>,
    ) -> Self {
        let (tx, mut rx) = mpsc::channel::<TerminalSpawnRequest>(100);
        
        let manager_clone = terminal_integrations_manager.clone();
        
        // Spawn background worker to handle terminal spawn requests
        tokio::spawn(async move {
            while let Some(request) = rx.recv().await {
                let manager = manager_clone.clone();
                tokio::spawn(async move {
                    let _ = Self::handle_spawn_request(request, manager).await;
                });
            }
        });
        
        Self {
            request_tx: tx,
            terminal_integrations_manager,
        }
    }
    
    /// Queue a terminal spawn request
    pub async fn spawn_terminal(&self, request: TerminalSpawnRequest) -> Result<(), String> {
        self.request_tx.send(request).await
            .map_err(|e| format!("Failed to queue terminal spawn: {}", e))
    }
    
    /// Handle a spawn request
    async fn handle_spawn_request(
        request: TerminalSpawnRequest,
        terminal_integrations_manager: Arc<crate::terminal_integrations::TerminalIntegrationsManager>,
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
            working_directory: request.working_directory.map(|s| std::path::PathBuf::from(s)),
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
            let port = 4020; // Default port, should get from settings
            launch_options.command = Some(format!("vt connect localhost:{}/{}", port, request.session_id));
        }
        
        // Launch the terminal
        match terminal_integrations_manager.launch_terminal(Some(terminal_type), launch_options).await {
            Ok(_) => Ok(TerminalSpawnResponse {
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
    spawn_service.spawn_terminal_for_session(session_id, terminal_type).await
}

#[tauri::command]
pub async fn spawn_terminal_with_command(
    command: String,
    working_directory: Option<String>,
    terminal_type: Option<String>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let spawn_service = &state.terminal_spawn_service;
    spawn_service.spawn_terminal_with_command(command, working_directory, terminal_type).await
}

#[tauri::command]
pub async fn spawn_custom_terminal(
    request: TerminalSpawnRequest,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let spawn_service = &state.terminal_spawn_service;
    spawn_service.spawn_terminal(request).await
}