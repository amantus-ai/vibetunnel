use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Manager, State};
use crate::server::HttpServer;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Terminal {
    pub id: String,
    pub name: String,
    pub pid: u32,
    pub rows: u16,
    pub cols: u16,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTerminalOptions {
    pub name: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub shell: Option<String>,
}

#[tauri::command]
pub async fn create_terminal(
    options: CreateTerminalOptions,
    state: State<'_, AppState>,
) -> Result<Terminal, String> {
    let terminal_manager = &state.terminal_manager;
    
    terminal_manager.create_session(
        options.name.unwrap_or_else(|| "Terminal".to_string()),
        options.rows.unwrap_or(24),
        options.cols.unwrap_or(80),
        options.cwd,
        options.env,
        options.shell,
    ).await
}

#[tauri::command]
pub async fn list_terminals(
    state: State<'_, AppState>,
) -> Result<Vec<Terminal>, String> {
    let terminal_manager = &state.terminal_manager;
    Ok(terminal_manager.list_sessions().await)
}

#[tauri::command]
pub async fn close_terminal(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_manager = &state.terminal_manager;
    terminal_manager.close_session(&id).await
}

#[tauri::command]
pub async fn resize_terminal(
    id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_manager = &state.terminal_manager;
    terminal_manager.resize_session(&id, rows, cols).await
}

#[tauri::command]
pub async fn write_to_terminal(
    id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_manager = &state.terminal_manager;
    terminal_manager.write_to_session(&id, &data).await
}

#[tauri::command]
pub async fn read_from_terminal(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let terminal_manager = &state.terminal_manager;
    terminal_manager.read_from_session(&id).await
}

#[tauri::command]
pub async fn start_server(
    state: State<'_, AppState>,
) -> Result<ServerStatus, String> {
    let mut server = state.http_server.write().await;
    
    if let Some(http_server) = server.as_ref() {
        // Get actual port from running server
        let port = http_server.port();
        
        // Check if ngrok is active
        let url = if let Some(ngrok_tunnel) = state.ngrok_manager.get_tunnel_status() {
            ngrok_tunnel.url
        } else {
            format!("http://localhost:{}", port)
        };
        
        return Ok(ServerStatus {
            running: true,
            port,
            url,
        });
    }
    
    // Load settings to check if password is enabled
    let settings = crate::settings::Settings::load().unwrap_or_default();
    
    // Start HTTP server with auth if configured
    let mut http_server = if settings.dashboard.enable_password && !settings.dashboard.password.is_empty() {
        let auth_config = crate::auth::AuthConfig::new(true, Some(settings.dashboard.password));
        HttpServer::with_auth(state.terminal_manager.clone(), state.session_monitor.clone(), auth_config)
    } else {
        HttpServer::new(state.terminal_manager.clone(), state.session_monitor.clone())
    };
    
    // Start server with appropriate access mode
    let (port, url) = match settings.dashboard.access_mode.as_str() {
        "network" => {
            let port = http_server.start_with_mode("network").await?;
            (port, format!("http://0.0.0.0:{}", port))
        },
        "ngrok" => {
            // For ngrok mode, start in localhost and let ngrok handle the tunneling
            let port = http_server.start_with_mode("localhost").await?;
            
            // Try to start ngrok tunnel if auth token is configured
            let url = if let Some(auth_token) = settings.advanced.ngrok_auth_token {
                if !auth_token.is_empty() {
                    match state.ngrok_manager.start_tunnel(port, Some(auth_token)).await {
                        Ok(tunnel) => tunnel.url,
                        Err(e) => {
                            tracing::error!("Failed to start ngrok tunnel: {}", e);
                            return Err(format!("Failed to start ngrok tunnel: {}", e));
                        }
                    }
                } else {
                    return Err("Ngrok auth token is required for ngrok access mode".to_string());
                }
            } else {
                return Err("Ngrok auth token is required for ngrok access mode".to_string());
            };
            
            (port, url)
        },
        _ => {
            let port = http_server.start_with_mode("localhost").await?;
            (port, format!("http://localhost:{}", port))
        }
    };
    
    *server = Some(http_server);
    
    Ok(ServerStatus {
        running: true,
        port,
        url,
    })
}

#[tauri::command]
pub async fn stop_server(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut server = state.http_server.write().await;
    
    if let Some(mut http_server) = server.take() {
        http_server.stop().await?;
    }
    
    // Also stop ngrok tunnel if active
    let _ = state.ngrok_manager.stop_tunnel().await;
    
    Ok(())
}

#[tauri::command]
pub async fn get_server_status(
    state: State<'_, AppState>,
) -> Result<ServerStatus, String> {
    let server = state.http_server.read().await;
    
    if let Some(http_server) = server.as_ref() {
        let port = http_server.port();
        
        // Check if ngrok is active and return its URL
        let url = if let Some(ngrok_tunnel) = state.ngrok_manager.get_tunnel_status() {
            ngrok_tunnel.url
        } else {
            // Check settings to determine the correct URL format
            let settings = crate::settings::Settings::load().unwrap_or_default();
            match settings.dashboard.access_mode.as_str() {
                "network" => format!("http://0.0.0.0:{}", port),
                _ => format!("http://localhost:{}", port),
            }
        };
        
        Ok(ServerStatus {
            running: true,
            port,
            url,
        })
    } else {
        Ok(ServerStatus {
            running: false,
            port: 0,
            url: String::new(),
        })
    }
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn restart_server(
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Stop the current server
    let mut server = state.http_server.write().await;
    
    if let Some(mut http_server) = server.take() {
        http_server.stop().await?;
    }
    
    // Wait a moment
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Start a new server
    let terminal_manager = state.terminal_manager.clone();
    let session_monitor = state.session_monitor.clone();
    let settings = crate::settings::Settings::load().unwrap_or_default();
    
    let mut new_server = HttpServer::new(terminal_manager, session_monitor);
    new_server.start_with_mode(match settings.dashboard.access_mode.as_str() {
        "network" => "network",
        _ => "localhost"
    }).await?;
    
    *server = Some(new_server);
    
    Ok(())
}

#[tauri::command]
pub async fn show_server_console(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Check if server console window already exists
    if let Some(window) = app_handle.get_webview_window("server-console") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create a new window for the server console
        tauri::WebviewWindowBuilder::new(
            &app_handle,
            "server-console",
            tauri::WebviewUrl::App("server-console.html".into())
        )
        .title("Server Console - VibeTunnel")
        .inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn show_welcome_screen(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.show_welcome_window().await
}

#[tauri::command]
pub async fn purge_all_settings(
    app_handle: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // Create default settings and save to clear the file
    let default_settings = crate::settings::Settings::default();
    default_settings.save().map_err(|e| e.to_string())?;
    
    // Quit the app after a short delay
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        app_handle.exit(0);
    });
    
    Ok(())
}

#[tauri::command]
pub async fn update_dock_icon_visibility(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let settings = crate::settings::Settings::load().unwrap_or_default();
        let has_visible_windows = app_handle.windows().values().any(|w| w.is_visible().unwrap_or(false));
        
        if has_visible_windows {
            // Always show dock icon when windows are visible
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
        } else if settings.general.show_dock_icon {
            // Show dock icon if setting is enabled
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
        } else {
            // Hide dock icon if setting is disabled and no windows are visible
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    Ok(())
}

// Terminal Recording Commands
#[derive(Debug, Serialize, Deserialize)]
pub struct StartRecordingOptions {
    pub session_id: String,
    pub title: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub duration: f64,
}

#[tauri::command]
pub async fn start_terminal_recording(
    options: StartRecordingOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cast_manager = &state.cast_manager;
    
    // Get terminal info for metadata
    let terminal_manager = &state.terminal_manager;
    let sessions = terminal_manager.list_sessions().await;
    let session = sessions.iter()
        .find(|s| s.id == options.session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    
    // Create recorder if it doesn't exist
    cast_manager.create_recorder(
        options.session_id.clone(),
        session.cols,
        session.rows,
        options.title.or(Some(session.name.clone())),
        None, // command
    ).await.ok(); // Ignore if already exists
    
    // Start recording
    if let Some(path) = options.output_path {
        cast_manager.start_recording(&options.session_id, path).await
    } else {
        // Use default path with timestamp
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let filename = format!("vibetunnel_recording_{}.cast", timestamp);
        let path = std::env::temp_dir().join(filename);
        cast_manager.start_recording(&options.session_id, path).await
    }
}

#[tauri::command]
pub async fn stop_terminal_recording(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cast_manager = &state.cast_manager;
    cast_manager.stop_recording(&session_id).await
}

#[tauri::command]
pub async fn save_terminal_recording(
    session_id: String,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cast_manager = &state.cast_manager;
    cast_manager.save_recording(&session_id, output_path).await
}

#[tauri::command]
pub async fn get_recording_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<RecordingStatus, String> {
    let cast_manager = &state.cast_manager;
    let is_recording = cast_manager.is_recording(&session_id).await;
    
    let duration = if let Some(recorder) = cast_manager.get_recorder(&session_id).await {
        let rec = recorder.lock().await;
        rec.get_duration().await
    } else {
        0.0
    };
    
    Ok(RecordingStatus {
        is_recording,
        duration,
    })
}

// TTY Forwarding Commands
#[derive(Debug, Serialize, Deserialize)]
pub struct StartTTYForwardOptions {
    pub local_port: u16,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub shell: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TTYForwardInfo {
    pub id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub connected: bool,
    pub client_count: usize,
}

#[tauri::command]
pub async fn start_tty_forward(
    options: StartTTYForwardOptions,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let tty_forward_manager = &state.tty_forward_manager;
    
    let remote_host = options.remote_host.unwrap_or_else(|| "localhost".to_string());
    let remote_port = options.remote_port.unwrap_or(22);
    
    tty_forward_manager.start_forward(
        options.local_port,
        remote_host,
        remote_port,
        options.shell,
    ).await
}

#[tauri::command]
pub async fn stop_tty_forward(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let tty_forward_manager = &state.tty_forward_manager;
    tty_forward_manager.stop_forward(&id).await
}

#[tauri::command]
pub async fn list_tty_forwards(
    state: State<'_, AppState>,
) -> Result<Vec<TTYForwardInfo>, String> {
    let tty_forward_manager = &state.tty_forward_manager;
    let forwards = tty_forward_manager.list_forwards().await;
    
    Ok(forwards.into_iter().map(|f| TTYForwardInfo {
        id: f.id,
        local_port: f.local_port,
        remote_host: f.remote_host,
        remote_port: f.remote_port,
        connected: f.connected,
        client_count: f.client_count,
    }).collect())
}

#[tauri::command]
pub async fn get_tty_forward(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<TTYForwardInfo>, String> {
    let tty_forward_manager = &state.tty_forward_manager;
    
    Ok(tty_forward_manager.get_forward(&id).await.map(|f| TTYForwardInfo {
        id: f.id,
        local_port: f.local_port,
        remote_host: f.remote_host,
        remote_port: f.remote_port,
        connected: f.connected,
        client_count: f.client_count,
    }))
}

// Session Monitoring Commands
#[tauri::command]
pub async fn get_session_stats(
    state: State<'_, AppState>,
) -> Result<crate::session_monitor::SessionStats, String> {
    let session_monitor = &state.session_monitor;
    Ok(session_monitor.get_stats().await)
}

#[tauri::command]
pub async fn get_monitored_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::session_monitor::SessionInfo>, String> {
    let session_monitor = &state.session_monitor;
    Ok(session_monitor.get_sessions().await)
}

#[tauri::command]
pub async fn start_session_monitoring(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_monitor = &state.session_monitor;
    session_monitor.start_monitoring().await;
    Ok(())
}

// Port Conflict Resolution Commands
#[tauri::command]
pub async fn check_port_availability(
    port: u16,
) -> Result<bool, String> {
    Ok(crate::port_conflict::PortConflictResolver::is_port_available(port).await)
}

#[tauri::command]
pub async fn detect_port_conflict(
    port: u16,
) -> Result<Option<crate::port_conflict::PortConflict>, String> {
    Ok(crate::port_conflict::PortConflictResolver::detect_conflict(port).await)
}

#[tauri::command]
pub async fn resolve_port_conflict(
    conflict: crate::port_conflict::PortConflict,
) -> Result<(), String> {
    crate::port_conflict::PortConflictResolver::resolve_conflict(&conflict).await
}

#[tauri::command]
pub async fn force_kill_process(
    conflict: crate::port_conflict::PortConflict,
) -> Result<(), String> {
    crate::port_conflict::PortConflictResolver::force_kill_process(&conflict).await
}

#[tauri::command]
pub async fn find_available_ports(
    near_port: u16,
    count: usize,
) -> Result<Vec<u16>, String> {
    let mut available_ports = Vec::new();
    let start = near_port.saturating_sub(10).max(1024);
    let end = near_port.saturating_add(100).min(65535);
    
    for port in start..=end {
        if port != near_port && crate::port_conflict::PortConflictResolver::is_port_available(port).await {
            available_ports.push(port);
            if available_ports.len() >= count {
                break;
            }
        }
    }
    
    Ok(available_ports)
}

// Network Utilities Commands
#[tauri::command]
pub async fn get_local_ip_address() -> Result<Option<String>, String> {
    Ok(crate::network_utils::NetworkUtils::get_local_ip_address())
}

#[tauri::command]
pub async fn get_all_ip_addresses() -> Result<Vec<String>, String> {
    Ok(crate::network_utils::NetworkUtils::get_all_ip_addresses())
}

#[tauri::command]
pub async fn get_network_interfaces() -> Result<Vec<crate::network_utils::NetworkInterface>, String> {
    Ok(crate::network_utils::NetworkUtils::get_all_interfaces())
}

#[tauri::command]
pub async fn get_hostname() -> Result<Option<String>, String> {
    Ok(crate::network_utils::NetworkUtils::get_hostname())
}

#[tauri::command]
pub async fn test_network_connectivity(
    host: String,
    port: u16,
) -> Result<bool, String> {
    Ok(crate::network_utils::NetworkUtils::test_connectivity(&host, port).await)
}

#[tauri::command]
pub async fn get_network_stats() -> Result<crate::network_utils::NetworkStats, String> {
    Ok(crate::network_utils::NetworkUtils::get_network_stats())
}

// Notification Commands
#[derive(Debug, Serialize, Deserialize)]
pub struct ShowNotificationOptions {
    pub notification_type: crate::notification_manager::NotificationType,
    pub priority: crate::notification_manager::NotificationPriority,
    pub title: String,
    pub body: String,
    pub actions: Vec<crate::notification_manager::NotificationAction>,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[tauri::command]
pub async fn show_notification(
    options: ShowNotificationOptions,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let notification_manager = &state.notification_manager;
    notification_manager.show_notification(
        options.notification_type,
        options.priority,
        options.title,
        options.body,
        options.actions,
        options.metadata,
    ).await
}

#[tauri::command]
pub async fn get_notifications(
    state: State<'_, AppState>,
) -> Result<Vec<crate::notification_manager::Notification>, String> {
    let notification_manager = &state.notification_manager;
    Ok(notification_manager.get_notifications().await)
}

#[tauri::command]
pub async fn get_notification_history(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::notification_manager::Notification>, String> {
    let notification_manager = &state.notification_manager;
    Ok(notification_manager.get_history(limit).await)
}

#[tauri::command]
pub async fn mark_notification_as_read(
    notification_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.mark_as_read(&notification_id).await
}

#[tauri::command]
pub async fn mark_all_notifications_as_read(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.mark_all_as_read().await
}

#[tauri::command]
pub async fn clear_notification(
    notification_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.clear_notification(&notification_id).await
}

#[tauri::command]
pub async fn clear_all_notifications(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.clear_all_notifications().await
}

#[tauri::command]
pub async fn get_unread_notification_count(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let notification_manager = &state.notification_manager;
    Ok(notification_manager.get_unread_count().await)
}

#[tauri::command]
pub async fn update_notification_settings(
    settings: crate::notification_manager::NotificationSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.update_settings(settings).await;
    Ok(())
}

#[tauri::command]
pub async fn get_notification_settings(
    state: State<'_, AppState>,
) -> Result<crate::notification_manager::NotificationSettings, String> {
    let notification_manager = &state.notification_manager;
    Ok(notification_manager.get_settings().await)
}

// Welcome/Tutorial Commands
#[tauri::command]
pub async fn get_welcome_state(
    state: State<'_, AppState>,
) -> Result<crate::welcome::WelcomeState, String> {
    let welcome_manager = &state.welcome_manager;
    Ok(welcome_manager.get_state().await)
}

#[tauri::command]
pub async fn should_show_welcome(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let welcome_manager = &state.welcome_manager;
    Ok(welcome_manager.should_show_welcome().await)
}

#[tauri::command]
pub async fn get_tutorials(
    state: State<'_, AppState>,
) -> Result<Vec<crate::welcome::TutorialCategory>, String> {
    let welcome_manager = &state.welcome_manager;
    Ok(welcome_manager.get_tutorials().await)
}

#[tauri::command]
pub async fn get_tutorial_category(
    category_id: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::welcome::TutorialCategory>, String> {
    let welcome_manager = &state.welcome_manager;
    Ok(welcome_manager.get_tutorial_category(&category_id).await)
}

#[tauri::command]
pub async fn complete_tutorial_step(
    step_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.complete_step(&step_id).await
}

#[tauri::command]
pub async fn skip_tutorial(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.skip_tutorial().await
}

#[tauri::command]
pub async fn reset_tutorial(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.reset_tutorial().await
}

#[tauri::command]
pub async fn get_tutorial_progress(
    state: State<'_, AppState>,
) -> Result<crate::welcome::TutorialProgress, String> {
    let welcome_manager = &state.welcome_manager;
    Ok(welcome_manager.get_progress().await)
}

#[tauri::command]
pub async fn show_welcome_window(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.show_welcome_window().await
}

// Advanced Settings Commands
#[tauri::command]
pub async fn get_recording_settings() -> Result<crate::settings::RecordingSettings, String> {
    let settings = crate::settings::Settings::load().unwrap_or_default();
    Ok(settings.recording.unwrap_or(crate::settings::RecordingSettings {
        enabled: true,
        output_directory: None,
        format: "asciinema".to_string(),
        include_timing: true,
        compress_output: false,
        max_file_size_mb: Some(100),
        auto_save: false,
        filename_template: Some("vibetunnel_%Y%m%d_%H%M%S".to_string()),
    }))
}

#[tauri::command]
pub async fn save_recording_settings(
    recording: crate::settings::RecordingSettings,
) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.recording = Some(recording);
    settings.save()
}

#[tauri::command]
pub async fn get_all_advanced_settings() -> Result<HashMap<String, serde_json::Value>, String> {
    let settings = crate::settings::Settings::load().unwrap_or_default();
    let mut all_settings = HashMap::new();
    
    // Convert all settings sections to JSON values
    all_settings.insert("recording".to_string(), 
        serde_json::to_value(&settings.recording).unwrap_or(serde_json::Value::Null));
    all_settings.insert("tty_forward".to_string(), 
        serde_json::to_value(&settings.tty_forward).unwrap_or(serde_json::Value::Null));
    all_settings.insert("monitoring".to_string(), 
        serde_json::to_value(&settings.monitoring).unwrap_or(serde_json::Value::Null));
    all_settings.insert("network".to_string(), 
        serde_json::to_value(&settings.network).unwrap_or(serde_json::Value::Null));
    all_settings.insert("port".to_string(), 
        serde_json::to_value(&settings.port).unwrap_or(serde_json::Value::Null));
    all_settings.insert("notifications".to_string(), 
        serde_json::to_value(&settings.notifications).unwrap_or(serde_json::Value::Null));
    all_settings.insert("terminal_integrations".to_string(), 
        serde_json::to_value(&settings.terminal_integrations).unwrap_or(serde_json::Value::Null));
    all_settings.insert("updates".to_string(), 
        serde_json::to_value(&settings.updates).unwrap_or(serde_json::Value::Null));
    all_settings.insert("security".to_string(), 
        serde_json::to_value(&settings.security).unwrap_or(serde_json::Value::Null));
    all_settings.insert("debug".to_string(), 
        serde_json::to_value(&settings.debug).unwrap_or(serde_json::Value::Null));
    
    Ok(all_settings)
}

#[tauri::command]
pub async fn update_advanced_settings(
    section: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    
    match section.as_str() {
        "recording" => {
            settings.recording = serde_json::from_value(value)
                .map_err(|e| format!("Invalid recording settings: {}", e))?;
        }
        "tty_forward" => {
            settings.tty_forward = serde_json::from_value(value)
                .map_err(|e| format!("Invalid TTY forward settings: {}", e))?;
        }
        "monitoring" => {
            settings.monitoring = serde_json::from_value(value)
                .map_err(|e| format!("Invalid monitoring settings: {}", e))?;
        }
        "network" => {
            settings.network = serde_json::from_value(value)
                .map_err(|e| format!("Invalid network settings: {}", e))?;
        }
        "port" => {
            settings.port = serde_json::from_value(value)
                .map_err(|e| format!("Invalid port settings: {}", e))?;
        }
        "notifications" => {
            settings.notifications = serde_json::from_value(value)
                .map_err(|e| format!("Invalid notification settings: {}", e))?;
        }
        "terminal_integrations" => {
            settings.terminal_integrations = serde_json::from_value(value)
                .map_err(|e| format!("Invalid terminal integration settings: {}", e))?;
        }
        "updates" => {
            settings.updates = serde_json::from_value(value)
                .map_err(|e| format!("Invalid update settings: {}", e))?;
        }
        "security" => {
            settings.security = serde_json::from_value(value)
                .map_err(|e| format!("Invalid security settings: {}", e))?;
        }
        "debug" => {
            settings.debug = serde_json::from_value(value)
                .map_err(|e| format!("Invalid debug settings: {}", e))?;
        }
        _ => return Err(format!("Unknown settings section: {}", section)),
    }
    
    settings.save()
}

#[tauri::command]
pub async fn reset_settings_section(section: String) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    let defaults = crate::settings::Settings::default();
    
    match section.as_str() {
        "recording" => settings.recording = defaults.recording,
        "tty_forward" => settings.tty_forward = defaults.tty_forward,
        "monitoring" => settings.monitoring = defaults.monitoring,
        "network" => settings.network = defaults.network,
        "port" => settings.port = defaults.port,
        "notifications" => settings.notifications = defaults.notifications,
        "terminal_integrations" => settings.terminal_integrations = defaults.terminal_integrations,
        "updates" => settings.updates = defaults.updates,
        "security" => settings.security = defaults.security,
        "debug" => settings.debug = defaults.debug,
        "all" => settings = defaults,
        _ => return Err(format!("Unknown settings section: {}", section)),
    }
    
    settings.save()
}

#[tauri::command]
pub async fn export_settings() -> Result<String, String> {
    let settings = crate::settings::Settings::load().unwrap_or_default();
    toml::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to export settings: {}", e))
}

#[tauri::command]
pub async fn import_settings(toml_content: String) -> Result<(), String> {
    let settings: crate::settings::Settings = toml::from_str(&toml_content)
        .map_err(|e| format!("Failed to parse settings: {}", e))?;
    settings.save()
}

// Permissions Commands
#[tauri::command]
pub async fn check_all_permissions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::permissions::PermissionInfo>, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.check_all_permissions().await)
}

#[tauri::command]
pub async fn check_permission(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<crate::permissions::PermissionStatus, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.check_permission(permission_type).await)
}

#[tauri::command]
pub async fn request_permission(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<crate::permissions::PermissionRequestResult, String> {
    let permissions_manager = &state.permissions_manager;
    permissions_manager.request_permission(permission_type).await
}

#[tauri::command]
pub async fn get_permission_info(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<Option<crate::permissions::PermissionInfo>, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.get_permission_info(permission_type).await)
}

#[tauri::command]
pub async fn get_all_permissions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::permissions::PermissionInfo>, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.get_all_permissions().await)
}

#[tauri::command]
pub async fn get_required_permissions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::permissions::PermissionInfo>, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.get_required_permissions().await)
}

