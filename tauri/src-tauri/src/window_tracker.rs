use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub window_id: u32,
    pub owner_pid: u32,
    pub terminal_app: String,
    pub session_id: String,
    pub created_at: String,
    pub tab_reference: Option<String>,
    pub tab_id: Option<String>,
    pub bounds: Option<WindowBounds>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct WindowTracker {
    // Maps session IDs to their terminal window information
    session_window_map: Arc<RwLock<HashMap<String, WindowInfo>>>,
}

impl WindowTracker {
    pub fn new() -> Self {
        Self {
            session_window_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a terminal window for a session
    pub async fn register_window(
        &self,
        session_id: String,
        terminal_app: String,
        tab_reference: Option<String>,
        tab_id: Option<String>,
    ) {
        info!("Registering window for session: {}, terminal: {}", session_id, terminal_app);

        // For terminals with explicit window/tab info, register immediately
        if (terminal_app == "Terminal" && tab_reference.is_some()) ||
           (terminal_app == "iTerm2" && tab_id.is_some()) {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            if let Some(window_info) = self.find_window(&terminal_app, &session_id, &tab_reference, &tab_id).await {
                self.session_window_map.write().await.insert(session_id.clone(), window_info);
                info!("Successfully registered window for session {} with explicit ID", session_id);
            }
            return;
        }

        // For other terminals, use progressive delays to find the window
        let delays = [0.5, 1.0, 2.0, 3.0];
        for (index, delay) in delays.iter().enumerate() {
            tokio::time::sleep(tokio::time::Duration::from_secs_f64(*delay)).await;
            
            if let Some(window_info) = self.find_window(&terminal_app, &session_id, &tab_reference, &tab_id).await {
                self.session_window_map.write().await.insert(session_id.clone(), window_info);
                info!("Successfully registered window for session {} after {} attempts", session_id, index + 1);
                return;
            }
        }

        warn!("Failed to register window for session {} after all attempts", session_id);
    }

    /// Unregister a window for a session
    pub async fn unregister_window(&self, session_id: &str) {
        if self.session_window_map.write().await.remove(session_id).is_some() {
            info!("Unregistered window for session: {}", session_id);
        }
    }

    /// Get window information for a specific session
    pub async fn window_info(&self, session_id: &str) -> Option<WindowInfo> {
        self.session_window_map.read().await.get(session_id).cloned()
    }

    /// Get all tracked windows
    pub async fn all_tracked_windows(&self) -> Vec<WindowInfo> {
        self.session_window_map.read().await.values().cloned().collect()
    }

    /// Focus the terminal window for a specific session
    pub async fn focus_window(&self, session_id: &str) -> Result<(), String> {
        let window_info = self.window_info(session_id).await
            .ok_or_else(|| format!("No window registered for session: {}", session_id))?;

        info!("Focusing window for session: {}, terminal: {}", session_id, window_info.terminal_app);

        // Platform-specific window focusing
        #[cfg(target_os = "macos")]
        {
            self.focus_window_macos(&window_info).await
        }
        #[cfg(target_os = "windows")]
        {
            self.focus_window_windows(&window_info).await
        }
        #[cfg(target_os = "linux")]
        {
            self.focus_window_linux(&window_info).await
        }
    }

    /// Update window tracking based on current sessions
    pub async fn update_from_sessions(&self, sessions: &[crate::api_client::SessionResponse]) {
        let session_ids: std::collections::HashSet<String> = sessions.iter()
            .map(|s| s.id.clone())
            .collect();

        // Remove windows for sessions that no longer exist
        let mut window_map = self.session_window_map.write().await;
        let tracked_sessions: Vec<String> = window_map.keys().cloned().collect();
        
        for session_id in tracked_sessions {
            if !session_ids.contains(&session_id) {
                window_map.remove(&session_id);
                info!("Removed window tracking for terminated session: {}", session_id);
            }
        }
        drop(window_map);

        // Try to find windows for sessions without registered windows
        for session in sessions {
            if self.window_info(&session.id).await.is_none() {
                debug!("Session {} has no window registered, attempting to find it...", session.id);
                
                if let Some(window_info) = self.find_window_for_session(&session.id).await {
                    self.session_window_map.write().await.insert(session.id.clone(), window_info);
                    info!("Found and registered window for session: {}", session.id);
                } else {
                    debug!("Could not find window for session: {}", session.id);
                }
            }
        }
    }

    // Platform-specific implementations

    #[cfg(target_os = "macos")]
    async fn find_window(
        &self,
        terminal_app: &str,
        session_id: &str,
        _tab_reference: &Option<String>,
        _tab_id: &Option<String>,
    ) -> Option<WindowInfo> {
        // Use macOS Core Graphics API to find windows
        // This is a simplified implementation - full version would use objc bindings
        let windows = self.get_all_terminal_windows_macos().await;
        
        for window in windows {
            if window.terminal_app == terminal_app {
                // Check if window title contains session ID
                if let Some(title) = &window.title {
                    if title.contains(session_id) {
                        return Some(window);
                    }
                }
            }
        }
        
        None
    }

    #[cfg(target_os = "macos")]
    async fn get_all_terminal_windows_macos(&self) -> Vec<WindowInfo> {
        // This would use Core Graphics APIs via objc bindings
        // For now, return empty as a placeholder
        Vec::new()
    }

    #[cfg(target_os = "macos")]
    async fn focus_window_macos(&self, window_info: &WindowInfo) -> Result<(), String> {
        // Use AppleScript or Accessibility APIs to focus window
        use std::process::Command;
        
        let script = format!(
            r#"tell application "{}" to activate"#,
            window_info.terminal_app
        );
        
        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to run AppleScript: {}", e))?;
            
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("AppleScript failed: {}", error));
        }
        
        Ok(())
    }

    #[cfg(target_os = "windows")]
    async fn find_window(
        &self,
        terminal_app: &str,
        session_id: &str,
        _tab_reference: &Option<String>,
        _tab_id: &Option<String>,
    ) -> Option<WindowInfo> {
        // Use Windows API to find windows
        // This would require winapi crate
        None
    }

    #[cfg(target_os = "windows")]
    async fn focus_window_windows(&self, _window_info: &WindowInfo) -> Result<(), String> {
        // Use Windows API to focus window
        Err("Window focusing not implemented for Windows".to_string())
    }

    #[cfg(target_os = "linux")]
    async fn find_window(
        &self,
        terminal_app: &str,
        session_id: &str,
        _tab_reference: &Option<String>,
        _tab_id: &Option<String>,
    ) -> Option<WindowInfo> {
        // Use X11 or Wayland APIs to find windows
        None
    }

    #[cfg(target_os = "linux")]
    async fn focus_window_linux(&self, _window_info: &WindowInfo) -> Result<(), String> {
        // Use X11/Wayland APIs to focus window
        Err("Window focusing not implemented for Linux".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    async fn find_window(
        &self,
        _terminal_app: &str,
        _session_id: &str,
        _tab_reference: &Option<String>,
        _tab_id: &Option<String>,
    ) -> Option<WindowInfo> {
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    async fn focus_window(&self, _session_id: &str) -> Result<(), String> {
        Err("Window focusing not supported on this platform".to_string())
    }

    async fn find_window_for_session(&self, session_id: &str) -> Option<WindowInfo> {
        // Try to find a window that contains this session
        let windows = if cfg!(target_os = "macos") {
            self.get_all_terminal_windows_macos().await
        } else {
            Vec::new()
        };

        for window in windows {
            if let Some(title) = &window.title {
                if title.contains(session_id) {
                    return Some(window);
                }
            }
        }

        None
    }
}