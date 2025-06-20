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
mod cast;
mod tty_forward;
mod session_monitor;
mod port_conflict;
mod network_utils;
mod notification_manager;
mod welcome;
mod permissions;
mod updater;
mod backend_manager;
mod debug_features;
mod api_testing;
mod auth_cache;
mod terminal_integrations;
mod app_mover;
mod terminal_spawn_service;
mod fs_api;

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
        .resizable(true)
        .decorations(true)
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
            start_terminal_recording,
            stop_terminal_recording,
            save_terminal_recording,
            get_recording_status,
            start_tty_forward,
            stop_tty_forward,
            list_tty_forwards,
            get_tty_forward,
            get_session_stats,
            get_monitored_sessions,
            start_session_monitoring,
            check_port_availability,
            detect_port_conflict,
            resolve_port_conflict,
            force_kill_process,
            find_available_ports,
            get_local_ip_address,
            get_all_ip_addresses,
            get_network_interfaces,
            get_hostname,
            test_network_connectivity,
            get_network_stats,
            show_notification,
            get_notifications,
            get_notification_history,
            mark_notification_as_read,
            mark_all_notifications_as_read,
            clear_notification,
            clear_all_notifications,
            get_unread_notification_count,
            update_notification_settings,
            get_notification_settings,
            get_welcome_state,
            should_show_welcome,
            get_tutorials,
            get_tutorial_category,
            complete_tutorial_step,
            skip_tutorial,
            reset_tutorial,
            get_tutorial_progress,
            show_welcome_window,
            get_recording_settings,
            save_recording_settings,
            get_all_advanced_settings,
            update_advanced_settings,
            reset_settings_section,
            export_settings,
            import_settings,
            check_all_permissions,
            check_permission,
            request_permission,
            get_permission_info,
            get_all_permissions,
            get_required_permissions,
            get_missing_required_permissions,
            all_required_permissions_granted,
            open_system_permission_settings,
            get_permission_stats,
            check_for_updates,
            download_update,
            install_update,
            cancel_update,
            get_update_state,
            get_updater_settings,
            update_updater_settings,
            switch_update_channel,
            get_update_history,
            get_available_backends,
            get_backend_config,
            is_backend_installed,
            install_backend,
            start_backend,
            stop_backend,
            switch_backend,
            get_active_backend,
            get_backend_instances,
            check_backend_health,
            get_backend_stats,
            get_debug_settings,
            update_debug_settings,
            log_debug_message,
            record_performance_metric,
            take_memory_snapshot,
            get_debug_logs,
            get_performance_metrics,
            get_memory_snapshots,
            get_network_requests,
            run_api_tests,
            run_benchmarks,
            generate_diagnostic_report,
            clear_debug_data,
            set_debug_mode,
            get_debug_stats,
            get_api_test_config,
            update_api_test_config,
            add_api_test_suite,
            get_api_test_suite,
            list_api_test_suites,
            run_single_api_test,
            run_api_test_suite,
            get_api_test_history,
            clear_api_test_history,
            import_postman_collection,
            export_api_test_suite,
            get_auth_cache_config,
            update_auth_cache_config,
            store_auth_token,
            get_auth_token,
            store_auth_credential,
            get_auth_credential,
            clear_auth_cache_entry,
            clear_all_auth_cache,
            get_auth_cache_stats,
            list_auth_cache_entries,
            export_auth_cache,
            import_auth_cache,
            hash_password,
            create_auth_cache_key,
            detect_installed_terminals,
            get_default_terminal,
            set_default_terminal,
            launch_terminal_emulator,
            get_terminal_config,
            update_terminal_config,
            list_detected_terminals,
            create_terminal_ssh_url,
            get_terminal_integration_stats,
            // Settings UI Commands
            get_all_settings,
            update_setting,
            set_dashboard_password,
            restart_server_with_port,
            update_server_bind_address,
            set_dock_icon_visibility,
            set_log_level,
            test_api_endpoint,
            get_server_logs,
            export_logs,
            get_local_ip,
            detect_terminals,
            // App Mover Commands
            app_mover::prompt_move_to_applications,
            app_mover::is_in_applications_folder,
            // Terminal Spawn Service Commands
            terminal_spawn_service::spawn_terminal_for_session,
            terminal_spawn_service::spawn_terminal_with_command,
            terminal_spawn_service::spawn_custom_terminal,
        ])
        .setup(|app| {
            // Set app handle in managers
            let state = app.state::<AppState>();
            let notification_manager = state.notification_manager.clone();
            let welcome_manager = state.welcome_manager.clone();
            let permissions_manager = state.permissions_manager.clone();
            let update_manager = state.update_manager.clone();
            let app_handle = app.handle().clone();
            let app_handle2 = app.handle().clone();
            let app_handle3 = app.handle().clone();
            let app_handle4 = app.handle().clone();
            let app_handle_for_move = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                notification_manager.set_app_handle(app_handle).await;
                welcome_manager.set_app_handle(app_handle2).await;
                permissions_manager.set_app_handle(app_handle3).await;
                update_manager.set_app_handle(app_handle4).await;
                
                // Load welcome state and check if should show welcome
                let _ = welcome_manager.load_state().await;
                if welcome_manager.should_show_welcome().await {
                    let _ = welcome_manager.show_welcome_window().await;
                }
                
                // Check permissions on startup
                let _ = permissions_manager.check_all_permissions().await;
                
                // Check if app should be moved to Applications folder (macOS only)
                #[cfg(target_os = "macos")]
                {
                    let app_handle_move = app_handle_for_move.clone();
                    tokio::spawn(async move {
                        // Small delay to let the app fully initialize
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        let _ = app_mover::check_and_prompt_move(app_handle_move).await;
                    });
                }
                
                // Load updater settings and start auto-check
                let _ = update_manager.load_settings().await;
                update_manager.clone().start_auto_check().await;
            });

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
            
            // Show notification
            let _ = state.notification_manager.notify_server_status(true, status.port).await;
        }
        Err(e) => {
            tracing::error!("Failed to start server: {}", e);
            let _ = state.notification_manager.notify_error(
                "Server Start Failed",
                &format!("Failed to start server: {}", e)
            ).await;
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
                                let _ = window.emit("server:restarted", &status);
                            }
                            
                            // Show notification
                            let _ = monitoring_state.notification_manager.notify_server_status(true, status.port).await;
                        }
                        Err(e) => {
                            tracing::error!("Failed to restart server: {}", e);
                            let _ = monitoring_state.notification_manager.notify_error(
                                "Server Restart Failed",
                                &format!("Failed to restart server: {}", e)
                            ).await;
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
                                let _ = window.emit("server:restarted", &status);
                            }
                            
                            // Show notification
                            let _ = monitoring_state.notification_manager.notify_server_status(true, status.port).await;
                        }
                        Err(e) => {
                            tracing::error!("Failed to start server: {}", e);
                            let _ = monitoring_state.notification_manager.notify_error(
                                "Server Start Failed",
                                &format!("Failed to start server: {}", e)
                            ).await;
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