#[tauri::command]
pub async fn get_missing_required_permissions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::permissions::PermissionInfo>, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.get_missing_required_permissions().await)
}

#[tauri::command]
pub async fn all_required_permissions_granted(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.all_required_permissions_granted().await)
}

#[tauri::command]
pub async fn open_system_permission_settings(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let permissions_manager = &state.permissions_manager;
    permissions_manager.open_system_settings(permission_type).await
}

#[tauri::command]
pub async fn get_permission_stats(
    state: State<'_, AppState>,
) -> Result<crate::permissions::PermissionStats, String> {
    let permissions_manager = &state.permissions_manager;
    let all_permissions = permissions_manager.get_all_permissions().await;
    
    let stats = crate::permissions::PermissionStats {
        total_permissions: all_permissions.len(),
        granted_permissions: all_permissions.iter().filter(|p| p.status == crate::permissions::PermissionStatus::Granted).count(),
        denied_permissions: all_permissions.iter().filter(|p| p.status == crate::permissions::PermissionStatus::Denied).count(),
        required_permissions: all_permissions.iter().filter(|p| p.required).count(),
        missing_required: all_permissions.iter().filter(|p| p.required && p.status != crate::permissions::PermissionStatus::Granted).count(),
        platform: std::env::consts::OS.to_string(),
    };
    
    Ok(stats)
}

