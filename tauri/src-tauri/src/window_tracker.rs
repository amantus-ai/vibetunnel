use crate::window_enumerator::WindowEnumerator;
use crate::window_matcher::{SessionInfo as MatcherSessionInfo, WindowMatcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub window_id: u64,  // Changed from u32 to u64 to support all platforms
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
    // Window matcher for advanced window finding
    window_matcher: Arc<RwLock<WindowMatcher>>,
}

impl WindowTracker {
    pub fn new() -> Self {
        Self {
            session_window_map: Arc::new(RwLock::new(HashMap::new())),
            window_matcher: Arc::new(RwLock::new(WindowMatcher::new())),
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

    // Advanced window finding using the new components
    async fn find_window(
        &self,
        terminal_app: &str,
        session_id: &str,
        tab_reference: &Option<String>,
        tab_id: &Option<String>,
    ) -> Option<WindowInfo> {
        // Get all terminal windows using WindowEnumerator
        let terminal_windows = WindowEnumerator::get_all_terminal_windows();
        
        // For testing, also try to get session info from API if available
        let session_info = None; // In a real implementation, this would query the server
        
        // Use WindowMatcher to find the matching window
        let mut matcher = self.window_matcher.write().await;
        
        if let Some(matched_window) = matcher.find_window(
            terminal_app,
            session_id,
            session_info,
            tab_reference.as_deref(),
            tab_id.as_deref(),
            &terminal_windows,
        ) {
            // Convert from EnumeratedWindowInfo to our WindowInfo
            Some(WindowInfo {
                window_id: matched_window.window_id,  // No cast needed, already u64
                owner_pid: matched_window.owner_pid,
                terminal_app: matched_window.terminal_app.clone(),
                session_id: session_id.to_string(),
                created_at: matched_window.created_at.to_rfc3339(),
                tab_reference: matched_window.tab_reference.clone(),
                tab_id: matched_window.tab_id.clone(),
                bounds: matched_window.bounds.as_ref().map(|b| WindowBounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                }),
                title: matched_window.title.clone(),
            })
        } else {
            None
        }
    }

    async fn find_window_for_session(&self, session_id: &str) -> Option<WindowInfo> {
        // Get all terminal windows
        let terminal_windows = WindowEnumerator::get_all_terminal_windows();
        
        // Create a minimal session info for matching
        let session_info = MatcherSessionInfo {
            id: session_id.to_string(),
            pid: None, // Would be filled from actual session data
            working_dir: String::new(),
            name: None,
            activity_status: None,
        };
        
        // Use WindowMatcher to find the window
        let mut matcher = self.window_matcher.write().await;
        
        if let Some(matched_window) = matcher.find_window_for_session(
            session_id,
            &session_info,
            &terminal_windows,
        ) {
            // Convert from EnumeratedWindowInfo to our WindowInfo
            Some(WindowInfo {
                window_id: matched_window.window_id,  // No cast needed, already u64
                owner_pid: matched_window.owner_pid,
                terminal_app: matched_window.terminal_app.clone(),
                session_id: session_id.to_string(),
                created_at: matched_window.created_at.to_rfc3339(),
                tab_reference: matched_window.tab_reference.clone(),
                tab_id: matched_window.tab_id.clone(),
                bounds: matched_window.bounds.as_ref().map(|b| WindowBounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                }),
                title: matched_window.title.clone(),
            })
        } else {
            None
        }
    }

    // Platform-specific window focusing implementations
    #[cfg(target_os = "macos")]
    async fn focus_window_macos(&self, window_info: &WindowInfo) -> Result<(), String> {
        use std::process::Command;
        
        // First activate the application
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
        
        // For Terminal.app, also try to focus specific tab if we have tab reference
        if window_info.terminal_app == "Terminal" {
            if let Some(tab_ref) = &window_info.tab_reference {
                let focus_script = format!(
                    r#"tell application "Terminal"
                        set selected of {} to true
                        activate
                    end tell"#,
                    tab_ref
                );
                
                let _ = Command::new("osascript")
                    .arg("-e")
                    .arg(&focus_script)
                    .output();
            }
        }
        
        Ok(())
    }

    #[cfg(target_os = "windows")]
    async fn focus_window_windows(&self, window_info: &WindowInfo) -> Result<(), String> {
        // Use Windows API to focus window
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{SetForegroundWindow, ShowWindow, SW_RESTORE};
            
            let hwnd = HWND(window_info.window_id as isize);
            unsafe {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Err("Window focusing not implemented for Windows".to_string())
        }
    }

    #[cfg(target_os = "linux")]
    async fn focus_window_linux(&self, window_info: &WindowInfo) -> Result<(), String> {
        use std::process::Command;
        
        // Try using wmctrl to focus the window
        let output = Command::new("wmctrl")
            .arg("-i")
            .arg("-a")
            .arg(format!("0x{:x}", window_info.window_id))
            .output();
            
        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    Err("wmctrl failed to focus window".to_string())
                }
            }
            Err(_) => {
                // Try xdotool as fallback
                let xdotool_output = Command::new("xdotool")
                    .arg("windowactivate")
                    .arg(window_info.window_id.to_string())
                    .output();
                    
                match xdotool_output {
                    Ok(result) if result.status.success() => Ok(()),
                    _ => Err("Failed to focus window on Linux".to_string())
                }
            }
        }
    }
}