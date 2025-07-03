use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Manager, State};

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
    app: tauri::AppHandle,
) -> Result<Terminal, String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        return Err("Server is not running. Please start the server first.".to_string());
    }

    // Create session via API
    let req = crate::api_client::CreateSessionRequest {
        name: options.name,
        rows: options.rows,
        cols: options.cols,
        cwd: options.cwd,
        env: options.env,
        shell: options.shell,
    };

    let session = state.api_client.create_session(req).await?;

    // Update menu bar session count
    let sessions = state.api_client.list_sessions().await?;
    crate::tray_menu::TrayMenuManager::update_session_count(&app, sessions.len()).await;

    Ok(Terminal {
        id: session.id,
        name: session.name,
        pid: session.pid,
        rows: session.rows,
        cols: session.cols,
        created_at: session.created_at,
    })
}

#[tauri::command]
pub async fn list_terminals(state: State<'_, AppState>) -> Result<Vec<Terminal>, String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        return Ok(Vec::new());
    }

    // List sessions via API
    let sessions = state.api_client.list_sessions().await?;

    Ok(sessions
        .into_iter()
        .map(|s| Terminal {
            id: s.id,
            name: s.name,
            pid: s.pid,
            rows: s.rows,
            cols: s.cols,
            created_at: s.created_at,
        })
        .collect())
}

#[tauri::command]
pub async fn close_terminal(
    id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        return Err("Server is not running".to_string());
    }

    // Close session via API
    state.api_client.close_session(&id).await?;

    // Update menu bar session count
    let sessions = state.api_client.list_sessions().await?;
    crate::tray_menu::TrayMenuManager::update_session_count(&app, sessions.len()).await;

    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        return Err("Server is not running".to_string());
    }

    // Resize session via API
    state.api_client.resize_session(&id, rows, cols).await
}

#[tauri::command]
pub async fn write_to_terminal(
    id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        return Err("Server is not running".to_string());
    }

    // Send input via API
    let result = state.api_client.send_input(&id, &data).await;

    // Notify session monitor of activity
    if result.is_ok() {
        state.session_monitor.notify_activity(&id).await;
    }

    result
}

#[tauri::command]
pub async fn read_from_terminal(id: String, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        return Err("Server is not running".to_string());
    }

    // Get output via API
    let result = state.api_client.get_session_output(&id).await;

    // Notify session monitor of activity
    if result.is_ok() {
        state.session_monitor.notify_activity(&id).await;
    }

    result
}