// Update Manager Commands
#[tauri::command]
pub async fn check_for_updates(
    state: State<'_, AppState>,
) -> Result<Option<crate::updater::UpdateInfo>, String> {
    let update_manager = &state.update_manager;
    update_manager.check_for_updates().await
}

#[tauri::command]
pub async fn download_update(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.download_update().await
}

#[tauri::command]
pub async fn install_update(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.install_update().await
}

#[tauri::command]
pub async fn cancel_update(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.cancel_update().await
}

#[tauri::command]
pub async fn get_update_state(
    state: State<'_, AppState>,
) -> Result<crate::updater::UpdateState, String> {
    let update_manager = &state.update_manager;
    Ok(update_manager.get_state().await)
}

#[tauri::command]
pub async fn get_updater_settings(
    state: State<'_, AppState>,
) -> Result<crate::updater::UpdaterSettings, String> {
    let update_manager = &state.update_manager;
    Ok(update_manager.get_settings().await)
}

#[tauri::command]
pub async fn update_updater_settings(
    settings: crate::updater::UpdaterSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.update_settings(settings).await
}

#[tauri::command]
pub async fn switch_update_channel(
    channel: crate::updater::UpdateChannel,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.switch_channel(channel).await
}

#[tauri::command]
pub async fn get_update_history(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::updater::UpdateHistoryEntry>, String> {
    let update_manager = &state.update_manager;
    Ok(update_manager.get_update_history(limit).await)
}

// Backend Manager Commands
#[tauri::command]
pub async fn get_available_backends(
    state: State<'_, AppState>,
) -> Result<Vec<crate::backend_manager::BackendConfig>, String> {
    let backend_manager = &state.backend_manager;
    Ok(backend_manager.get_available_backends().await)
}

#[tauri::command]
pub async fn get_backend_config(
    backend_type: crate::backend_manager::BackendType,
    state: State<'_, AppState>,
) -> Result<Option<crate::backend_manager::BackendConfig>, String> {
    let backend_manager = &state.backend_manager;
    Ok(backend_manager.get_backend_config(backend_type).await)
}

#[tauri::command]
pub async fn is_backend_installed(
    backend_type: crate::backend_manager::BackendType,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let backend_manager = &state.backend_manager;
    Ok(backend_manager.is_backend_installed(backend_type).await)
}

#[tauri::command]
pub async fn install_backend(
    backend_type: crate::backend_manager::BackendType,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let backend_manager = &state.backend_manager;
    backend_manager.install_backend(backend_type).await
}

#[tauri::command]
pub async fn start_backend(
    backend_type: crate::backend_manager::BackendType,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let backend_manager = &state.backend_manager;
    backend_manager.start_backend(backend_type).await
}

#[tauri::command]
pub async fn stop_backend(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let backend_manager = &state.backend_manager;
    backend_manager.stop_backend(&instance_id).await
}

#[tauri::command]
pub async fn switch_backend(
    backend_type: crate::backend_manager::BackendType,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let backend_manager = &state.backend_manager;
    backend_manager.switch_backend(backend_type).await
}

#[tauri::command]
pub async fn get_active_backend(
    state: State<'_, AppState>,
) -> Result<Option<crate::backend_manager::BackendType>, String> {
    let backend_manager = &state.backend_manager;
    Ok(backend_manager.get_active_backend().await)
}

#[tauri::command]
pub async fn get_backend_instances(
    state: State<'_, AppState>,
) -> Result<Vec<crate::backend_manager::BackendInstance>, String> {
    let backend_manager = &state.backend_manager;
    Ok(backend_manager.get_backend_instances().await)
}

#[tauri::command]
pub async fn check_backend_health(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<crate::backend_manager::HealthStatus, String> {
    let backend_manager = &state.backend_manager;
    backend_manager.check_backend_health(&instance_id).await
}

#[tauri::command]
pub async fn get_backend_stats(
    state: State<'_, AppState>,
) -> Result<crate::backend_manager::BackendStats, String> {
    let backend_manager = &state.backend_manager;
    
    let backends = backend_manager.get_available_backends().await;
    let instances = backend_manager.get_backend_instances().await;
    let active_backend = backend_manager.get_active_backend().await;
    
    let mut health_summary = std::collections::HashMap::new();
    for instance in &instances {
        *health_summary.entry(instance.health_status).or_insert(0) += 1;
    }
    
    let mut installed_count = 0;
    for backend in &backends {
        if backend_manager.is_backend_installed(backend.backend_type).await {
            installed_count += 1;
        }
    }
    
    Ok(crate::backend_manager::BackendStats {
        total_backends: backends.len(),
        installed_backends: installed_count,
        running_instances: instances.iter().filter(|i| i.status == crate::backend_manager::BackendStatus::Running).count(),
        active_backend,
        health_summary,
    })
}

// Debug Features Commands
#[derive(Debug, Serialize, Deserialize)]
pub struct LogDebugMessageOptions {
    pub level: crate::debug_features::LogLevel,
    pub component: String,
    pub message: String,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[tauri::command]
pub async fn get_debug_settings(
    state: State<'_, AppState>,
) -> Result<crate::debug_features::DebugSettings, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.get_settings().await)
}

#[tauri::command]
pub async fn update_debug_settings(
    settings: crate::debug_features::DebugSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.update_settings(settings).await;
    Ok(())
}

#[tauri::command]
pub async fn log_debug_message(
    options: LogDebugMessageOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.log(
        options.level,
        &options.component,
        &options.message,
        options.metadata,
    ).await;
    Ok(())
}

#[tauri::command]
pub async fn record_performance_metric(
    name: String,
    value: f64,
    unit: String,
    tags: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.record_metric(&name, value, &unit, tags).await;
    Ok(())
}

#[tauri::command]
pub async fn take_memory_snapshot(
    state: State<'_, AppState>,
) -> Result<crate::debug_features::MemorySnapshot, String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.take_memory_snapshot().await
}

