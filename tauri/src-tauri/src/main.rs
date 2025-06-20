#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{AppHandle, Manager, Emitter, WindowEvent};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::Menu;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod commands;
mod terminal;
mod server;
mod state;
mod settings;
mod auto_launch;
mod ngrok;
mod terminal_detector;
mod cli_installer;
mod auth;
mod tray_menu;

use commands::*;
use state::AppState;
use server::HttpServer;
use commands::ServerStatus;

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    // Check if settings window already exists
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create new settings window
        tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("settings.html".into())
        )
        .title("VibeTunnel Settings")
        .inner_size(800.0, 600.0)
        .resizable(false)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn update_tray_menu_status(_app: &AppHandle, port: u16, _session_count: usize) {
    // For now, just log the status update
    // TODO: In Tauri v2, dynamic menu updates require rebuilding the menu
    tracing::info!("Server status updated: port {}", port);
}

fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vibetunnel=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main_window(app.app_handle().clone());
        }))
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            list_terminals,
            close_terminal,
            resize_terminal,
            write_to_terminal,
            read_from_terminal,
            start_server,
            stop_server,
            get_server_status,
            get_app_version,
            restart_server,
            show_server_console,
            show_welcome_screen,
            purge_all_settings,
            update_dock_icon_visibility,
            show_main_window,
            open_settings_window,
            quit_app,
            settings::get_settings,
            settings::save_settings,
            auto_launch::set_auto_launch,
            auto_launch::get_auto_launch,
            ngrok::start_ngrok_tunnel,
            ngrok::stop_ngrok_tunnel,
            ngrok::get_ngrok_status,
            terminal_detector::detect_system_terminals,
            terminal_detector::get_default_shell,
            cli_installer::install_cli,
            cli_installer::uninstall_cli,
            cli_installer::check_cli_installed,
        ])
        .setup(|app| {
            // Create system tray icon using menu-bar-icon.png with template mode
            let icon_path = app.path().resource_dir().unwrap().join("icons/menu-bar-icon.png");
            let tray_icon = if let Ok(icon_data) = std::fs::read(&icon_path) {
                tauri::image::Image::from_bytes(&icon_data).ok()
            } else {
                // Fallback to default icon if menu-bar-icon.png not found
                app.default_window_icon().cloned()
            };

            if let Some(icon) = tray_icon {
                // Create enhanced tray menu
                let menu = tray_menu::TrayMenuManager::create_menu(&app.handle())?;

                // Build tray icon with template mode for macOS
                let _tray = TrayIconBuilder::with_id("main")
                    .icon(icon)
                    .icon_as_template(true) // Enable template mode for proper macOS tinting
                    .tooltip("VibeTunnel")
                    .menu(&menu)
                    .on_menu_event(move |app, event| {
                        handle_tray_menu_event(app, event.id.as_ref());
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            // Get server status and open dashboard in browser
                            let app = tray.app_handle();
                            let state = app.state::<AppState>();
                            let server_guard = state.http_server.blocking_read();
                            if let Some(server) = server_guard.as_ref() {
                                let url = format!("http://localhost:{}", server.port());
                                let _ = open::that(url);
                            }
                        }
                    })
                    .build(app)?;
            }

            // Load settings to determine initial dock icon visibility
            let settings = settings::Settings::load().unwrap_or_default();
            
            // Check if launched at startup (auto-launch)
            let is_auto_launched = std::env::args().any(|arg| arg == "--auto-launch" || arg == "--minimized");
            
            let window = app.get_webview_window("main").unwrap();
            
            // Hide window if auto-launched
            if is_auto_launched {
                window.hide()?;
                
                // On macOS, apply dock icon visibility based on settings
                #[cfg(target_os = "macos")]
                {
                    if !settings.general.show_dock_icon {
                        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
            } else {
                // If not auto-launched but dock icon should be hidden, hide it
                #[cfg(target_os = "macos")]
                {
                    if !settings.general.show_dock_icon {
                        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
            }

            // Handle window close event to hide instead of quit
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                    
                    // Hide dock icon on macOS when window is hidden (only if settings say so)
                    #[cfg(target_os = "macos")]
                    {
                        if let Ok(settings) = settings::Settings::load() {
                            if !settings.general.show_dock_icon {
                                let _ = window_clone.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
                            }
                        }
                    }
                }
            });

            // Auto-start server with monitoring
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_server_with_monitoring(app_handle).await;
            });

            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn create_app_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // Create the menu using the builder pattern
    let menu = Menu::new(app)?;
    
    // For now, return a basic menu
    // TODO: Once we understand the correct Tauri v2 menu API, implement full menu
    Ok(menu)
}

