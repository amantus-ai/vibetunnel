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
        HttpServer::with_auth(state.terminal_manager.clone(), auth_config)
    } else {
        HttpServer::new(state.terminal_manager.clone())
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
    let settings = crate::settings::Settings::load().unwrap_or_default();
    
    let mut new_server = HttpServer::new(terminal_manager);
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
        .title("Server Console")
        .inner_size(800.0, 600.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn show_welcome_screen(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Check if welcome window already exists
    if let Some(window) = app_handle.get_webview_window("welcome") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create new welcome window
        tauri::WebviewWindowBuilder::new(
            &app_handle,
            "welcome",
            tauri::WebviewUrl::App("welcome.html".into())
        )
        .title("Welcome to VibeTunnel")
        .inner_size(700.0, 500.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
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