#[tauri::command]
pub async fn get_debug_logs(
    limit: Option<usize>,
    level: Option<crate::debug_features::LogLevel>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::debug_features::LogEntry>, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.get_logs(limit, level).await)
}

#[tauri::command]
pub async fn get_performance_metrics(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::debug_features::PerformanceMetric>, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.get_performance_metrics(limit).await)
}

#[tauri::command]
pub async fn get_memory_snapshots(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::debug_features::MemorySnapshot>, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.get_memory_snapshots(limit).await)
}

#[tauri::command]
pub async fn get_network_requests(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::debug_features::NetworkRequest>, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.get_network_requests(limit).await)
}

#[tauri::command]
pub async fn run_api_tests(
    tests: Vec<crate::debug_features::APITestCase>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::debug_features::APITestResult>, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.run_api_tests(tests).await)
}

// API Testing Commands
#[tauri::command]
pub async fn get_api_test_config(
    state: State<'_, AppState>,
) -> Result<crate::api_testing::APITestRunnerConfig, String> {
    let api_testing_manager = &state.api_testing_manager;
    Ok(api_testing_manager.get_config().await)
}

#[tauri::command]
pub async fn update_api_test_config(
    config: crate::api_testing::APITestRunnerConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let api_testing_manager = &state.api_testing_manager;
    api_testing_manager.update_config(config).await;
    Ok(())
}