fn handle_tray_menu_event(app: &AppHandle, event_id: &str) {
    match event_id {
        "dashboard" => {
            // Get server status and open dashboard in browser
            let state = app.state::<AppState>();
            let server_guard = state.http_server.blocking_read();
            if let Some(server) = server_guard.as_ref() {
                let url = format!("http://localhost:{}", server.port());
                let _ = open::that(url);
            }
        }
        "show_tutorial" => {
            // Show onboarding/tutorial
            let _ = show_main_window(app.clone());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu:show-tutorial", ());
            }
        }
        "website" => {
            let _ = open::that("https://vibetunnel.sh");
        }
        "report_issue" => {
            let _ = open::that("https://github.com/vibetunnel/vibetunnel/issues");
        }
        "check_updates" => {
            // TODO: Implement update check
            tracing::info!("Check for updates");
        }
        "about" => {
            // TODO: Show about dialog
            tracing::info!("About VibeTunnel");
        }
        "settings" => {
            // Open native settings window
            let _ = open_settings_window(app.clone());
        }
        "quit" => {
            quit_app(app.clone());
        }
        _ => {}
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "settings" => {
            // Show main window and emit settings event
            let _ = show_main_window(app.clone());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu:settings", ());
            }
        }
        "new-terminal" => {
            // Show main window first
            let _ = show_main_window(app.clone());
            // Emit event to frontend to create new terminal
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu:new-terminal", ());
            }
        }
        "reload" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        "show-dashboard" => {
            let _ = show_main_window(app.clone());
        }
        "quit" => {
            quit_app(app.clone());
        }
        "hide" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        "minimize" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.minimize();
            }
        }
        "zoom" => {
            if let Some(window) = app.get_webview_window("main") {
                // Toggle maximize state
                if window.is_maximized().unwrap_or(false) {
                    let _ = window.unmaximize();
                } else {
                    let _ = window.maximize();
                }
            }
        }
        "fullscreen" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
            }
        }
        "close-window" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "cut" | "copy" | "paste" | "select-all" | "undo" | "redo" => {
            // These are handled by the system automatically for text fields
            // For terminal, we'll emit events
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit(&format!("menu:{}", event.id.as_ref()), ());
            }
        }
        _ => {}
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        
        // Show dock icon on macOS when window is shown
        #[cfg(target_os = "macos")]
        {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        }
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    // Stop monitoring before exit
    let state = app.state::<AppState>();
    state.server_monitoring.store(false, std::sync::atomic::Ordering::Relaxed);
    app.exit(0);
}

async fn start_server_with_monitoring(app_handle: AppHandle) {
    let state = app_handle.state::<AppState>();
    let state_clone = state.inner().clone();
    
    // Start initial server
    match start_server_internal(&*state).await {
        Ok(status) => {
            tracing::info!("Server started on port {}", status.port);
            *state.server_target_port.write().await = Some(status.port);
            
            // Update tray menu with server status
            update_tray_menu_status(&app_handle, status.port, 0);
        }
        Err(e) => {
            tracing::error!("Failed to start server: {}", e);
        }
    }
    
    // Monitor server health
    let monitoring_state = state_clone.clone();
    let monitoring_app = app_handle.clone();
    
    tauri::async_runtime::spawn(async move {
        let mut check_interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
        
        while monitoring_state.server_monitoring.load(std::sync::atomic::Ordering::Relaxed) {
            check_interval.tick().await;
            
            // Check if server is still running
            let server_running = {
                let server = monitoring_state.http_server.read().await;
                server.is_some()
            };
            
            if server_running {
                // Perform health check
                let health_check_result = perform_server_health_check(&monitoring_state).await;
                
                if !health_check_result {
                    tracing::warn!("Server health check failed, attempting restart...");
                    
                    // Stop current server
                    let _ = stop_server_internal(&monitoring_state).await;
                    
                    // Wait a bit before restart
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    
                    // Restart server
                    match start_server_internal(&monitoring_state).await {
                        Ok(status) => {
                            tracing::info!("Server restarted on port {}", status.port);
                            *monitoring_state.server_target_port.write().await = Some(status.port);
                            
                            // Update tray menu with server status
                            update_tray_menu_status(&monitoring_app, status.port, 0);
                            
                            // Notify frontend of server restart
                            if let Some(window) = monitoring_app.get_webview_window("main") {
                                let _ = window.emit("server:restarted", status);
                            }
                        }
                        Err(e) => {
                            tracing::error!("Failed to restart server: {}", e);
                        }
                    }
                }
            } else {
                // Server is not running, attempt to start it
                let target_port = *monitoring_state.server_target_port.read().await;
                if target_port.is_some() {
                    tracing::info!("Server not running, attempting to start...");
                    
                    match start_server_internal(&monitoring_state).await {
                        Ok(status) => {
                            tracing::info!("Server started on port {}", status.port);
                            
                            // Notify frontend of server restart
                            if let Some(window) = monitoring_app.get_webview_window("main") {
                                let _ = window.emit("server:restarted", status);
                            }
                        }
                        Err(e) => {
                            tracing::error!("Failed to start server: {}", e);
                        }
                    }
                }
            }
        }
        
        tracing::info!("Server monitoring stopped");
    });
}

async fn perform_server_health_check(state: &AppState) -> bool {
    // Try to get server status
    match get_server_status_internal(state).await {
        Ok(status) if status.running => {
            // Server reports as running, perform additional check
            // by trying to access the API endpoint
            let url = format!("http://localhost:{}/api/sessions", status.port);
            
            match reqwest::Client::new()
                .get(&url)
                .timeout(std::time::Duration::from_secs(2))
                .send()
                .await
            {
                Ok(response) => response.status().is_success(),
                Err(_) => false,
            }
        }
        _ => false,
    }
}

// Internal server management functions that work directly with AppState
async fn start_server_internal(state: &AppState) -> Result<ServerStatus, String> {
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

async fn stop_server_internal(state: &AppState) -> Result<(), String> {
    let mut server = state.http_server.write().await;
    
    if let Some(mut http_server) = server.take() {
        http_server.stop().await?;
    }
    
    // Also stop ngrok tunnel if active
    let _ = state.ngrok_manager.stop_tunnel().await;
    
    Ok(())
}

async fn get_server_status_internal(state: &AppState) -> Result<ServerStatus, String> {
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