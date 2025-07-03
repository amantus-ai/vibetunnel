pub mod api_client;
pub mod api_testing;
pub mod app_mover;
#[cfg(target_os = "macos")]
pub mod applescript;
pub mod auth_cache;
pub mod auto_launch;
pub mod backend_manager;
pub mod cli_installer;
pub mod commands;
pub mod debug_features;
pub mod dock_manager;
pub mod errors;
pub mod fs_api;
pub mod git_app_launcher;
pub mod git_monitor;
pub mod git_repository;
pub mod keychain;
pub mod log_collector;
pub mod menubar_popover;
pub mod network_utils;
pub mod ngrok;
pub mod notification_manager;
pub mod permissions;
pub mod port_conflict;
pub mod power_manager;
pub mod process_tracker;
pub mod status_indicator;
pub mod session_monitor;
pub mod settings;
pub mod state;
pub mod tailscale;
pub mod terminal;
pub mod terminal_detector;
pub mod terminal_integrations;
pub mod terminal_spawn_service;
pub mod tray_menu;
pub mod tty_forward;
#[cfg(unix)]
pub mod unix_socket_server;
pub mod updater;
pub mod url_scheme;
pub mod welcome;
pub mod window_enumerator;
pub mod window_matcher;
pub mod window_tracker;

#[cfg(mobile)]
pub fn init() {
    // Mobile-specific initialization
}