#[tauri::command]
pub async fn add_api_test_suite(
    suite: crate::api_testing::APITestSuite,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let api_testing_manager = &state.api_testing_manager;
    api_testing_manager.add_test_suite(suite).await;
    Ok(())
}

#[tauri::command]
pub async fn get_api_test_suite(
    suite_id: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::api_testing::APITestSuite>, String> {
    let api_testing_manager = &state.api_testing_manager;
    Ok(api_testing_manager.get_test_suite(&suite_id).await)
}

#[tauri::command]
pub async fn list_api_test_suites(
    state: State<'_, AppState>,
) -> Result<Vec<crate::api_testing::APITestSuite>, String> {
    let api_testing_manager = &state.api_testing_manager;
    Ok(api_testing_manager.list_test_suites().await)
}

#[tauri::command]
pub async fn run_single_api_test(
    test: crate::api_testing::APITest,
    variables: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<crate::api_testing::APITestResult, String> {
    let api_testing_manager = &state.api_testing_manager;
    Ok(api_testing_manager.run_test(&test, &variables).await)
}

#[tauri::command]
pub async fn run_api_test_suite(
    suite_id: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::api_testing::APITestHistoryEntry>, String> {
    let api_testing_manager = &state.api_testing_manager;
    Ok(api_testing_manager.run_test_suite(&suite_id).await)
}

#[tauri::command]
pub async fn get_api_test_history(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::api_testing::APITestHistoryEntry>, String> {
    let api_testing_manager = &state.api_testing_manager;
    Ok(api_testing_manager.get_test_history(limit).await)
}

#[tauri::command]
pub async fn clear_api_test_history(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let api_testing_manager = &state.api_testing_manager;
    api_testing_manager.clear_test_history().await;
    Ok(())
}

#[tauri::command]
pub async fn import_postman_collection(
    json_data: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let api_testing_manager = &state.api_testing_manager;
    api_testing_manager.import_postman_collection(&json_data).await
}

#[tauri::command]
pub async fn export_api_test_suite(
    suite_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let api_testing_manager = &state.api_testing_manager;
    api_testing_manager.export_test_suite(&suite_id).await
}

#[tauri::command]
pub async fn run_benchmarks(
    configs: Vec<crate::debug_features::BenchmarkConfig>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::debug_features::BenchmarkResult>, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.run_benchmarks(configs).await)
}

#[tauri::command]
pub async fn generate_diagnostic_report(
    state: State<'_, AppState>,
) -> Result<crate::debug_features::DiagnosticReport, String> {
    let debug_features_manager = &state.debug_features_manager;
    Ok(debug_features_manager.generate_diagnostic_report().await)
}

#[tauri::command]
pub async fn clear_debug_data(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.clear_all_data().await;
    Ok(())
}

#[tauri::command]
pub async fn set_debug_mode(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.set_debug_mode(enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn get_debug_stats(
    state: State<'_, AppState>,
) -> Result<crate::debug_features::DebugStats, String> {
    let debug_features_manager = &state.debug_features_manager;
    
    let logs = debug_features_manager.get_logs(None, None).await;
    let mut logs_by_level = HashMap::new();
    for log in &logs {
        let level = format!("{:?}", log.level);
        *logs_by_level.entry(level).or_insert(0) += 1;
    }
    
    let metrics = debug_features_manager.get_performance_metrics(None).await;
    let snapshots = debug_features_manager.get_memory_snapshots(None).await;
    let requests = debug_features_manager.get_network_requests(None).await;
    
    Ok(crate::debug_features::DebugStats {
        total_logs: logs.len(),
        logs_by_level,
        total_metrics: metrics.len(),
        total_snapshots: snapshots.len(),
        total_requests: requests.len(),
        total_test_results: 0, // TODO: Track test results
        total_benchmarks: 0, // TODO: Track benchmarks
    })
}

// Auth Cache Commands
#[derive(Debug, Serialize, Deserialize)]
pub struct StoreTokenOptions {
    pub key: String,
    pub token: crate::auth_cache::CachedToken,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetTokenOptions {
    pub key: String,
    pub scope: crate::auth_cache::AuthScope,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreCredentialOptions {
    pub key: String,
    pub credential: crate::auth_cache::AuthCredential,
}

#[tauri::command]
pub async fn get_auth_cache_config(
    state: State<'_, AppState>,
) -> Result<crate::auth_cache::AuthCacheConfig, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    Ok(auth_cache_manager.get_config().await)
}

#[tauri::command]
pub async fn update_auth_cache_config(
    config: crate::auth_cache::AuthCacheConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.update_config(config).await;
    Ok(())
}

#[tauri::command]
pub async fn store_auth_token(
    options: StoreTokenOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.store_token(&options.key, options.token).await
}

#[tauri::command]
pub async fn get_auth_token(
    options: GetTokenOptions,
    state: State<'_, AppState>,
) -> Result<Option<crate::auth_cache::CachedToken>, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    Ok(auth_cache_manager.get_token(&options.key, &options.scope).await)
}

#[tauri::command]
pub async fn store_auth_credential(
    options: StoreCredentialOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.store_credential(&options.key, options.credential).await
}

#[tauri::command]
pub async fn get_auth_credential(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::auth_cache::AuthCredential>, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    Ok(auth_cache_manager.get_credential(&key).await)
}

#[tauri::command]
pub async fn clear_auth_cache_entry(
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.clear_entry(&key).await;
    Ok(())
}

#[tauri::command]
pub async fn clear_all_auth_cache(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.clear_all().await;
    Ok(())
}

#[tauri::command]
pub async fn get_auth_cache_stats(
    state: State<'_, AppState>,
) -> Result<crate::auth_cache::AuthCacheStats, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    Ok(auth_cache_manager.get_stats().await)
}

#[tauri::command]
pub async fn list_auth_cache_entries(
    state: State<'_, AppState>,
) -> Result<Vec<(String, chrono::DateTime<chrono::Utc>, u64)>, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    Ok(auth_cache_manager.list_entries().await)
}

#[tauri::command]
pub async fn export_auth_cache(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.export_cache().await
}

#[tauri::command]
pub async fn import_auth_cache(
    json_data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.import_cache(&json_data).await
}

#[tauri::command]
pub fn hash_password(password: String) -> String {
    crate::auth_cache::AuthCacheManager::hash_password(&password)
}

#[tauri::command]
pub fn create_auth_cache_key(
    service: String,
    username: Option<String>,
    resource: Option<String>,
) -> String {
    crate::auth_cache::create_cache_key(
        &service,
        username.as_deref(),
        resource.as_deref(),
    )
}

// Terminal Integrations Commands
#[tauri::command]
pub async fn detect_installed_terminals(
    state: State<'_, AppState>,
) -> Result<Vec<crate::terminal_integrations::TerminalIntegrationInfo>, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager.detect_terminals().await)
}

#[tauri::command]
pub async fn get_default_terminal(
    state: State<'_, AppState>,
) -> Result<crate::terminal_integrations::TerminalEmulator, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager.get_default_terminal().await)
}

