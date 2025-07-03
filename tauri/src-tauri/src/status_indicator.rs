use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tracing::{debug, error};

/// Visual status indicators for the tray icon
pub struct StatusIndicator {
    app_handle: Arc<std::sync::Mutex<Option<AppHandle>>>,
}

impl StatusIndicator {
    pub fn new() -> Self {
        Self {
            app_handle: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Set the app handle for the indicator
    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut guard = self.app_handle.lock().unwrap();
        *guard = Some(handle);
    }

    /// Update the tray icon based on server and session status
    pub fn update_tray_icon(&self, server_running: bool, active_sessions: usize, total_sessions: usize) {
        let guard = self.app_handle.lock().unwrap();
        if let Some(app_handle) = guard.as_ref() {
            if let Some(tray) = app_handle.tray_by_id("main") {
                // Update icon based on status
                let icon_name = if server_running {
                    if active_sessions > 0 {
                        "tray-icon-active" // Green/active indicator
                    } else if total_sessions > 0 {
                        "tray-icon-idle" // Yellow/idle indicator
                    } else {
                        "tray-icon" // Normal running state
                    }
                } else {
                    "tray-icon-inactive" // Gray/inactive state
                };

                // Try to load the appropriate icon
                match Self::load_icon_data(app_handle, icon_name) {
                    Ok(icon_data) => {
                        match tauri::image::Image::from_bytes(&icon_data) {
                            Ok(image) => {
                                if let Err(e) = tray.set_icon(Some(image)) {
                                    error!("Failed to update tray icon: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("Failed to create image from icon data: {}", e);
                            }
                        }
                    }
                    Err(_) => {
                        // Fall back to default icon with tooltip to indicate status
                        debug!("Icon {} not found, using default", icon_name);
                    }
                }

                // Update tooltip with session information
                let tooltip = self.format_tooltip(server_running, active_sessions, total_sessions);
                let _ = tray.set_tooltip(Some(&tooltip));

                // Update title (visible on macOS) with session count
                if total_sessions > 0 {
                    let title = self.format_title(active_sessions, total_sessions);
                    let _ = tray.set_title(Some(&title));
                } else {
                    let _ = tray.set_title::<&str>(None);
                }
            }
        }
    }

    /// Format the tray tooltip
    fn format_tooltip(&self, server_running: bool, active_sessions: usize, total_sessions: usize) -> String {
        if !server_running {
            return "VibeTunnel - Server Stopped".to_string();
        }

        if total_sessions == 0 {
            return "VibeTunnel - No Sessions".to_string();
        }

        if active_sessions == 0 {
            format!("VibeTunnel - {} idle session{}", total_sessions, if total_sessions == 1 { "" } else { "s" })
        } else if active_sessions == total_sessions {
            format!("VibeTunnel - {} active session{}", active_sessions, if active_sessions == 1 { "" } else { "s" })
        } else {
            format!("VibeTunnel - {} active, {} idle", active_sessions, total_sessions - active_sessions)
        }
    }

    /// Format the tray title (visible text on macOS)
    fn format_title(&self, active_sessions: usize, total_sessions: usize) -> String {
        if active_sessions == 0 {
            total_sessions.to_string()
        } else if active_sessions == total_sessions {
            format!("● {}", active_sessions)
        } else {
            format!("{} | {}", active_sessions, total_sessions - active_sessions)
        }
    }

    /// Load icon data from resources
    fn load_icon_data(app_handle: &AppHandle, name: &str) -> Result<Vec<u8>, String> {
        // Try to load from different icon paths
        let icon_paths = vec![
            format!("icons/{}.png", name),
            format!("icons/{}@2x.png", name),
            format!("{}.png", name),
        ];

        for path in icon_paths {
            if let Ok(icon_path) = app_handle.path().resolve(&path, tauri::path::BaseDirectory::Resource) {
                if let Ok(contents) = std::fs::read(&icon_path) {
                    return Ok(contents);
                }
            }
        }

        Err(format!("Icon {} not found", name))
    }

    /// Animate the tray icon for notifications or activity
    pub async fn animate_activity(&self) {
        // Simple animation: briefly change icon to indicate activity
        let app_handle = {
            let guard = self.app_handle.lock().unwrap();
            guard.clone()
        };
        
        if let Some(app_handle) = app_handle {
            if let Some(tray) = app_handle.tray_by_id("main") {
                // Flash the icon by changing it briefly
                if let Ok(active_icon_data) = Self::load_icon_data(&app_handle, "tray-icon-flash") {
                    if let Ok(active_image) = tauri::image::Image::from_bytes(&active_icon_data) {
                        let _ = tray.set_icon(Some(active_image));
                        
                        // Restore after a short delay
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        
                        if let Ok(normal_icon_data) = Self::load_icon_data(&app_handle, "tray-icon") {
                            if let Ok(normal_image) = tauri::image::Image::from_bytes(&normal_icon_data) {
                                let _ = tray.set_icon(Some(normal_image));
                            }
                        }
                    }
                }
            }
        }
    }
}

// Public functions for commands (without tauri::command attribute)
pub async fn update_status_indicator(
    state: tauri::State<'_, crate::state::AppState>,
    server_running: bool,
    active_sessions: usize,
    total_sessions: usize,
) -> Result<(), String> {
    state.status_indicator.update_tray_icon(server_running, active_sessions, total_sessions);
    Ok(())
}

pub async fn flash_activity_indicator(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    state.status_indicator.animate_activity().await;
    Ok(())
}

