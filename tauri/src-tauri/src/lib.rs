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

#[cfg(mobile)]
pub fn init() {
    // Mobile-specific initialization
}