pub mod commands;
pub mod terminal;
pub mod server;
pub mod state;
pub mod settings;
pub mod auto_launch;
pub mod ngrok;
pub mod auth;
pub mod terminal_detector;
pub mod cli_installer;
pub mod tray_menu;
pub mod cast;
pub mod tty_forward;
pub mod session_monitor;
pub mod port_conflict;
pub mod network_utils;
pub mod notification_manager;
pub mod welcome;
pub mod permissions;
pub mod updater;
pub mod backend_manager;
pub mod debug_features;
pub mod api_testing;
pub mod auth_cache;
pub mod terminal_integrations;
pub mod app_mover;
pub mod terminal_spawn_service;
pub mod fs_api;

#[cfg(mobile)]
pub fn init() {
    // Mobile-specific initialization
}