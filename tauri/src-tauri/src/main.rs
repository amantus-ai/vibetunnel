#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::menu::Menu;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api_client;
mod api_testing;
mod app_mover;
#[cfg(target_os = "macos")]
mod applescript;
mod auth_cache;
mod auto_launch;
mod backend_manager;
mod cli_installer;
mod commands;
mod debug_features;
mod dock_manager;
mod errors;
mod fs_api;
mod git_app_launcher;
pub mod git_monitor;
pub mod git_repository;
mod keychain;
mod log_collector;
mod menubar_popover;
mod network_utils;
mod ngrok;
mod notification_manager;
mod permissions;
mod port_conflict;
mod power_manager;
mod process_tracker;
mod session_monitor;
mod status_indicator;
mod settings;
mod state;
mod tailscale;
mod terminal;
mod terminal_detector;
mod terminal_integrations;
mod terminal_spawn_service;
mod tray_menu;
mod tty_forward;
#[cfg(unix)]
mod unix_socket_server;
mod updater;
mod url_scheme;
mod welcome;
mod window_enumerator;
mod window_matcher;
mod window_tracker;

use commands::ServerStatus;
use commands::*;
use state::AppState;

#[tauri::command]
fn open_settings_window(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    tracing::info!("Opening settings window");
    
    // Build URL with optional tab parameter
    let url = if let Some(tab_name) = tab {
        format!("settings.html?tab={}", tab_name)
    } else {
        "settings.html".to_string()
    };

    // Check if settings window already exists
    if let Some(window) = app.get_webview_window("settings") {
        // Navigate to the URL with the tab parameter if window exists
        window
            .eval(&format!("window.location.href = '{}'", url))
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create new settings window
        tracing::info!("Creating new settings window with URL: {}", url);
        let window =
            tauri::WebviewWindowBuilder::new(&app, "settings", tauri::WebviewUrl::App(url.into()))
                .title("VibeTunnel Settings")
                .inner_size(1200.0, 800.0)
                .resizable(true)
                .decorations(true)
                .center()
                .build()
                .map_err(|e| {
                    tracing::error!("Failed to create settings window: {}", e);
                    e.to_string()
                })?;
        
        tracing::info!("Settings window created successfully");

        // Handle close event to destroy the window
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let _ = window_clone.close();
            }
        });
    }
    Ok(())
}

#[tauri::command]
fn focus_terminal_window_legacy(session_id: String) -> Result<(), String> {
    // Focus the terminal window for the given session
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Use AppleScript to focus the terminal window
        let script = format!(
            r#"tell application "System Events"
                set allProcesses to name of every process
                if "Terminal" is in allProcesses then
                    tell application "Terminal"
                        activate
                        repeat with w in windows
                            if name of w contains "{}" then
                                set index of w to 1
                                return
                            end if
                        end repeat
                    end tell
                end if
            end tell"#,
            session_id
        );

        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("AppleScript failed: {}", error));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On other platforms, we can try to use wmctrl or similar tools
        // For now, just return an error
        return Err("Terminal window focus not implemented for this platform".to_string());
    }

    Ok(())
}

#[tauri::command]
fn open_session_detail_window(app: AppHandle, session_id: String) -> Result<(), String> {
    // Build URL with session ID parameter
    let url = format!("session-detail.html?id={}", session_id);
    let window_id = format!("session-detail-{}", session_id);

    // Check if session detail window already exists for this session
    if let Some(window) = app.get_webview_window(&window_id) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Create new session detail window
        let window =
            tauri::WebviewWindowBuilder::new(&app, window_id, tauri::WebviewUrl::App(url.into()))
                .title("Session Details")
                .inner_size(600.0, 450.0)
                .resizable(true)
                .decorations(true)
                .center()
                .build()
                .map_err(|e| e.to_string())?;

        // Handle close event to destroy the window
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let _ = window_clone.close();
            }
        });
    }
    Ok(())
}

