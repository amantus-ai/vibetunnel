use serde::{Deserialize, Serialize};
use tracing::debug;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub window_id: u64,
    pub owner_pid: u32,
    pub terminal_app: String,
    pub session_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
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

/// Window enumerator for finding and tracking terminal windows
pub struct WindowEnumerator;

impl WindowEnumerator {
    /// Get all terminal windows currently visible on screen
    pub fn get_all_terminal_windows() -> Vec<WindowInfo> {
        #[cfg(target_os = "macos")]
        {
            Self::get_terminal_windows_macos()
        }
        #[cfg(target_os = "windows")]
        {
            Self::get_terminal_windows_windows()
        }
        #[cfg(target_os = "linux")]
        {
            Self::get_terminal_windows_linux()
        }
    }

    #[cfg(target_os = "macos")]
    fn get_terminal_windows_macos() -> Vec<WindowInfo> {
        use std::process::Command;
        let mut terminal_windows = Vec::new();

        // Use AppleScript to get window information as a simpler approach
        let script = r#"
            tell application "System Events"
                set terminalApps to {"Terminal", "iTerm2", "Alacritty", "kitty", "WezTerm", "Hyper"}
                set windowList to {}
                
                repeat with appName in terminalApps
                    if exists application process appName then
                        tell application process appName
                            repeat with w in windows
                                set windowInfo to {appName, (id of w), (name of w), (position of w), (size of w)}
                                set end of windowList to windowInfo
                            end repeat
                        end tell
                    end if
                end repeat
                
                return windowList
            end tell
        "#;

        if let Ok(output) = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
        {
            if output.status.success() {
                // Parse the AppleScript output
                // This is a simplified version - real implementation would parse the structured output
                debug!("Window enumeration via AppleScript completed");
            }
        }

        // Fallback: Use ps to find terminal processes
        if let Ok(output) = Command::new("ps")
            .args(&["-eo", "pid,comm"])
            .output()
        {
            if output.status.success() {
                let output_str = String::from_utf8_lossy(&output.stdout);
                for line in output_str.lines() {
                    let parts: Vec<&str> = line.trim().split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(pid) = parts[0].parse::<u32>() {
                            let process_name = parts[1..].join(" ");
                            for terminal in &["Terminal", "iTerm2", "Alacritty", "kitty", "WezTerm", "Hyper"] {
                                if process_name.contains(terminal) {
                                    terminal_windows.push(WindowInfo {
                                        window_id: pid as u64,
                                        owner_pid: pid,
                                        terminal_app: terminal.to_string(),
                                        session_id: String::new(),
                                        created_at: chrono::Utc::now(),
                                        tab_reference: None,
                                        tab_id: None,
                                        bounds: None,
                                        title: None,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        terminal_windows
    }

    #[cfg(target_os = "windows")]
    fn get_terminal_windows_windows() -> Vec<WindowInfo> {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
        };
        use std::sync::Mutex;

        let terminal_windows = Arc::new(Mutex::new(Vec::new()));
        let terminal_windows_clone = terminal_windows.clone();

        unsafe {
            let _ = EnumWindows(
                Some(enum_window_callback),
                LPARAM(&terminal_windows_clone as *const _ as isize),
            );
        }

        unsafe extern "system" fn enum_window_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let terminal_windows = &*(lparam.0 as *const Arc<Mutex<Vec<WindowInfo>>>);

            if IsWindowVisible(hwnd).as_bool() {
                let mut class_name = [0u16; 256];
                let class_len = GetClassNameW(hwnd, &mut class_name);

                if class_len > 0 {
                    let class_str = String::from_utf16_lossy(&class_name[..class_len as usize]);
                    
                    // Check for known terminal window classes
                    let terminal_classes = vec![
                        "ConsoleWindowClass",  // Windows Terminal, CMD
                        "CASCADIA_HOSTING_WINDOW_CLASS",  // Windows Terminal
                        "VirtualConsoleClass",  // ConEmu
                        "PuTTY",  // PuTTY
                    ];

                    if terminal_classes.iter().any(|&tc| class_str.contains(tc)) {
                        let mut title = [0u16; 512];
                        let title_len = GetWindowTextW(hwnd, &mut title);
                        let title_str = if title_len > 0 {
                            Some(String::from_utf16_lossy(&title[..title_len as usize]))
                        } else {
                            None
                        };

                        let mut process_id: u32 = 0;
                        GetWindowThreadProcessId(hwnd, Some(&mut process_id));

                        let mut rect = RECT::default();
                        let bounds = if GetWindowRect(hwnd, &mut rect).is_ok() {
                            Some(WindowBounds {
                                x: rect.left as f64,
                                y: rect.top as f64,
                                width: (rect.right - rect.left) as f64,
                                height: (rect.bottom - rect.top) as f64,
                            })
                        } else {
                            None
                        };

                        terminal_windows.lock().unwrap().push(WindowInfo {
                            window_id: hwnd.0 as u64,
                            owner_pid: process_id,
                            terminal_app: class_str,
                            session_id: String::new(),
                            created_at: chrono::Utc::now(),
                            tab_reference: None,
                            tab_id: None,
                            bounds,
                            title: title_str,
                        });
                    }
                }
            }

            BOOL(1)  // Continue enumeration
        }

        let result = terminal_windows.lock().unwrap().clone();
        result
    }

    #[cfg(target_os = "linux")]
    fn get_terminal_windows_linux() -> Vec<WindowInfo> {
        // Use wmctrl or xwininfo to enumerate windows
        let mut terminal_windows = Vec::new();

        // Try using wmctrl first
        match Command::new("wmctrl").arg("-lp").output() {
            Ok(output) => {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    for line in output_str.lines() {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            let window_id = u64::from_str_radix(parts[0].trim_start_matches("0x"), 16).unwrap_or(0);
                            let pid = parts[2].parse::<u32>().unwrap_or(0);
                            let title = parts[4..].join(" ");

                            // Check if it's a terminal by title or other heuristics
                            let terminal_keywords = vec!["terminal", "konsole", "gnome-terminal", "xterm", "alacritty", "kitty"];
                            if terminal_keywords.iter().any(|&kw| title.to_lowercase().contains(kw)) {
                                terminal_windows.push(WindowInfo {
                                    window_id,
                                    owner_pid: pid,
                                    terminal_app: "Unknown".to_string(),
                                    session_id: String::new(),
                                    created_at: chrono::Utc::now(),
                                    tab_reference: None,
                                    tab_id: None,
                                    bounds: None,
                                    title: Some(title),
                                });
                            }
                        }
                    }
                }
            }
            Err(e) => {
                warn!("Failed to run wmctrl: {}", e);
            }
        }

        terminal_windows
    }

    /// Extract window ID from terminal tab reference
    pub fn extract_window_id(tab_reference: &str) -> Option<u64> {
        // Extract window ID from tab reference (format: "tab id X of window id Y")
        if let Some(pos) = tab_reference.find("window id ") {
            let id_str = &tab_reference[pos + 10..];
            if let Some(end_pos) = id_str.find(|c: char| !c.is_numeric()) {
                return id_str[..end_pos].parse().ok();
            } else {
                return id_str.parse().ok();
            }
        }
        None
    }

    /// Check if a window title contains a specific identifier
    pub fn window_title_contains(window: &WindowInfo, identifier: &str) -> bool {
        if let Some(ref title) = window.title {
            title.contains(identifier)
        } else {
            false
        }
    }
}

// Platform-specific imports
#[cfg(target_os = "windows")]
use std::sync::Arc;