#[tauri::command]
pub async fn set_default_terminal(
    emulator: crate::terminal_integrations::TerminalEmulator,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    terminal_integrations_manager.set_default_terminal(emulator).await
}

#[tauri::command]
pub async fn launch_terminal_emulator(
    emulator: Option<crate::terminal_integrations::TerminalEmulator>,
    options: crate::terminal_integrations::TerminalLaunchOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    terminal_integrations_manager.launch_terminal(emulator, options).await
}

#[tauri::command]
pub async fn get_terminal_config(
    emulator: crate::terminal_integrations::TerminalEmulator,
    state: State<'_, AppState>,
) -> Result<Option<crate::terminal_integrations::TerminalConfig>, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager.get_terminal_config(emulator).await)
}

#[tauri::command]
pub async fn update_terminal_config(
    config: crate::terminal_integrations::TerminalConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    terminal_integrations_manager.update_terminal_config(config).await;
    Ok(())
}

#[tauri::command]
pub async fn list_detected_terminals(
    state: State<'_, AppState>,
) -> Result<Vec<crate::terminal_integrations::TerminalIntegrationInfo>, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager.list_detected_terminals().await)
}

#[tauri::command]
pub async fn create_terminal_ssh_url(
    emulator: crate::terminal_integrations::TerminalEmulator,
    user: String,
    host: String,
    port: u16,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager.create_ssh_url(emulator, &user, &host, port).await)
}

