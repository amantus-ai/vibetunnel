use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tracing::{debug, info};

/// Manages dock icon visibility on macOS
pub struct DockManager {
    should_show_in_dock: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    window_count: Arc<std::sync::Mutex<usize>>,
}

impl DockManager {
    pub fn new() -> Self {
        Self {
            should_show_in_dock: Arc::new(AtomicBool::new(true)),
            #[cfg(target_os = "macos")]
            window_count: Arc::new(std::sync::Mutex::new(0)),
        }
    }

    /// Updates the user preference for dock visibility
    pub fn set_show_in_dock(&self, show: bool) {
        self.should_show_in_dock.store(show, Ordering::Relaxed);
        debug!("Dock preference updated: {}", show);
    }

    /// Gets the current dock preference
    pub fn get_show_in_dock(&self) -> bool {
        self.should_show_in_dock.load(Ordering::Relaxed)
    }

    /// Updates dock visibility based on window count and user preference
    #[cfg(target_os = "macos")]
    pub fn update_dock_visibility(&self, app_handle: &AppHandle) {
        use tauri::ActivationPolicy;
        
        let user_wants_dock_hidden = !self.should_show_in_dock.load(Ordering::Relaxed);
        
        // Count visible windows
        let visible_window_count = app_handle
            .webview_windows()
            .values()
            .filter(|window| {
                window.is_visible().unwrap_or(false) &&
                !window.is_minimized().unwrap_or(false)
            })
            .count();

        // Update stored window count
        {
            let mut count = self.window_count.lock().unwrap();
            *count = visible_window_count;
        }

        // Show dock if user wants it shown OR if any windows are open
        if !user_wants_dock_hidden || visible_window_count > 0 {
            debug!("Showing dock icon (windows: {}, user_hidden: {})", visible_window_count, user_wants_dock_hidden);
            let _ = app_handle.set_activation_policy(ActivationPolicy::Regular);
        } else {
            debug!("Hiding dock icon (windows: {}, user_hidden: {})", visible_window_count, user_wants_dock_hidden);
            let _ = app_handle.set_activation_policy(ActivationPolicy::Accessory);
        }
    }

    /// Force shows the dock icon temporarily
    #[cfg(target_os = "macos")]
    pub fn temporarily_show_dock(&self, app_handle: &AppHandle) {
        use tauri::ActivationPolicy;
        info!("Temporarily showing dock icon");
        let _ = app_handle.set_activation_policy(ActivationPolicy::Regular);
    }

    /// Called when a window is created
    pub fn on_window_created(&self, app_handle: &AppHandle) {
        #[cfg(target_os = "macos")]
        {
            self.temporarily_show_dock(app_handle);
            self.update_dock_visibility(app_handle);
        }
    }

    /// Called when a window is closed
    pub fn on_window_closed(&self, app_handle: &AppHandle) {
        #[cfg(target_os = "macos")]
        {
            // Add a small delay to let window state settle
            let app_handle = app_handle.clone();
            let dock_manager = DockManager::new();
            dock_manager.set_show_in_dock(self.get_show_in_dock());
            
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(100));
                dock_manager.update_dock_visibility(&app_handle);
            });
        }
    }

    /// Called when window visibility changes
    pub fn on_window_visibility_changed(&self, app_handle: &AppHandle) {
        #[cfg(target_os = "macos")]
        {
            self.update_dock_visibility(app_handle);
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn update_dock_visibility(&self, _app_handle: &AppHandle) {
        // No-op on non-macOS platforms
    }

    #[cfg(not(target_os = "macos"))]
    pub fn temporarily_show_dock(&self, _app_handle: &AppHandle) {
        // No-op on non-macOS platforms
    }
}

// Public functions for commands (without tauri::command attribute)
pub fn set_dock_visible(state: tauri::State<crate::state::AppState>, visible: bool) -> Result<(), String> {
    state.dock_manager.set_show_in_dock(visible);
    
    // Update immediately on the app handle
    if let Some(app_handle) = state.get_app_handle() {
        state.dock_manager.update_dock_visibility(&app_handle);
    }
    
    Ok(())
}

pub fn get_dock_visible(state: tauri::State<crate::state::AppState>) -> bool {
    state.dock_manager.get_show_in_dock()
}

pub fn update_dock_visibility(state: tauri::State<crate::state::AppState>) -> Result<(), String> {
    if let Some(app_handle) = state.get_app_handle() {
        state.dock_manager.update_dock_visibility(&app_handle);
        Ok(())
    } else {
        Err("App handle not available".to_string())
    }
}