fn update_tray_menu_status(app: &AppHandle, port: u16, session_count: usize) {
    // Update tray menu status using the tray menu manager
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tray_menu::TrayMenuManager::update_server_status(&app_handle, port, true).await;
        tray_menu::TrayMenuManager::update_session_count(&app_handle, session_count).await;
    });
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
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Don't show main window on startup - app runs in system tray
            // let _ = show_main_window(app.app_handle().clone());
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
            get_os,
            restart_server,
            show_server_console,
            show_welcome_screen,
            purge_all_settings,
            update_dock_icon_visibility,
            show_main_window,
            open_settings_window,
            open_session_detail_window,
            focus_terminal_window_legacy,
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
            get_all_advanced_settings,
            update_advanced_settings,
            reset_settings_section,
            export_settings,
            import_settings,
            check_all_permissions,
            check_permission,
            check_permission_silent,
            request_permission,
            get_permission_info,
            get_all_permissions,
            get_required_permissions,
            get_missing_required_permissions,
            all_required_permissions_granted,
            open_system_permission_settings,
            get_permission_stats,
            register_permission_monitoring,
            unregister_permission_monitoring,
            show_permission_alert,
            check_for_updates,
            download_update,
            install_update,
            cancel_update,
            get_update_state,
            get_updater_settings,
            update_updater_settings,
            switch_update_channel,
            get_update_history,
            // Multi-backend commands not applicable to Node.js subprocess
            // get_available_backends,
            // get_backend_config,
            // is_backend_installed,
            // install_backend,
            // start_backend,
            // stop_backend,
            // switch_backend,
            // get_active_backend,
            // get_backend_instances,
            // check_backend_health,
            // get_backend_stats,
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
            clear_debug_logs,
            clear_network_requests,
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
            app_mover::is_in_applications_folder_command,
            // Terminal Spawn Service Commands
            terminal_spawn_service::spawn_terminal_for_session,
            terminal_spawn_service::spawn_terminal_with_command,
            terminal_spawn_service::spawn_custom_terminal,
            // Keychain Commands
            keychain_set_password,
            keychain_get_password,
            keychain_delete_password,
            keychain_set_dashboard_password,
            keychain_get_dashboard_password,
            keychain_delete_dashboard_password,
            keychain_set_ngrok_auth_token,
            keychain_get_ngrok_auth_token,
            keychain_delete_ngrok_auth_token,
            keychain_list_keys,
            // Welcome flow commands
            request_all_permissions,
            test_terminal,
            check_vt_installation,
            install_vt,
            check_permissions,
            request_automation_permission,
            request_accessibility_permission,
            save_dashboard_password,
            open_dashboard,
            finish_welcome,
            open_folder,
            // Tailscale commands
            get_tailscale_status,
            start_tailscale_monitoring,
            open_tailscale_app,
            open_tailscale_download,
            open_tailscale_setup_guide,
            // Window tracking commands
            register_terminal_window,
            unregister_terminal_window,
            focus_terminal_window,
            get_terminal_window_info,
            update_window_tracking,
            // AppleScript commands (macOS only)
            #[cfg(target_os = "macos")]
            run_applescript,
            #[cfg(target_os = "macos")]
            launch_terminal_with_applescript,
            #[cfg(target_os = "macos")]
            focus_terminal_with_applescript,
            #[cfg(target_os = "macos")]
            get_terminal_windows_applescript,
            #[cfg(target_os = "macos")]
            is_app_running_applescript,
            // Git commands
            get_git_repository,
            get_cached_git_repository,
            clear_git_cache,
            start_git_monitoring,
            // Git app launcher commands
            git_app_launcher::get_installed_git_apps,
            git_app_launcher::get_preferred_git_app,
            git_app_launcher::set_preferred_git_app,
            git_app_launcher::open_repository_in_git_app,
            git_app_launcher::verify_git_app_installation,
            // URL scheme commands
            url_scheme::handle_url_scheme,
            url_scheme::parse_url_scheme,
            // Menubar popover commands
            menubar_popover::show_menubar_popover,
            menubar_popover::hide_menubar_popover,
            menubar_popover::toggle_menubar_popover,
            // Server log commands
            clear_server_logs,
            // Dock manager commands
            set_dock_visible,
            get_dock_visible,
            update_dock_visibility,
            // Status indicator commands
            update_status_indicator,
            flash_activity_indicator,
            // Power manager commands
            prevent_sleep,
            allow_sleep,
            is_sleep_prevented,
        ])
        .setup(|app| {
            // Set app handle in managers
            let state_clone = app.state::<AppState>().inner().clone();
            let app_handle = app.handle().clone();
            let app_handle2 = app.handle().clone();
            let app_handle3 = app.handle().clone();
            let app_handle4 = app.handle().clone();
            let app_handle_for_move = app.handle().clone();
            let app_handle_for_url_scheme = app.handle().clone();
            let app_handle_for_log_collector = app.handle().clone();
            let app_handle_for_state = app.handle().clone();
            let app_handle_for_dock = app.handle().clone();
            let app_handle_for_status = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let state = state_clone;
                state.notification_manager.set_app_handle(app_handle).await;
                state.welcome_manager.set_app_handle(app_handle2).await;
                state.permissions_manager.set_app_handle(app_handle3).await;
                state.update_manager.set_app_handle(app_handle4).await;
                
                // Set app handles for new managers
                state.set_app_handle(app_handle_for_state).await;
                state.dock_manager.on_window_created(&app_handle_for_dock);
                state.status_indicator.set_app_handle(app_handle_for_status);

                // Initialize log collector
                log_collector::init_log_collector(app_handle_for_log_collector).await;
                
                // Start background workers now that we have a runtime
                state.terminal_spawn_service.clone().start_worker().await;
                state.auth_cache_manager.start_cleanup_task().await;

                // Start Unix socket server for terminal spawning (macOS/Linux)
                #[cfg(unix)]
                {
                    if let Err(e) = state.unix_socket_server.start() {
                        tracing::error!("Failed to start Unix socket server: {}", e);
                    }
                }

                // Start session monitoring
                state.session_monitor.start_monitoring().await;

                // Load welcome state and check if should show welcome
                let _ = state.welcome_manager.load_state().await;
                if state.welcome_manager.should_show_welcome().await {
                    let _ = state.welcome_manager.show_welcome_window().await;
                }

                // Check permissions on startup
                let _ = state.permissions_manager.check_all_permissions().await;

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
                let _ = state.update_manager.load_settings().await;
                state.update_manager.clone().start_auto_check().await;
                
                // Start Git repository monitoring
                let git_app_handle = app_handle_for_move.clone();
                state.git_monitor.start_monitoring(git_app_handle).await;
                
                // Start Tailscale monitoring
                state.tailscale_service.start_monitoring().await;
                // Check initial status
                let _ = state.tailscale_service.check_tailscale_status().await;
                
                // Start window tracking updates
                let window_tracker = state.window_tracker.clone();
                let api_client = state.api_client.clone();
                tokio::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
                    loop {
                        interval.tick().await;
                        if let Ok(sessions) = api_client.list_sessions().await {
                            window_tracker.update_from_sessions(&sessions).await;
                        }
                    }
                });
            });
            
            // Set up URL scheme handler for deep links
            url_scheme::URLSchemeHandler::setup_deep_link_handler(app_handle_for_url_scheme);

            // Create system tray icon using tray-icon.png for macOS (menu-bar-icon.png is for Windows/Linux)
            let tray_icon = if let Ok(resource_dir) = app.path().resource_dir() {
                // On macOS, use tray-icon.png which has the proper design for the menu bar
                let icon_name = if cfg!(target_os = "macos") {
                    "tray-icon.png"
                } else {
                    "menu-bar-icon.png"
                };

                let icon_path = resource_dir.join(icon_name);
                if let Ok(icon_data) = std::fs::read(&icon_path) {
                    tauri::image::Image::from_bytes(&icon_data).ok()
                } else {
                    // Try alternative path
                    let icon_path2 = resource_dir.join("icons").join(icon_name);
                    if let Ok(icon_data) = std::fs::read(&icon_path2) {
                        tauri::image::Image::from_bytes(&icon_data).ok()
                    } else {
                        // Fallback to default icon
                        app.default_window_icon().cloned()
                    }
                }
            } else {
                // Fallback to default icon if resource dir not found
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
                        match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                position,
                                ..
                            } => {
                                // Show custom menubar popover on left click
                                let app = tray.app_handle();
                                
                                // Update popover position based on tray icon location
                                let _ = menubar_popover::MenubarPopover::update_position(&app, position.x, position.y);
                                
                                // Toggle the popover
                                let _ = menubar_popover::MenubarPopover::toggle(&app);
                            }
                            TrayIconEvent::Click {
                                button: MouseButton::Right,
                                button_state: MouseButtonState::Up,
                                ..
                            } => {
                                // Right click shows the traditional menu
                                // The menu is already set, so it will show automatically
                            }
                            _ => {}
                        }
                    })
                    .build(app)?;
            }

            // Load settings to determine initial dock icon visibility
            let _settings = settings::Settings::load().unwrap_or_default();

            // Set initial dock icon visibility on macOS
            #[cfg(target_os = "macos")]
            {
                // Force dock icon to be visible for debugging
                app.set_activation_policy(tauri::ActivationPolicy::Regular);
                // if !settings.general.show_dock_icon {
                //     app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                // }
            }

            // Show settings window for debugging
            #[cfg(debug_assertions)]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Wait a bit for the app to fully initialize
                    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                    // Open settings window
                    if let Err(e) = open_settings_window(app_handle, None) {
                        tracing::error!("Failed to open settings window: {}", e);
                    }
                });
            }

            // Auto-start server with monitoring
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tracing::info!("Starting server with monitoring...");
                start_server_with_monitoring(app_handle).await;
            });

            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
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
            let backend_manager = state.backend_manager.clone();
            tauri::async_runtime::spawn(async move {
                if backend_manager.is_running().await {
                    let settings = crate::settings::Settings::load().unwrap_or_default();
                    let url = format!("http://127.0.0.1:{}", settings.dashboard.server_port);
                    let _ = open::that(url);
                }
            });
        }
        "show_tutorial" => {
            // Show welcome window instead
            let state = app.state::<AppState>();
            let welcome_manager = state.welcome_manager.clone();
            tauri::async_runtime::spawn(async move {
                let _ = welcome_manager.show_welcome_window().await;
            });
        }
        "website" => {
            let _ = open::that("https://vibetunnel.sh");
        }
        "report_issue" => {
            let _ = open::that("https://github.com/amantus-ai/vibetunnel/issues");
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
            let _ = open_settings_window(app.clone(), None);
        }
        "quit" => {
            quit_app(app.clone());
        }
        _ => {
            // Handle session clicks (format: "session_<id>")
            if event_id.starts_with("session_") {
                let session_id = event_id.strip_prefix("session_").unwrap_or("");
                if !session_id.is_empty() {
                    // Open session detail window
                    let _ = open_session_detail_window(app.clone(), session_id.to_string());
                }
            }
        }
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "settings" => {
            // Open native settings window instead of main window
            let _ = open_settings_window(app.clone(), None);
        }
        "new-terminal" => {
            // Terminal creation should be done via the web dashboard
            // Open dashboard in browser
            let state = app.state::<AppState>();
            let backend_manager = state.backend_manager.clone();
            tauri::async_runtime::spawn(async move {
                if backend_manager.is_running().await {
                    let settings = crate::settings::Settings::load().unwrap_or_default();
                    let url = format!("http://127.0.0.1:{}", settings.dashboard.server_port);
                    let _ = open::that(url);
                }
            });
        }
        "reload" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        "show-dashboard" => {
            // Open dashboard in browser instead of showing main window
            let state = app.state::<AppState>();
            let backend_manager = state.backend_manager.clone();
            tauri::async_runtime::spawn(async move {
                if backend_manager.is_running().await {
                    let settings = crate::settings::Settings::load().unwrap_or_default();
                    let url = format!("http://127.0.0.1:{}", settings.dashboard.server_port);
                    let _ = open::that(url);
                }
            });
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
    let window = if let Some(window) = app.get_webview_window("main") {
        window
    } else {
        // Create main window if it doesn't exist
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("VibeTunnel")
            .inner_size(1200.0, 800.0)
            .center()
            .resizable(true)
            .decorations(true)
            .build()
            .map_err(|e| e.to_string())?
    };

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    // Show dock icon on macOS when window is shown
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }

    // Handle window close event to hide instead of quit
    let window_clone = window.clone();
    let app_clone = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_clone.hide();

            // Hide dock icon on macOS when window is hidden (only if settings say so)
            #[cfg(target_os = "macos")]
            {
                if let Ok(settings) = settings::Settings::load() {
                    if !settings.general.show_dock_icon {
                        let _ = app_clone.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    // Stop monitoring before exit
    let state = app.state::<AppState>();
    state
        .server_monitoring
        .store(false, std::sync::atomic::Ordering::Relaxed);

    // Close all terminal sessions
    let terminal_manager = state.terminal_manager.clone();
    tauri::async_runtime::block_on(async move {
        let _ = terminal_manager.close_all_sessions().await;
    });

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
            let _ = state
                .notification_manager
                .notify_server_status(true, status.port)
                .await;
        }
        Err(e) => {
            tracing::error!("Failed to start server: {}", e);
            let _ = state
                .notification_manager
                .notify_error(
                    "Server Start Failed",
                    &format!("Failed to start server: {}", e),
                )
                .await;
        }
    }

    // Monitor server health
    let monitoring_state = state_clone.clone();
    let monitoring_app = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        let mut check_interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

        while monitoring_state
            .server_monitoring
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            check_interval.tick().await;

            // Check if server is still running
            let server_running = monitoring_state.backend_manager.is_running().await;

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
                            let _ = monitoring_state
                                .notification_manager
                                .notify_server_status(true, status.port)
                                .await;
                        }
                        Err(e) => {
                            tracing::error!("Failed to restart server: {}", e);
                            let _ = monitoring_state
                                .notification_manager
                                .notify_error(
                                    "Server Restart Failed",
                                    &format!("Failed to restart server: {}", e),
                                )
                                .await;
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
                            let _ = monitoring_state
                                .notification_manager
                                .notify_server_status(true, status.port)
                                .await;
                        }
                        Err(e) => {
                            tracing::error!("Failed to start server: {}", e);
                            let _ = monitoring_state
                                .notification_manager
                                .notify_error(
                                    "Server Start Failed",
                                    &format!("Failed to start server: {}", e),
                                )
                                .await;
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
            let url = format!("http://127.0.0.1:{}/api/sessions", status.port);

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
    // Check if backend is already running
    if state.backend_manager.is_running().await {
        // Get port from settings
        let settings = crate::settings::Settings::load().unwrap_or_default();
        let port = settings.dashboard.server_port;

        // Check if ngrok is active
        let url = if let Some(ngrok_tunnel) = state.ngrok_manager.get_tunnel_status() {
            ngrok_tunnel.url
        } else {
            match settings.dashboard.access_mode.as_str() {
                "network" => format!("http://0.0.0.0:{}", port),
                _ => format!("http://127.0.0.1:{}", port),
            }
        };

        return Ok(ServerStatus {
            running: true,
            port,
            url,
        });
    }

    // Start the Node.js backend
    state.backend_manager.start().await?;

    // Load settings for access mode
    let settings = crate::settings::Settings::load().unwrap_or_default();
    let port = settings.dashboard.server_port;

    // Handle access mode
    let url = match settings.dashboard.access_mode.as_str() {
        "network" => {
            // Node.js server handles network binding internally
            format!("http://0.0.0.0:{}", port)
        }
        "ngrok" => {
            // Try to start ngrok tunnel if auth token is configured
            if let Some(auth_token) = settings.advanced.ngrok_auth_token {
                if !auth_token.is_empty() {
                    match state
                        .ngrok_manager
                        .start_tunnel(port, Some(auth_token))
                        .await
                    {
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
            }
        }
        _ => {
            format!("http://127.0.0.1:{}", port)
        }
    };

    Ok(ServerStatus {
        running: true,
        port,
        url,
    })
}

async fn stop_server_internal(state: &AppState) -> Result<(), String> {
    // Stop the Node.js backend
    state.backend_manager.stop().await?;

    // Also stop ngrok tunnel if active
    let _ = state.ngrok_manager.stop_tunnel().await;

    Ok(())
}

async fn get_server_status_internal(state: &AppState) -> Result<ServerStatus, String> {
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
                "network" => format!("http://0.0.0.0:{}", port),
                _ => format!("http://127.0.0.1:{}", port),
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
