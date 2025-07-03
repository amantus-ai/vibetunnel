use crate::process_tracker::ProcessTracker;
use crate::window_enumerator::{WindowEnumerator, WindowInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub pid: Option<u32>,
    pub working_dir: String,
    pub name: Option<String>,
    pub activity_status: Option<String>,
}

/// Handles window matching and session-to-window mapping algorithms
pub struct WindowMatcher {
    /// Cache of session to window mappings
    session_window_cache: HashMap<String, u64>,
}

impl WindowMatcher {
    pub fn new() -> Self {
        Self {
            session_window_cache: HashMap::new(),
        }
    }

    /// Find a window for a specific terminal and session
    pub fn find_window<'a>(
        &mut self,
        terminal_app: &str,
        session_id: &str,
        session_info: Option<&SessionInfo>,
        tab_reference: Option<&str>,
        tab_id: Option<&str>,
        terminal_windows: &'a [WindowInfo],
    ) -> Option<&'a WindowInfo> {
        // Check cache first
        if let Some(&cached_window_id) = self.session_window_cache.get(session_id) {
            if let Some(window) = terminal_windows.iter().find(|w| w.window_id == cached_window_id) {
                debug!("Found cached window for session {}: {}", session_id, cached_window_id);
                return Some(window);
            }
        }

        // Filter windows for the specific terminal
        let filtered_windows: Vec<&WindowInfo> = terminal_windows
            .iter()
            .filter(|w| w.terminal_app == terminal_app)
            .collect();

        // First try to find window by process PID traversal
        if let Some(session_info) = session_info {
            if let Some(session_pid) = session_info.pid {
                debug!("Attempting to find window by process PID: {}", session_pid);
                
                // Log the process tree for debugging
                ProcessTracker::log_process_tree(session_pid);
                
                // Try to find the parent process (shell) that owns this session
                if let Some(parent_pid) = ProcessTracker::get_parent_process_id(session_pid) {
                    debug!("Found parent process PID: {}", parent_pid);
                    
                    // Look for a window owned by the parent process
                    if let Some(matching_window) = filtered_windows.iter().find(|window| {
                        window.owner_pid == parent_pid
                    }) {
                        info!("Found window by parent process match: PID {}", parent_pid);
                        self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                        return Some(matching_window);
                    }
                    
                    // If direct parent match fails, try to find grandparent or higher ancestors
                    let mut current_pid = parent_pid;
                    let mut depth = 0;
                    while depth < 10 {
                        if let Some(grandparent_pid) = ProcessTracker::get_parent_process_id(current_pid) {
                            debug!("Checking ancestor process PID: {} at depth {}", grandparent_pid, depth + 2);
                            
                            if let Some(matching_window) = filtered_windows.iter().find(|window| {
                                window.owner_pid == grandparent_pid
                            }) {
                                info!("Found window by ancestor process match: PID {} at depth {}", grandparent_pid, depth + 2);
                                self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                                return Some(matching_window);
                            }
                            
                            current_pid = grandparent_pid;
                            depth += 1;
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Fallback: try to find window by title containing session path or command
        if let Some(session_info) = session_info {
            let working_dir = &session_info.working_dir;
            let dir_name = std::path::Path::new(working_dir)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            
            // Look for windows whose title contains the directory name
            if let Some(matching_window) = filtered_windows.iter().find(|window| {
                WindowEnumerator::window_title_contains(window, dir_name) ||
                WindowEnumerator::window_title_contains(window, working_dir)
            }) {
                debug!("Found window by directory match: {}", dir_name);
                self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                return Some(matching_window);
            }
        }

        // For Terminal.app with specific tab reference
        if terminal_app == "Terminal" {
            if let Some(tab_ref) = tab_reference {
                if let Some(window_id) = WindowEnumerator::extract_window_id(tab_ref) {
                    if let Some(matching_window) = filtered_windows.iter().find(|w| {
                        w.window_id == window_id
                    }) {
                        debug!("Found Terminal.app window by ID: {}", window_id);
                        self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                        return Some(matching_window);
                    }
                }
            }
        }

        // For iTerm2 with tab ID
        if terminal_app == "iTerm2" {
            if let Some(tab_id) = tab_id {
                // Try to match by window title which often includes the window ID
                if let Some(matching_window) = filtered_windows.iter().find(|window| {
                    WindowEnumerator::window_title_contains(window, tab_id)
                }) {
                    debug!("Found iTerm2 window by ID in title: {}", tab_id);
                    self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                    return Some(matching_window);
                }
            }
        }

        // Fallback: return the most recently created window (highest window ID)
        if let Some(latest_window) = filtered_windows.iter().max_by_key(|w| w.window_id) {
            debug!("Using most recent window as fallback for session: {}", session_id);
            self.session_window_cache.insert(session_id.to_string(), latest_window.window_id);
            return Some(latest_window);
        }

        None
    }

    /// Find a terminal window for a session that was attached via `vt`
    pub fn find_window_for_session<'a>(
        &mut self,
        session_id: &str,
        session_info: &SessionInfo,
        all_windows: &'a [WindowInfo],
    ) -> Option<&'a WindowInfo> {
        // Check cache first
        if let Some(&cached_window_id) = self.session_window_cache.get(session_id) {
            if let Some(window) = all_windows.iter().find(|w| w.window_id == cached_window_id) {
                debug!("Found cached window for session {}: {}", session_id, cached_window_id);
                return Some(window);
            }
        }

        // First try to find window by process PID traversal
        if let Some(session_pid) = session_info.pid {
            debug!("Scanning for window by process PID: {} for session {}", session_pid, session_id);
            
            // Log the process tree for debugging
            ProcessTracker::log_process_tree(session_pid);
            
            // Try to traverse up the process tree to find a terminal window
            let mut current_pid = session_pid;
            let mut depth = 0;
            let max_depth = 20;
            
            while depth < max_depth {
                // Check if any window is owned by this PID
                if let Some(matching_window) = all_windows.iter().find(|window| {
                    window.owner_pid == current_pid
                }) {
                    info!("Found window by PID {} at depth {} for session {}", current_pid, depth, session_id);
                    self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                    return Some(matching_window);
                }
                
                // Move up to parent process
                if let Some(parent_pid) = ProcessTracker::get_parent_process_id(current_pid) {
                    if parent_pid == 0 || parent_pid == 1 {
                        // Reached root process
                        break;
                    }
                    current_pid = parent_pid;
                    depth += 1;
                } else {
                    break;
                }
            }
            
            debug!("Process traversal completed at depth {} without finding window", depth);
        }

        // Fallback: Find by working directory
        let working_dir = &session_info.working_dir;
        let dir_name = std::path::Path::new(working_dir)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        
        debug!("Trying to match by directory: {} or full path: {}", dir_name, working_dir);
        
        // Look for windows whose title contains the directory name
        if let Some(matching_window) = all_windows.iter().find(|window| {
            if let Some(ref title) = window.title {
                let matches = title.contains(dir_name) || title.contains(working_dir);
                if matches {
                    debug!("Window title '{}' matches directory", title);
                }
                matches
            } else {
                false
            }
        }) {
            info!("Found window by directory match: {} for session {}", dir_name, session_id);
            self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
            return Some(matching_window);
        }

        // Try to match by activity status (for sessions with specific activities)
        if let Some(ref activity) = session_info.activity_status {
            if !activity.is_empty() {
                debug!("Trying to match by activity: {}", activity);
                
                if let Some(matching_window) = all_windows.iter().find(|window| {
                    if let Some(ref title) = window.title {
                        title.contains(activity)
                    } else {
                        false
                    }
                }) {
                    info!("Found window by activity match: {} for session {}", activity, session_id);
                    self.session_window_cache.insert(session_id.to_string(), matching_window.window_id);
                    return Some(matching_window);
                }
            }
        }

        warn!("Could not find window for session {} after all attempts", session_id);
        debug!("Available windows: {}", all_windows.len());
        for (index, window) in all_windows.iter().enumerate() {
            debug!(
                "  Window {}: PID={}, Terminal={}, Title={}",
                index, 
                window.owner_pid, 
                window.terminal_app,
                window.title.as_deref().unwrap_or("<no title>")
            );
        }

        None
    }

    /// Clear cached window mapping for a session
    pub fn clear_session_cache(&mut self, session_id: &str) {
        self.session_window_cache.remove(session_id);
    }

    /// Clear all cached window mappings
    pub fn clear_all_cache(&mut self) {
        self.session_window_cache.clear();
    }
}