#[tauri::command]
pub async fn get_terminal_integration_stats(
    state: State<'_, AppState>,
) -> Result<crate::terminal_integrations::TerminalIntegrationStats, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    
    let detected = terminal_integrations_manager.list_detected_terminals().await;
    let default = terminal_integrations_manager.get_default_terminal().await;
    
    let mut terminals_by_platform = HashMap::new();
    for info in &detected {
        if let Some(config) = &info.config {
            for platform in &config.platform {
                terminals_by_platform
                    .entry(platform.clone())
                    .or_insert_with(Vec::new)
                    .push(info.emulator);
            }
        }
    }
    
    Ok(crate::terminal_integrations::TerminalIntegrationStats {
        total_terminals: detected.len(),
        installed_terminals: detected.iter().filter(|t| t.installed).count(),
        default_terminal: default,
        terminals_by_platform,
    })
}

// Settings UI Commands
#[tauri::command]
pub async fn get_all_settings() -> Result<HashMap<String, serde_json::Value>, String> {
    let settings = crate::settings::Settings::load().unwrap_or_default();
    let mut all_settings = HashMap::new();
    
    all_settings.insert("general".to_string(), 
        serde_json::to_value(&settings.general).unwrap_or(serde_json::Value::Null));
    all_settings.insert("dashboard".to_string(), 
        serde_json::to_value(&settings.dashboard).unwrap_or(serde_json::Value::Null));
    all_settings.insert("advanced".to_string(), 
        serde_json::to_value(&settings.advanced).unwrap_or(serde_json::Value::Null));
    all_settings.insert("recording".to_string(), 
        serde_json::to_value(&settings.recording).unwrap_or(serde_json::Value::Null));
    all_settings.insert("tty_forward".to_string(), 
        serde_json::to_value(&settings.tty_forward).unwrap_or(serde_json::Value::Null));
    all_settings.insert("monitoring".to_string(), 
        serde_json::to_value(&settings.monitoring).unwrap_or(serde_json::Value::Null));
    all_settings.insert("network".to_string(), 
        serde_json::to_value(&settings.network).unwrap_or(serde_json::Value::Null));
    all_settings.insert("port".to_string(), 
        serde_json::to_value(&settings.port).unwrap_or(serde_json::Value::Null));
    all_settings.insert("notifications".to_string(), 
        serde_json::to_value(&settings.notifications).unwrap_or(serde_json::Value::Null));
    all_settings.insert("terminal_integrations".to_string(), 
        serde_json::to_value(&settings.terminal_integrations).unwrap_or(serde_json::Value::Null));
    all_settings.insert("updates".to_string(), 
        serde_json::to_value(&settings.updates).unwrap_or(serde_json::Value::Null));
    all_settings.insert("security".to_string(), 
        serde_json::to_value(&settings.security).unwrap_or(serde_json::Value::Null));
    all_settings.insert("debug".to_string(), 
        serde_json::to_value(&settings.debug).unwrap_or(serde_json::Value::Null));
    
    Ok(all_settings)
}

