pub mod api_testing;
pub mod app_mover;
pub mod auth;
pub mod auth_cache;
pub mod auto_launch;
pub mod backend_manager;
pub mod cli_installer;
pub mod commands;
pub mod debug_features;
pub mod fs_api;
pub mod keychain;
pub mod network_utils;
pub mod ngrok;
pub mod notification_manager;
pub mod permissions;
pub mod port_conflict;
pub mod server;
pub mod session_monitor;
pub mod settings;
pub mod state;
pub mod terminal;
pub mod terminal_detector;
pub mod terminal_integrations;
pub mod terminal_spawn_service;
pub mod tray_menu;
pub mod tty_forward;
#[cfg(unix)]
pub mod unix_socket_server;
pub mod updater;
pub mod welcome;

#[cfg(mobile)]
pub fn init() {
    // Mobile-specific initialization
}