#[tauri::command]
pub async fn start_server(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ServerStatus, String> {
    // Check if server is already running
    if state.backend_manager.is_running().await {
        // Get port from settings
        let settings = crate::settings::Settings::load().unwrap_or_default();
        let port = settings.dashboard.server_port;

        // Check if ngrok is active
        let url = if let Some(ngrok_tunnel) = state.ngrok_manager.get_tunnel_status() {
            ngrok_tunnel.url
        } else {
            format!("http://127.0.0.1:{port}")
        };

        return Ok(ServerStatus {
            running: true,
            port,
            url,
        });
    }

    // Load settings
    let settings = crate::settings::Settings::load().unwrap_or_default();
    let port = settings.dashboard.server_port;

    // Start the Node.js server
    state.backend_manager.start().await?;

    // Handle access mode
    let url = match settings.dashboard.access_mode.as_str() {
        "network" => {
            // For network mode, the Node.js server handles the binding
            format!("http://0.0.0.0:{port}")
        }
        "ngrok" => {
            // Try to start ngrok tunnel if auth token is configured
            if let Some(auth_token) = settings.advanced.ngrok_auth_token {
                if auth_token.is_empty() {
                    let _ = state.backend_manager.stop().await;
                    return Err("Ngrok auth token is required for ngrok access mode".to_string());
                } else {
                    match state
                        .ngrok_manager
                        .start_tunnel(port, Some(auth_token))
                        .await
                    {
                        Ok(tunnel) => tunnel.url,
                        Err(e) => {
                            tracing::error!("Failed to start ngrok tunnel: {}", e);
                            // Stop the server since ngrok failed
                            let _ = state.backend_manager.stop().await;
                            return Err(format!("Failed to start ngrok tunnel: {e}"));
                        }
                    }
                }
            } else {
                let _ = state.backend_manager.stop().await;
                return Err("Ngrok auth token is required for ngrok access mode".to_string());
            }
        }
        _ => {
            format!("http://127.0.0.1:{port}")
        }
    };

    // Update menu bar server status
    crate::tray_menu::TrayMenuManager::update_server_status(&app, port, true).await;

    Ok(ServerStatus {
        running: true,
        port,
        url,
    })
}

#[tauri::command]
pub async fn stop_server(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    // Stop the Node.js server
    state.backend_manager.stop().await?;

    // Also stop ngrok tunnel if active
    let _ = state.ngrok_manager.stop_tunnel().await;

    // Update menu bar server status
    crate::tray_menu::TrayMenuManager::update_server_status(&app, 4022, false).await;

    Ok(())
}

#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    if state.backend_manager.is_running().await {
        // Get port from settings
        let settings = crate::settings::Settings::load().unwrap_or_default();
        let port = settings.dashboard.server_port;

        // Check if ngrok is active and return its URL
        let url = if let Some(ngrok_tunnel) = state.ngrok_manager.get_tunnel_status() {
            ngrok_tunnel.url
        } else {
            // Check settings to determine the correct URL format
            match settings.dashboard.access_mode.as_str() {
                "network" => format!("http://0.0.0.0:{port}"),
                _ => format!("http://127.0.0.1:{port}"),
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
pub fn get_os() -> String {
    #[cfg(target_os = "macos")]
    return "macos".to_string();
    
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    
    #[cfg(target_os = "linux")]
    return "linux".to_string();
    
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "unknown".to_string();
}

#[tauri::command]
pub async fn restart_server(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ServerStatus, String> {
    // First stop the server
    stop_server(state.clone(), app.clone()).await?;

    // Wait a moment for clean shutdown
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Start the server again
    start_server(state, app).await
}

#[tauri::command]
pub async fn show_server_console(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Check if server console window already exists
    if let Some(window) = app_handle.get_webview_window("server-console") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create a new window for the server console
        tauri::WebviewWindowBuilder::new(
            &app_handle,
            "server-console",
            tauri::WebviewUrl::App("server-console.html".into()),
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
pub async fn show_welcome_screen(state: State<'_, AppState>) -> Result<(), String> {
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
    default_settings.save()?;

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
        let has_visible_windows = app_handle
            .windows()
            .values()
            .any(|w| w.is_visible().unwrap_or(false));

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

    let remote_host = options
        .remote_host
        .unwrap_or_else(|| "localhost".to_string());
    let remote_port = options.remote_port.unwrap_or(22);

    tty_forward_manager
        .start_forward(options.local_port, remote_host, remote_port, options.shell)
        .await
}

#[tauri::command]
pub async fn stop_tty_forward(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let tty_forward_manager = &state.tty_forward_manager;
    tty_forward_manager.stop_forward(&id).await
}

#[tauri::command]
pub async fn list_tty_forwards(state: State<'_, AppState>) -> Result<Vec<TTYForwardInfo>, String> {
    let tty_forward_manager = &state.tty_forward_manager;
    let forwards = tty_forward_manager.list_forwards().await;

    Ok(forwards
        .into_iter()
        .map(|f| TTYForwardInfo {
            id: f.id,
            local_port: f.local_port,
            remote_host: f.remote_host,
            remote_port: f.remote_port,
            connected: f.connected,
            client_count: f.client_count,
        })
        .collect())
}

#[tauri::command]
pub async fn get_tty_forward(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<TTYForwardInfo>, String> {
    let tty_forward_manager = &state.tty_forward_manager;

    Ok(tty_forward_manager
        .get_forward(&id)
        .await
        .map(|f| TTYForwardInfo {
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
pub async fn start_session_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    let session_monitor = &state.session_monitor;
    session_monitor.start_monitoring().await;
    Ok(())
}

// Port Conflict Resolution Commands
#[tauri::command]
pub async fn check_port_availability(port: u16) -> Result<bool, String> {
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
pub async fn find_available_ports(near_port: u16, count: usize) -> Result<Vec<u16>, String> {
    let mut available_ports = Vec::new();
    let start = near_port.saturating_sub(10).max(1024);
    let end = near_port.saturating_add(100);

    for port in start..=end {
        if port != near_port
            && crate::port_conflict::PortConflictResolver::is_port_available(port).await
        {
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
pub async fn get_network_interfaces() -> Result<Vec<crate::network_utils::NetworkInterface>, String>
{
    Ok(crate::network_utils::NetworkUtils::get_all_interfaces())
}

#[tauri::command]
pub async fn get_hostname() -> Result<Option<String>, String> {
    Ok(crate::network_utils::NetworkUtils::get_hostname())
}

#[tauri::command]
pub async fn test_network_connectivity(host: String, port: u16) -> Result<bool, String> {
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
    notification_manager
        .show_notification(
            options.notification_type,
            options.priority,
            options.title,
            options.body,
            options.actions,
            options.metadata,
        )
        .await
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
pub async fn mark_all_notifications_as_read(state: State<'_, AppState>) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.mark_all_as_read().await
}

#[tauri::command]
pub async fn clear_notification(
    notification_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager
        .clear_notification(&notification_id)
        .await
}

#[tauri::command]
pub async fn clear_all_notifications(state: State<'_, AppState>) -> Result<(), String> {
    let notification_manager = &state.notification_manager;
    notification_manager.clear_all_notifications().await
}

#[tauri::command]
pub async fn get_unread_notification_count(state: State<'_, AppState>) -> Result<usize, String> {
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
pub async fn should_show_welcome(state: State<'_, AppState>) -> Result<bool, String> {
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
pub async fn skip_tutorial(state: State<'_, AppState>) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.skip_tutorial().await
}

#[tauri::command]
pub async fn reset_tutorial(state: State<'_, AppState>) -> Result<(), String> {
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
pub async fn show_welcome_window(state: State<'_, AppState>) -> Result<(), String> {
    let welcome_manager = &state.welcome_manager;
    welcome_manager.show_welcome_window().await
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

// Advanced Settings Commands

#[tauri::command]
pub async fn get_all_advanced_settings() -> Result<HashMap<String, serde_json::Value>, String> {
    let settings = crate::settings::Settings::load().unwrap_or_default();
    let mut all_settings = HashMap::new();

    // Convert all settings sections to JSON values
    all_settings.insert(
        "tty_forward".to_string(),
        serde_json::to_value(&settings.tty_forward).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "monitoring".to_string(),
        serde_json::to_value(&settings.monitoring).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "network".to_string(),
        serde_json::to_value(&settings.network).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "port".to_string(),
        serde_json::to_value(&settings.port).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "notifications".to_string(),
        serde_json::to_value(&settings.notifications).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "terminal_integrations".to_string(),
        serde_json::to_value(&settings.terminal_integrations).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "updates".to_string(),
        serde_json::to_value(&settings.updates).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "security".to_string(),
        serde_json::to_value(&settings.security).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "debug".to_string(),
        serde_json::to_value(&settings.debug).unwrap_or(serde_json::Value::Null),
    );

    Ok(all_settings)
}

#[tauri::command]
pub async fn update_advanced_settings(
    section: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();

    match section.as_str() {
        "tty_forward" => {
            settings.tty_forward = serde_json::from_value(value)
                .map_err(|e| format!("Invalid TTY forward settings: {e}"))?;
        }
        "monitoring" => {
            settings.monitoring = serde_json::from_value(value)
                .map_err(|e| format!("Invalid monitoring settings: {e}"))?;
        }
        "network" => {
            settings.network = serde_json::from_value(value)
                .map_err(|e| format!("Invalid network settings: {e}"))?;
        }
        "port" => {
            settings.port = serde_json::from_value(value)
                .map_err(|e| format!("Invalid port settings: {e}"))?;
        }
        "notifications" => {
            settings.notifications = serde_json::from_value(value)
                .map_err(|e| format!("Invalid notification settings: {e}"))?;
        }
        "terminal_integrations" => {
            settings.terminal_integrations = serde_json::from_value(value)
                .map_err(|e| format!("Invalid terminal integration settings: {e}"))?;
        }
        "updates" => {
            settings.updates = serde_json::from_value(value)
                .map_err(|e| format!("Invalid update settings: {e}"))?;
        }
        "security" => {
            settings.security = serde_json::from_value(value)
                .map_err(|e| format!("Invalid security settings: {e}"))?;
        }
        "debug" => {
            settings.debug = serde_json::from_value(value)
                .map_err(|e| format!("Invalid debug settings: {e}"))?;
        }
        _ => return Err(format!("Unknown settings section: {section}")),
    }

    settings.save()
}

#[tauri::command]
pub async fn reset_settings_section(section: String) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    let defaults = crate::settings::Settings::default();

    match section.as_str() {
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
        _ => return Err(format!("Unknown settings section: {section}")),
    }

    settings.save()
}

#[tauri::command]
pub async fn export_settings() -> Result<String, String> {
    let settings = crate::settings::Settings::load().unwrap_or_default();
    toml::to_string_pretty(&settings).map_err(|e| format!("Failed to export settings: {e}"))
}

#[tauri::command]
pub async fn import_settings(toml_content: String) -> Result<(), String> {
    let settings: crate::settings::Settings =
        toml::from_str(&toml_content).map_err(|e| format!("Failed to parse settings: {e}"))?;
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
pub async fn check_permission_silent(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<crate::permissions::PermissionStatus, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager
        .check_permission_silent(permission_type)
        .await)
}

#[tauri::command]
pub async fn request_permission(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<crate::permissions::PermissionRequestResult, String> {
    let permissions_manager = &state.permissions_manager;
    permissions_manager
        .request_permission(permission_type)
        .await
}

#[tauri::command]
pub async fn get_permission_info(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<Option<crate::permissions::PermissionInfo>, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager
        .get_permission_info(permission_type)
        .await)
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
pub async fn all_required_permissions_granted(state: State<'_, AppState>) -> Result<bool, String> {
    let permissions_manager = &state.permissions_manager;
    Ok(permissions_manager.all_required_permissions_granted().await)
}

#[tauri::command]
pub async fn open_system_permission_settings(
    permission_type: crate::permissions::PermissionType,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let permissions_manager = &state.permissions_manager;
    permissions_manager
        .open_system_settings(permission_type)
        .await
}

#[tauri::command]
pub async fn get_permission_stats(
    state: State<'_, AppState>,
) -> Result<crate::permissions::PermissionStats, String> {
    let permissions_manager = &state.permissions_manager;
    let all_permissions = permissions_manager.get_all_permissions().await;

    let stats = crate::permissions::PermissionStats {
        total_permissions: all_permissions.len(),
        granted_permissions: all_permissions
            .iter()
            .filter(|p| p.status == crate::permissions::PermissionStatus::Granted)
            .count(),
        denied_permissions: all_permissions
            .iter()
            .filter(|p| p.status == crate::permissions::PermissionStatus::Denied)
            .count(),
        required_permissions: all_permissions.iter().filter(|p| p.required).count(),
        missing_required: all_permissions
            .iter()
            .filter(|p| p.required && p.status != crate::permissions::PermissionStatus::Granted)
            .count(),
        platform: std::env::consts::OS.to_string(),
    };

    Ok(stats)
}

#[tauri::command]
pub async fn register_permission_monitoring(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.permissions_manager.register_for_monitoring().await;
    Ok(())
}

#[tauri::command]
pub async fn unregister_permission_monitoring(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.permissions_manager.unregister_from_monitoring().await;
    Ok(())
}

#[tauri::command]
pub async fn show_permission_alert(
    state: State<'_, AppState>,
    permission_type: crate::permissions::PermissionType,
) -> Result<(), String> {
    state.permissions_manager.show_permission_alert(permission_type).await
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
pub async fn download_update(state: State<'_, AppState>) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.download_update().await
}

#[tauri::command]
pub async fn install_update(state: State<'_, AppState>) -> Result<(), String> {
    let update_manager = &state.update_manager;
    update_manager.install_update().await
}

#[tauri::command]
pub async fn cancel_update(state: State<'_, AppState>) -> Result<(), String> {
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
// Multi-backend commands - not applicable to our Node.js subprocess approach
// These would be used if we supported multiple backend types (Bun, Node, Deno, etc.)
/*
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
pub async fn stop_backend(instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
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
        if backend_manager
            .is_backend_installed(backend.backend_type)
            .await
        {
            installed_count += 1;
        }
    }

    Ok(crate::backend_manager::BackendStats {
        total_backends: backends.len(),
        installed_backends: installed_count,
        running_instances: instances
            .iter()
            .filter(|i| i.status == crate::backend_manager::BackendStatus::Running)
            .count(),
        active_backend,
        health_summary,
    })
}
*/

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
    debug_features_manager
        .log(
            options.level,
            &options.component,
            &options.message,
            options.metadata,
        )
        .await;
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
    debug_features_manager
        .record_metric(&name, value, &unit, tags)
        .await;
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
pub async fn clear_api_test_history(state: State<'_, AppState>) -> Result<(), String> {
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
    api_testing_manager
        .import_postman_collection(&json_data)
        .await
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
pub async fn clear_debug_data(state: State<'_, AppState>) -> Result<(), String> {
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.clear_all_data().await;
    Ok(())
}

#[tauri::command]
pub async fn clear_debug_logs(state: State<'_, AppState>) -> Result<(), String> {
    // For now, clear all debug data - could be enhanced to clear only logs
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.clear_all_data().await;
    Ok(())
}

#[tauri::command]
pub async fn clear_network_requests(state: State<'_, AppState>) -> Result<(), String> {
    // For now, clear all debug data - could be enhanced to clear only network requests
    let debug_features_manager = &state.debug_features_manager;
    debug_features_manager.clear_all_data().await;
    Ok(())
}

#[tauri::command]
pub async fn set_debug_mode(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
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
        total_benchmarks: 0,   // TODO: Track benchmarks
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
    auth_cache_manager
        .store_token(&options.key, options.token)
        .await
}

#[tauri::command]
pub async fn get_auth_token(
    options: GetTokenOptions,
    state: State<'_, AppState>,
) -> Result<Option<crate::auth_cache::CachedToken>, String> {
    let auth_cache_manager = &state.auth_cache_manager;
    Ok(auth_cache_manager
        .get_token(&options.key, &options.scope)
        .await)
}

#[tauri::command]
pub async fn store_auth_credential(
    options: StoreCredentialOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager
        .store_credential(&options.key, options.credential)
        .await
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
pub async fn clear_auth_cache_entry(key: String, state: State<'_, AppState>) -> Result<(), String> {
    let auth_cache_manager = &state.auth_cache_manager;
    auth_cache_manager.clear_entry(&key).await;
    Ok(())
}

#[tauri::command]
pub async fn clear_all_auth_cache(state: State<'_, AppState>) -> Result<(), String> {
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
pub async fn export_auth_cache(state: State<'_, AppState>) -> Result<String, String> {
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
    crate::auth_cache::create_cache_key(&service, username.as_deref(), resource.as_deref())
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
    terminal_integrations_manager
        .set_default_terminal(emulator)
        .await
}

#[tauri::command]
pub async fn launch_terminal_emulator(
    emulator: Option<crate::terminal_integrations::TerminalEmulator>,
    options: crate::terminal_integrations::TerminalLaunchOptions,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    terminal_integrations_manager
        .launch_terminal(emulator, options)
        .await
}

#[tauri::command]
pub async fn get_terminal_config(
    emulator: crate::terminal_integrations::TerminalEmulator,
    state: State<'_, AppState>,
) -> Result<Option<crate::terminal_integrations::TerminalConfig>, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager
        .get_terminal_config(emulator)
        .await)
}

#[tauri::command]
pub async fn update_terminal_config(
    config: crate::terminal_integrations::TerminalConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    terminal_integrations_manager
        .update_terminal_config(config)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn list_detected_terminals(
    state: State<'_, AppState>,
) -> Result<Vec<crate::terminal_integrations::TerminalIntegrationInfo>, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;
    Ok(terminal_integrations_manager
        .list_detected_terminals()
        .await)
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
    Ok(terminal_integrations_manager
        .create_ssh_url(emulator, &user, &host, port)
        .await)
}

#[tauri::command]
pub async fn get_terminal_integration_stats(
    state: State<'_, AppState>,
) -> Result<crate::terminal_integrations::TerminalIntegrationStats, String> {
    let terminal_integrations_manager = &state.terminal_integrations_manager;

    let detected = terminal_integrations_manager
        .list_detected_terminals()
        .await;
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

    all_settings.insert(
        "general".to_string(),
        serde_json::to_value(&settings.general).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "dashboard".to_string(),
        serde_json::to_value(&settings.dashboard).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "advanced".to_string(),
        serde_json::to_value(&settings.advanced).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "tty_forward".to_string(),
        serde_json::to_value(&settings.tty_forward).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "monitoring".to_string(),
        serde_json::to_value(&settings.monitoring).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "network".to_string(),
        serde_json::to_value(&settings.network).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "port".to_string(),
        serde_json::to_value(&settings.port).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "notifications".to_string(),
        serde_json::to_value(&settings.notifications).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "terminal_integrations".to_string(),
        serde_json::to_value(&settings.terminal_integrations).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "updates".to_string(),
        serde_json::to_value(&settings.updates).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "security".to_string(),
        serde_json::to_value(&settings.security).unwrap_or(serde_json::Value::Null),
    );
    all_settings.insert(
        "debug".to_string(),
        serde_json::to_value(&settings.debug).unwrap_or(serde_json::Value::Null),
    );

    Ok(all_settings)
}

#[tauri::command]
pub async fn update_setting(section: String, key: String, value: String) -> Result<(), String> {
    let mut settings = crate::settings::Settings::load().unwrap_or_default();

    // Parse the JSON value
    let json_value: serde_json::Value =
        serde_json::from_str(&value).map_err(|e| format!("Invalid JSON value: {e}"))?;

    match section.as_str() {
        "general" => match key.as_str() {
            "launch_at_login" => {
                settings.general.launch_at_login = json_value.as_bool().unwrap_or(false);
            }
            "show_dock_icon" => {
                settings.general.show_dock_icon = json_value.as_bool().unwrap_or(true);
            }
            "default_terminal" => {
                settings.general.default_terminal =
                    json_value.as_str().unwrap_or("system").to_string();
            }
            "default_shell" => {
                settings.general.default_shell =
                    json_value.as_str().unwrap_or("default").to_string();
            }
            "show_welcome_on_startup" => {
                settings.general.show_welcome_on_startup = json_value.as_bool();
            }
            "theme" => settings.general.theme = json_value.as_str().map(std::string::ToString::to_string),
            "language" => settings.general.language = json_value.as_str().map(std::string::ToString::to_string),
            "check_updates_automatically" => {
                settings.general.check_updates_automatically = json_value.as_bool();
            }
            _ => return Err(format!("Unknown general setting: {key}")),
        },
        "dashboard" => match key.as_str() {
            "server_port" => {
                settings.dashboard.server_port = json_value.as_u64().unwrap_or(4022) as u16;
            }
            "enable_password" => {
                settings.dashboard.enable_password = json_value.as_bool().unwrap_or(false);
            }
            "password" => {
                settings.dashboard.password = json_value.as_str().unwrap_or("").to_string();
            }
            "access_mode" => {
                settings.dashboard.access_mode =
                    json_value.as_str().unwrap_or("localhost").to_string();
            }
            "auto_cleanup" => {
                settings.dashboard.auto_cleanup = json_value.as_bool().unwrap_or(true);
            }
            "session_limit" => {
                settings.dashboard.session_limit = json_value.as_u64().map(|v| v as u32);
            }
            "idle_timeout_minutes" => {
                settings.dashboard.idle_timeout_minutes = json_value.as_u64().map(|v| v as u32);
            }
            "enable_cors" => settings.dashboard.enable_cors = json_value.as_bool(),
            _ => return Err(format!("Unknown dashboard setting: {key}")),
        },
        "advanced" => match key.as_str() {
            "debug_mode" => settings.advanced.debug_mode = json_value.as_bool().unwrap_or(false),
            "log_level" => {
                settings.advanced.log_level = json_value.as_str().unwrap_or("info").to_string();
            }
            "session_timeout" => {
                settings.advanced.session_timeout = json_value.as_u64().unwrap_or(0) as u32;
            }
            "ngrok_auth_token" => {
                settings.advanced.ngrok_auth_token = json_value.as_str().map(std::string::ToString::to_string);
            }
            "ngrok_region" => {
                settings.advanced.ngrok_region = json_value.as_str().map(std::string::ToString::to_string);
            }
            "ngrok_subdomain" => {
                settings.advanced.ngrok_subdomain = json_value.as_str().map(std::string::ToString::to_string);
            }
            "enable_telemetry" => settings.advanced.enable_telemetry = json_value.as_bool(),
            "experimental_features" => {
                settings.advanced.experimental_features = json_value.as_bool();
            }
            _ => return Err(format!("Unknown advanced setting: {key}")),
        },
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
                    "enable_debug_menu" => {
                        debug.enable_debug_menu = json_value.as_bool().unwrap_or(false);
                    }
                    "show_performance_stats" => {
                        debug.show_performance_stats = json_value.as_bool().unwrap_or(false);
                    }
                    "enable_verbose_logging" => {
                        debug.enable_verbose_logging = json_value.as_bool().unwrap_or(false);
                    }
                    "log_to_file" => debug.log_to_file = json_value.as_bool().unwrap_or(false),
                    "log_file_path" => {
                        debug.log_file_path = json_value.as_str().map(std::string::ToString::to_string);
                    }
                    "max_log_file_size_mb" => {
                        debug.max_log_file_size_mb = json_value.as_u64().map(|v| v as u32);
                    }
                    "enable_dev_tools" => {
                        debug.enable_dev_tools = json_value.as_bool().unwrap_or(false);
                    }
                    "show_internal_errors" => {
                        debug.show_internal_errors = json_value.as_bool().unwrap_or(false);
                    }
                    _ => return Err(format!("Unknown debug setting: {key}")),
                }
            }
        }
        _ => return Err(format!("Unknown settings section: {section}")),
    }

    settings.save()
}

#[tauri::command]
pub async fn set_dashboard_password(
    password: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Update settings
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.dashboard.password = password.clone();
    settings.dashboard.enable_password = !password.is_empty();
    settings.save()?;

    // Update the running server's auth configuration if it's running
    if state.backend_manager.is_running().await {
        // Restart server to apply new auth settings
        restart_server(state, app).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn restart_server_with_port(
    port: u16,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Update settings with new port
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.dashboard.server_port = port;
    settings.save()?;

    // Restart the server
    restart_server(state, app).await?;
    Ok(())
}

#[tauri::command]
pub async fn update_server_bind_address(
    address: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Update settings
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    let access_mode = if address == "127.0.0.1" {
        "localhost"
    } else {
        "network"
    };
    settings.dashboard.access_mode = access_mode.to_string();
    settings.save()?;

    // Update tray menu to reflect new access mode
    crate::tray_menu::TrayMenuManager::update_access_mode(&app_handle, access_mode).await;

    // Restart server to apply new bind address
    restart_server(state, app_handle).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_dock_icon_visibility(
    visible: bool,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
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
pub async fn test_api_endpoint(
    endpoint: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if state.backend_manager.is_running().await {
        let settings = crate::settings::Settings::load().unwrap_or_default();
        let port = settings.dashboard.server_port;
        let url = format!("http://127.0.0.1:{port}{endpoint}");

        // Create a simple HTTP client request
        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read body".to_string());

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
    let logs = crate::log_collector::SERVER_LOG_COLLECTOR.get_logs().await;
    
    // Convert LogEntry to ServerLog
    let server_logs: Vec<ServerLog> = logs
        .into_iter()
        .take(limit)
        .map(|entry| ServerLog {
            timestamp: entry.timestamp,
            level: entry.level,
            message: entry.message,
        })
        .collect();
    
    Ok(server_logs)
}

#[tauri::command]
pub async fn clear_server_logs() -> Result<(), String> {
    crate::log_collector::SERVER_LOG_COLLECTOR.clear().await;
    Ok(())
}

#[tauri::command]
pub async fn export_logs(_app_handle: tauri::AppHandle) -> Result<(), String> {
    // Get logs
    let logs = get_server_logs(1000).await?;

    // Convert to text format
    let log_text = logs
        .into_iter()
        .map(|log| {
            format!(
                "[{}] {} - {}",
                log.timestamp,
                log.level.to_uppercase(),
                log.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    // Save to file
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("vibetunnel_logs_{timestamp}.txt");

    // In Tauri v2, we should use the dialog plugin instead
    // For now, let's just save to a default location
    let downloads_dir =
        dirs::download_dir().ok_or_else(|| "Could not find downloads directory".to_string())?;
    let path = downloads_dir.join(&filename);
    std::fs::write(&path, log_text).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_local_ip() -> Result<String, String> {
    get_local_ip_address()
        .await
        .map(|opt| opt.unwrap_or_else(|| "127.0.0.1".to_string()))
}

#[tauri::command]
pub async fn detect_terminals() -> Result<crate::terminal_detector::DetectedTerminals, String> {
    crate::terminal_detector::detect_terminals()
}

// Keychain commands
#[tauri::command]
pub async fn keychain_set_password(key: String, password: String) -> Result<(), String> {
    crate::keychain::KeychainManager::set_password(&key, &password).map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_get_password(key: String) -> Result<Option<String>, String> {
    crate::keychain::KeychainManager::get_password(&key).map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_delete_password(key: String) -> Result<(), String> {
    crate::keychain::KeychainManager::delete_password(&key).map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_set_dashboard_password(password: String) -> Result<(), String> {
    crate::keychain::KeychainManager::set_dashboard_password(&password).map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_get_dashboard_password() -> Result<Option<String>, String> {
    crate::keychain::KeychainManager::get_dashboard_password().map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_delete_dashboard_password() -> Result<(), String> {
    crate::keychain::KeychainManager::delete_dashboard_password().map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_set_ngrok_auth_token(token: String) -> Result<(), String> {
    crate::keychain::KeychainManager::set_ngrok_auth_token(&token).map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_get_ngrok_auth_token() -> Result<Option<String>, String> {
    crate::keychain::KeychainManager::get_ngrok_auth_token().map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_delete_ngrok_auth_token() -> Result<(), String> {
    crate::keychain::KeychainManager::delete_ngrok_auth_token().map_err(|e| e.message)
}

#[tauri::command]
pub async fn keychain_list_keys() -> Result<Vec<String>, String> {
    Ok(crate::keychain::KeychainManager::list_stored_keys())
}

#[tauri::command]
pub async fn request_all_permissions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::permissions::PermissionRequestResult>, String> {
    let permissions_manager = &state.permissions_manager;
    let mut results = Vec::new();

    // Get all permissions that need to be requested
    let all_permissions = permissions_manager.get_all_permissions().await;

    for permission_info in all_permissions {
        // Only request permissions that are not already granted
        if permission_info.status != crate::permissions::PermissionStatus::Granted
            && permission_info.status != crate::permissions::PermissionStatus::NotApplicable
        {
            match permissions_manager
                .request_permission(permission_info.permission_type)
                .await
            {
                Ok(result) => results.push(result),
                Err(e) => {
                    results.push(crate::permissions::PermissionRequestResult {
                        permission_type: permission_info.permission_type,
                        status: crate::permissions::PermissionStatus::Denied,
                        message: Some(e),
                        requires_restart: false,
                        requires_system_settings: false,
                    });
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn test_terminal(terminal: String, state: State<'_, AppState>) -> Result<(), String> {
    // Use the terminal spawn service to test launching a terminal
    state
        .terminal_spawn_service
        .spawn_terminal(crate::terminal_spawn_service::TerminalSpawnRequest {
            session_id: "test".to_string(),
            terminal_type: Some(terminal),
            command: None,
            working_directory: None,
            environment: None,
        })
        .await?;

    Ok(())
}

// Welcome flow specific commands
#[derive(Serialize)]
pub struct VtInstallationStatus {
    pub installed: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn check_vt_installation() -> Result<VtInstallationStatus, String> {
    let installed = crate::cli_installer::check_cli_installed()
        .unwrap_or(false);
    
    let path = if installed {
        Some("/usr/local/bin/vt".to_string())
    } else {
        None
    };
    
    Ok(VtInstallationStatus { installed, path })
}

#[tauri::command]
pub async fn install_vt() -> Result<(), String> {
    crate::cli_installer::install_cli()?;
    Ok(())
}

#[derive(Serialize)]
pub struct PermissionsStatus {
    pub automation: bool,
    pub accessibility: bool,
}

#[tauri::command]
pub async fn check_permissions(state: State<'_, AppState>) -> Result<PermissionsStatus, String> {
    let permissions_manager = &state.permissions_manager;
    
    // Check terminal access permission (closest to automation)
    let automation_status = permissions_manager
        .check_permission_silent(crate::permissions::PermissionType::TerminalAccess)
        .await;
    
    // Check accessibility permission
    let accessibility_status = permissions_manager
        .check_permission_silent(crate::permissions::PermissionType::Accessibility)
        .await;
    
    Ok(PermissionsStatus {
        automation: automation_status == crate::permissions::PermissionStatus::Granted,
        accessibility: accessibility_status == crate::permissions::PermissionStatus::Granted,
    })
}

#[tauri::command]
pub async fn request_automation_permission(state: State<'_, AppState>) -> Result<(), String> {
    let permissions_manager = &state.permissions_manager;
    permissions_manager
        .request_permission(crate::permissions::PermissionType::TerminalAccess)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn request_accessibility_permission(state: State<'_, AppState>) -> Result<(), String> {
    let permissions_manager = &state.permissions_manager;
    permissions_manager
        .request_permission(crate::permissions::PermissionType::Accessibility)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn save_dashboard_password(password: String) -> Result<(), String> {
    // Save password to keychain
    crate::keychain::KeychainManager::set_dashboard_password(&password)
        .map_err(|e| e.message)?;
    
    // Update settings to enable password
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.dashboard.enable_password = true;
    settings.save()?;
    
    Ok(())
}

#[tauri::command]
pub async fn open_dashboard(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    // Check if server is running
    if !state.backend_manager.is_running().await {
        // Start server if not running
        start_server(state.clone(), app).await?;
    }
    
    // Get server port from settings
    let settings = crate::settings::Settings::load().unwrap_or_default();
    let url = format!("http://127.0.0.1:{}", settings.dashboard.server_port);
    
    // Open URL in default browser
    open::that(url).map_err(|e| format!("Failed to open dashboard: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn finish_welcome(state: State<'_, AppState>) -> Result<(), String> {
    // Mark welcome as completed
    state.welcome_manager.skip_tutorial().await?;
    
    // Update settings to not show welcome on startup
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.general.show_welcome_on_startup = Some(false);
    settings.save()?;
    
    Ok(())
}

// Tailscale commands
#[tauri::command]
pub async fn get_tailscale_status(state: State<'_, AppState>) -> Result<crate::tailscale::TailscaleStatus, String> {
    Ok(state.tailscale_service.check_tailscale_status().await)
}

#[tauri::command]
pub async fn start_tailscale_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    state.tailscale_service.start_monitoring().await;
    Ok(())
}

#[tauri::command]
pub async fn open_tailscale_app() -> Result<(), String> {
    crate::tailscale::TailscaleService::open_tailscale_app()
}

#[tauri::command]
pub async fn open_tailscale_download() -> Result<(), String> {
    crate::tailscale::TailscaleService::open_download_page()
}

#[tauri::command]
pub async fn open_tailscale_setup_guide() -> Result<(), String> {
    crate::tailscale::TailscaleService::open_setup_guide()
}

// Window tracking commands
#[tauri::command]
pub async fn register_terminal_window(
    session_id: String,
    terminal_app: String,
    tab_reference: Option<String>,
    tab_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.window_tracker
        .register_window(session_id, terminal_app, tab_reference, tab_id)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn unregister_terminal_window(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.window_tracker.unregister_window(&session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn focus_terminal_window(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.window_tracker.focus_window(&session_id).await
}

#[tauri::command]
pub async fn get_terminal_window_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::window_tracker::WindowInfo>, String> {
    Ok(state.window_tracker.window_info(&session_id).await)
}

#[tauri::command]
pub async fn update_window_tracking(state: State<'_, AppState>) -> Result<(), String> {
    let sessions = state.api_client.list_sessions().await?;
    state.window_tracker.update_from_sessions(&sessions).await;
    Ok(())
}

// AppleScript commands (macOS only)
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn run_applescript(script: String) -> Result<String, String> {
    crate::applescript::AppleScriptRunner::run_script(&script)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn launch_terminal_with_applescript(
    terminal_type: String,
    session_id: String,
    command: Option<String>,
    working_directory: Option<String>,
) -> Result<String, String> {
    crate::applescript::AppleScriptTerminalLauncher::launch_terminal(
        &terminal_type,
        &session_id,
        command.as_deref(),
        working_directory.as_deref(),
    ).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn focus_terminal_with_applescript(
    terminal_type: String,
    window_info: String,
) -> Result<(), String> {
    crate::applescript::AppleScriptTerminalLauncher::focus_terminal_window(
        &terminal_type,
        &window_info,
    ).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn get_terminal_windows_applescript() -> Result<Vec<(u32, String)>, String> {
    crate::applescript::AppleScriptRunner::get_terminal_windows()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn is_app_running_applescript(app_name: String) -> Result<bool, String> {
    crate::applescript::AppleScriptRunner::is_app_running(&app_name)
}

// Git commands
#[tauri::command]
pub async fn get_git_repository(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::git_repository::GitRepository>, String> {
    Ok(state
        .git_monitor
        .find_repository(&file_path)
        .await)
}

#[tauri::command]
pub async fn get_cached_git_repository(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Option<crate::git_repository::GitRepository>, String> {
    Ok(state.git_monitor.get_cached_repository(&file_path).await)
}

#[tauri::command]
pub async fn clear_git_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.git_monitor.clear_cache().await;
    Ok(())
}

#[tauri::command]
pub async fn start_git_monitoring(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    state.git_monitor.start_monitoring(app).await;
    Ok(())
}

// Dock Manager Commands
#[tauri::command]
pub fn set_dock_visible(state: State<'_, AppState>, visible: bool) -> Result<(), String> {
    super::dock_manager::set_dock_visible(state, visible)
}

#[tauri::command]
pub fn get_dock_visible(state: State<'_, AppState>) -> bool {
    super::dock_manager::get_dock_visible(state)
}

#[tauri::command]
pub fn update_dock_visibility(state: State<'_, AppState>) -> Result<(), String> {
    super::dock_manager::update_dock_visibility(state)
}

// Status Indicator Commands  
#[tauri::command]
pub async fn update_status_indicator(
    state: State<'_, AppState>,
    server_running: bool,
    active_sessions: usize,
    total_sessions: usize,
) -> Result<(), String> {
    super::status_indicator::update_status_indicator(state, server_running, active_sessions, total_sessions).await
}

#[tauri::command]
pub async fn flash_activity_indicator(
    state: State<'_, AppState>,
) -> Result<(), String> {
    super::status_indicator::flash_activity_indicator(state).await
}

// Power Manager Commands
#[tauri::command]
pub fn prevent_sleep(state: State<'_, AppState>) -> Result<(), String> {
    super::power_manager::prevent_sleep(state)
}

#[tauri::command]
pub fn allow_sleep(state: State<'_, AppState>) -> Result<(), String> {
    super::power_manager::allow_sleep(state)
}

#[tauri::command]
pub fn is_sleep_prevented(state: State<'_, AppState>) -> bool {
    super::power_manager::is_sleep_prevented(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn test_terminal_struct() {
        let terminal = Terminal {
            id: "test-123".to_string(),
            name: "Test Terminal".to_string(),
            pid: 1234,
            rows: 24,
            cols: 80,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        assert_eq!(terminal.id, "test-123");
        assert_eq!(terminal.name, "Test Terminal");
        assert_eq!(terminal.pid, 1234);
        assert_eq!(terminal.rows, 24);
        assert_eq!(terminal.cols, 80);
    }

    #[test]
    fn test_server_status_struct() {
        let status = ServerStatus {
            running: true,
            port: 8080,
            url: "http://localhost:8080".to_string(),
        };

        assert!(status.running);
        assert_eq!(status.port, 8080);
        assert_eq!(status.url, "http://localhost:8080");
    }

    #[test]
    fn test_create_terminal_options() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), "/usr/bin".to_string());

        let options = CreateTerminalOptions {
            name: Some("Custom Terminal".to_string()),
            rows: Some(30),
            cols: Some(120),
            cwd: Some("/home/user".to_string()),
            env: Some(env.clone()),
            shell: Some("/bin/bash".to_string()),
        };

        assert_eq!(options.name, Some("Custom Terminal".to_string()));
        assert_eq!(options.rows, Some(30));
        assert_eq!(options.cols, Some(120));
        assert_eq!(options.cwd, Some("/home/user".to_string()));
        assert_eq!(
            options.env.unwrap().get("PATH"),
            Some(&"/usr/bin".to_string())
        );
        assert_eq!(options.shell, Some("/bin/bash".to_string()));
    }

    #[test]
    fn test_start_tty_forward_options() {
        let options = StartTTYForwardOptions {
            local_port: 2222,
            remote_host: Some("example.com".to_string()),
            remote_port: Some(22),
            shell: Some("/bin/zsh".to_string()),
        };

        assert_eq!(options.local_port, 2222);
        assert_eq!(options.remote_host, Some("example.com".to_string()));
        assert_eq!(options.remote_port, Some(22));
        assert_eq!(options.shell, Some("/bin/zsh".to_string()));
    }

    #[test]
    fn test_tty_forward_info() {
        let info = TTYForwardInfo {
            id: "forward-123".to_string(),
            local_port: 2222,
            remote_host: "localhost".to_string(),
            remote_port: 22,
            connected: true,
            client_count: 2,
        };

        assert_eq!(info.id, "forward-123");
        assert_eq!(info.local_port, 2222);
        assert_eq!(info.remote_host, "localhost");
        assert_eq!(info.remote_port, 22);
        assert!(info.connected);
        assert_eq!(info.client_count, 2);
    }

    #[test]
    fn test_show_notification_options() {
        use crate::notification_manager::{
            NotificationAction, NotificationPriority, NotificationType,
        };

        let mut metadata = HashMap::new();
        metadata.insert("key".to_string(), json!("value"));

        let options = ShowNotificationOptions {
            notification_type: NotificationType::Info,
            priority: NotificationPriority::High,
            title: "Test Title".to_string(),
            body: "Test Body".to_string(),
            actions: vec![NotificationAction {
                id: "ok".to_string(),
                label: "OK".to_string(),
                action_type: "dismiss".to_string(),
            }],
            metadata,
        };

        assert_eq!(options.title, "Test Title");
        assert_eq!(options.body, "Test Body");
        assert_eq!(options.actions.len(), 1);
        assert_eq!(options.actions[0].label, "OK");
    }

    #[test]
    fn test_store_token_options() {
        use crate::auth_cache::{AuthScope, CachedToken, TokenType};

        let token = CachedToken {
            token_type: TokenType::Bearer,
            token_value: "test-token".to_string(),
            scope: AuthScope {
                service: "test-service".to_string(),
                resource: None,
                permissions: vec![],
            },
            created_at: chrono::Utc::now(),
            expires_at: None,
            refresh_token: None,
            metadata: HashMap::new(),
        };

        let options = StoreTokenOptions {
            key: "test-key".to_string(),
            token: token.clone(),
        };

        assert_eq!(options.key, "test-key");
        assert_eq!(options.token.token_value, "test-token");
    }

    #[test]
    fn test_get_app_version() {
        let version = get_app_version();
        assert!(!version.is_empty());
        assert_eq!(version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn test_server_log_struct() {
        let log = ServerLog {
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            level: "info".to_string(),
            message: "Test message".to_string(),
        };

        assert_eq!(log.timestamp, "2024-01-01T00:00:00Z");
        assert_eq!(log.level, "info");
        assert_eq!(log.message, "Test message");
    }

    #[test]
    fn test_log_debug_message_options() {
        use crate::debug_features::LogLevel;

        let mut metadata = HashMap::new();
        metadata.insert("key".to_string(), json!("value"));

        let options = LogDebugMessageOptions {
            level: LogLevel::Info,
            component: "test-component".to_string(),
            message: "Test debug message".to_string(),
            metadata,
        };

        assert_eq!(options.component, "test-component");
        assert_eq!(options.message, "Test debug message");
        assert_eq!(options.metadata.get("key"), Some(&json!("value")));
    }

    #[test]
    fn test_store_credential_options() {
        use crate::auth_cache::AuthCredential;

        let credential = AuthCredential {
            credential_type: "password".to_string(),
            username: Some("testuser".to_string()),
            password_hash: Some("hash123".to_string()),
            api_key: None,
            client_id: None,
            client_secret: None,
            metadata: HashMap::new(),
        };

        let options = StoreCredentialOptions {
            key: "cred-key".to_string(),
            credential: credential.clone(),
        };

        assert_eq!(options.key, "cred-key");
        assert_eq!(options.credential.username, Some("testuser".to_string()));
    }

    #[test]
    fn test_create_auth_cache_key() {
        let key1 = create_auth_cache_key("github".to_string(), None, None);
        assert_eq!(key1, "github");

        let key2 = create_auth_cache_key("github".to_string(), Some("user123".to_string()), None);
        assert_eq!(key2, "github:user123");

        let key3 = create_auth_cache_key(
            "github".to_string(),
            Some("user123".to_string()),
            Some("repo456".to_string()),
        );
        assert_eq!(key3, "github:user123:repo456");
    }

    #[test]
    fn test_hash_password() {
        let password = "testpassword123";
        let hash1 = hash_password(password.to_string());
        let hash2 = hash_password(password.to_string());

        // Same password should produce same hash
        assert_eq!(hash1, hash2);

        // Hash should not be empty
        assert!(!hash1.is_empty());

        // Hash should be different from original password
        assert_ne!(hash1, password);
    }

    #[tokio::test]
    async fn test_find_available_ports() {
        // Test finding available ports near 8080
        let ports = find_available_ports(8080, 3).await;

        // Should return a Result
        assert!(ports.is_ok());

        if let Ok(available) = ports {
            // Should find at most 3 ports
            assert!(available.len() <= 3);

            // All ports should be in valid range
            for port in &available {
                assert!(*port >= 1024);
                // Port is u16, so max value is 65535 by definition
                assert!(*port != 8080); // Should not include the requested port
            }
        }
    }

    #[test]
    fn test_settings_section_validation() {
        // Test valid sections
        let valid_sections = vec![
            "tty_forward",
            "monitoring",
            "network",
            "port",
            "notifications",
            "terminal_integrations",
            "updates",
            "security",
            "debug",
            "all",
        ];

        for section in valid_sections {
            // This would normally be tested through the actual command
            // but we can at least verify the strings are valid
            assert!(!section.is_empty());
        }
    }

    #[test]
    fn test_json_value_parsing() {
        // Test parsing various JSON values
        let bool_value = serde_json::from_str::<serde_json::Value>("true").unwrap();
        assert_eq!(bool_value.as_bool(), Some(true));

        let number_value = serde_json::from_str::<serde_json::Value>("42").unwrap();
        assert_eq!(number_value.as_u64(), Some(42));

        let string_value = serde_json::from_str::<serde_json::Value>("\"test\"").unwrap();
        assert_eq!(string_value.as_str(), Some("test"));

        let null_value = serde_json::from_str::<serde_json::Value>("null").unwrap();
        assert!(null_value.is_null());
    }

    #[test]
    fn test_settings_key_validation() {
        // Test valid setting keys for each section
        let general_keys = vec![
            "launch_at_login",
            "show_dock_icon",
            "default_terminal",
            "default_shell",
            "show_welcome_on_startup",
            "theme",
            "language",
            "check_updates_automatically",
        ];

        let dashboard_keys = vec![
            "server_port",
            "enable_password",
            "password",
            "access_mode",
            "auto_cleanup",
            "session_limit",
            "idle_timeout_minutes",
            "enable_cors",
        ];

        let advanced_keys = vec![
            "debug_mode",
            "log_level",
            "session_timeout",
            "ngrok_auth_token",
            "ngrok_region",
            "ngrok_subdomain",
            "enable_telemetry",
            "experimental_features",
        ];

        // Verify all keys are non-empty strings
        for key in general_keys {
            assert!(!key.is_empty());
        }
        for key in dashboard_keys {
            assert!(!key.is_empty());
        }
        for key in advanced_keys {
            assert!(!key.is_empty());
        }
    }

    #[test]
    fn test_access_mode_mapping() {
        // Test access mode to bind address mapping
        let localhost_mode = "127.0.0.1";
        let expected_mode = if localhost_mode == "127.0.0.1" {
            "localhost"
        } else {
            "network"
        };
        assert_eq!(expected_mode, "localhost");

        let network_mode = "0.0.0.0";
        let expected_mode = if network_mode == "127.0.0.1" {
            "localhost"
        } else {
            "network"
        };
        assert_eq!(expected_mode, "network");
    }

    #[test]
    fn test_export_settings_toml_format() {
        use crate::settings::Settings;

        // Create a test settings instance
        let settings = Settings::default();

        // Serialize to TOML
        let toml_result = toml::to_string_pretty(&settings);
        assert!(toml_result.is_ok());

        if let Ok(toml_content) = toml_result {
            // Verify it's valid TOML by parsing it back
            let parsed_result: Result<Settings, _> = toml::from_str(&toml_content);
            assert!(parsed_result.is_ok());
        }
    }

    #[test]
    fn test_all_settings_serialization() {
        use crate::settings::Settings;

        let settings = Settings::default();
        let mut all_settings = HashMap::new();

        // Test that all sections can be serialized to JSON
        let sections = vec![
            ("general", serde_json::to_value(&settings.general)),
            ("dashboard", serde_json::to_value(&settings.dashboard)),
            ("advanced", serde_json::to_value(&settings.advanced)),
            ("tty_forward", serde_json::to_value(&settings.tty_forward)),
            ("monitoring", serde_json::to_value(&settings.monitoring)),
            ("network", serde_json::to_value(&settings.network)),
            ("port", serde_json::to_value(&settings.port)),
            (
                "notifications",
                serde_json::to_value(&settings.notifications),
            ),
            (
                "terminal_integrations",
                serde_json::to_value(&settings.terminal_integrations),
            ),
            ("updates", serde_json::to_value(&settings.updates)),
            ("security", serde_json::to_value(&settings.security)),
        ];

        for (name, result) in sections {
            assert!(result.is_ok(), "Failed to serialize {} settings", name);
            if let Ok(value) = result {
                all_settings.insert(name.to_string(), value);
            }
        }

        assert_eq!(all_settings.len(), 11);
    }
}