#[tauri::command]
pub async fn update_setting(section: String, key: String, value: String) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    
    // Parse the JSON value
    let json_value: serde_json::Value = serde_json::from_str(&value)
        .map_err(|e| format!("Invalid JSON value: {}", e))?;
    
    match section.as_str() {
        "general" => {
            match key.as_str() {
                "launch_at_login" => settings.general.launch_at_login = json_value.as_bool().unwrap_or(false),
                "show_dock_icon" => settings.general.show_dock_icon = json_value.as_bool().unwrap_or(true),
                "default_terminal" => settings.general.default_terminal = json_value.as_str().unwrap_or("system").to_string(),
                "default_shell" => settings.general.default_shell = json_value.as_str().unwrap_or("default").to_string(),
                "show_welcome_on_startup" => settings.general.show_welcome_on_startup = json_value.as_bool(),
                "theme" => settings.general.theme = json_value.as_str().map(|s| s.to_string()),
                "language" => settings.general.language = json_value.as_str().map(|s| s.to_string()),
                "check_updates_automatically" => settings.general.check_updates_automatically = json_value.as_bool(),
                _ => return Err(format!("Unknown general setting: {}", key)),
            }
        }
        "dashboard" => {
            match key.as_str() {
                "server_port" => settings.dashboard.server_port = json_value.as_u64().unwrap_or(4020) as u16,
                "enable_password" => settings.dashboard.enable_password = json_value.as_bool().unwrap_or(false),
                "password" => settings.dashboard.password = json_value.as_str().unwrap_or("").to_string(),
                "access_mode" => settings.dashboard.access_mode = json_value.as_str().unwrap_or("localhost").to_string(),
                "auto_cleanup" => settings.dashboard.auto_cleanup = json_value.as_bool().unwrap_or(true),
                "session_limit" => settings.dashboard.session_limit = json_value.as_u64().map(|v| v as u32),
                "idle_timeout_minutes" => settings.dashboard.idle_timeout_minutes = json_value.as_u64().map(|v| v as u32),
                "enable_cors" => settings.dashboard.enable_cors = json_value.as_bool(),
                _ => return Err(format!("Unknown dashboard setting: {}", key)),
            }
        }
        "advanced" => {
            match key.as_str() {
                "server_mode" => settings.advanced.server_mode = json_value.as_str().unwrap_or("rust").to_string(),
                "debug_mode" => settings.advanced.debug_mode = json_value.as_bool().unwrap_or(false),
                "log_level" => settings.advanced.log_level = json_value.as_str().unwrap_or("info").to_string(),
                "session_timeout" => settings.advanced.session_timeout = json_value.as_u64().unwrap_or(0) as u32,
                "ngrok_auth_token" => settings.advanced.ngrok_auth_token = json_value.as_str().map(|s| s.to_string()),
                "ngrok_region" => settings.advanced.ngrok_region = json_value.as_str().map(|s| s.to_string()),
                "ngrok_subdomain" => settings.advanced.ngrok_subdomain = json_value.as_str().map(|s| s.to_string()),
                "enable_telemetry" => settings.advanced.enable_telemetry = json_value.as_bool(),
                "experimental_features" => settings.advanced.experimental_features = json_value.as_bool(),
                _ => return Err(format!("Unknown advanced setting: {}", key)),
            }
        }
        "debug" => {
            // Ensure debug settings exist
            if settings.debug.is_none() {
                settings.debug = Some(crate::settings::DebugSettings {
                    enable_debug_menu: false,
                    show_performance_stats: false,
                    enable_verbose_logging: false,
                    log_to_file: false,
                    log_file_path: None,
                    max_log_file_size_mb: None,
                    enable_dev_tools: false,
                    show_internal_errors: false,
                });
            }
            
            if let Some(ref mut debug) = settings.debug {
                match key.as_str() {
                    "enable_debug_menu" => debug.enable_debug_menu = json_value.as_bool().unwrap_or(false),
                    "show_performance_stats" => debug.show_performance_stats = json_value.as_bool().unwrap_or(false),
                    "enable_verbose_logging" => debug.enable_verbose_logging = json_value.as_bool().unwrap_or(false),
                    "log_to_file" => debug.log_to_file = json_value.as_bool().unwrap_or(false),
                    "log_file_path" => debug.log_file_path = json_value.as_str().map(|s| s.to_string()),
                    "max_log_file_size_mb" => debug.max_log_file_size_mb = json_value.as_u64().map(|v| v as u32),
                    "enable_dev_tools" => debug.enable_dev_tools = json_value.as_bool().unwrap_or(false),
                    "show_internal_errors" => debug.show_internal_errors = json_value.as_bool().unwrap_or(false),
                    _ => return Err(format!("Unknown debug setting: {}", key)),
                }
            }
        }
        _ => return Err(format!("Unknown settings section: {}", section)),
    }
    
    settings.save()
}

#[tauri::command]
pub async fn set_dashboard_password(password: String, state: State<'_, AppState>) -> Result<(), String> {
    // Update settings
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.dashboard.password = password.clone();
    settings.dashboard.enable_password = !password.is_empty();
    settings.save()?;
    
    // Update the running server's auth configuration if it's running
    let server = state.http_server.read().await;
    if server.is_some() {
        drop(server);
        // Restart server to apply new auth settings
        restart_server(state).await?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn restart_server_with_port(port: u16, state: State<'_, AppState>) -> Result<(), String> {
    // Update settings with new port
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.dashboard.server_port = port;
    settings.save()?;
    
    // Restart the server
    restart_server(state).await
}

#[tauri::command]
pub async fn update_server_bind_address(address: String, state: State<'_, AppState>) -> Result<(), String> {
    // Update settings
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.dashboard.access_mode = if address == "127.0.0.1" { "localhost" } else { "network" }.to_string();
    settings.save()?;
    
    // Restart server to apply new bind address
    restart_server(state).await
}

#[tauri::command]
pub async fn set_dock_icon_visibility(visible: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    // Update settings
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.general.show_dock_icon = visible;
    settings.save()?;
    
    // Apply the change
    update_dock_icon_visibility(app_handle).await
}

#[tauri::command]
pub async fn set_log_level(level: String) -> Result<(), String> {
    // Update settings
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.advanced.log_level = level.clone();
    settings.save()?;
    
    // TODO: Apply the log level change to the running logger
    tracing::info!("Log level changed to: {}", level);
    
    Ok(())
}

#[tauri::command]
pub async fn test_api_endpoint(endpoint: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let server = state.http_server.read().await;
    
    if let Some(http_server) = server.as_ref() {
        let port = http_server.port();
        let url = format!("http://localhost:{}{}", port, endpoint);
        
        // Create a simple HTTP client request
        let client = reqwest::Client::new();
        let response = client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;
        
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "Failed to read body".to_string());
        
        // Try to parse as JSON, fallback to text
        let json_body = serde_json::from_str::<serde_json::Value>(&body)
            .unwrap_or_else(|_| serde_json::json!({ "body": body }));
        
        Ok(serde_json::json!({
            "status": status.as_u16(),
            "endpoint": endpoint,
            "response": json_body,
        }))
    } else {
        Err("Server is not running".to_string())
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct ServerLog {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

#[tauri::command]
pub async fn get_server_logs(limit: usize) -> Result<Vec<ServerLog>, String> {
    // TODO: Implement actual log collection from the server
    // For now, return dummy logs for the UI
    let logs = vec![
        ServerLog {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "info".to_string(),
            message: "Server started on port 4020".to_string(),
        },
        ServerLog {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "info".to_string(),
            message: "Health check endpoint accessed".to_string(),
        },
    ];
    
    Ok(logs.into_iter().take(limit).collect())
}

#[tauri::command]
pub async fn export_logs(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Get logs
    let logs = get_server_logs(1000).await?;
    
    // Convert to text format
    let log_text = logs.into_iter()
        .map(|log| format!("[{}] {} - {}", log.timestamp, log.level.to_uppercase(), log.message))
        .collect::<Vec<_>>()
        .join("\n");
    
    // Save to file
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("vibetunnel_logs_{}.txt", timestamp);
    
    use tauri::api::dialog::blocking::FileDialogBuilder;
    if let Some(path) = FileDialogBuilder::new()
        .set_file_name(&filename)
        .set_title("Export Logs")
        .save_file() {
        std::fs::write(path, log_text).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn get_local_ip() -> Result<String, String> {
    get_local_ip_address().await.map(|opt| opt.unwrap_or_else(|| "127.0.0.1".to_string()))
}

#[tauri::command]
pub async fn detect_terminals() -> Result<Vec<crate::terminal_detector::DetectedTerminal>, String> {
    Ok(crate::terminal_detector::detect_terminals())
}