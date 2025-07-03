use std::process::Command;
use tracing::{debug, error, info};

/// AppleScript integration for advanced terminal control on macOS
pub struct AppleScriptRunner;

impl AppleScriptRunner {
    /// Run an AppleScript command
    pub fn run_script(script: &str) -> Result<String, String> {
        debug!("Running AppleScript: {}", script);
        
        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;
        
        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            debug!("AppleScript output: {}", result);
            Ok(result)
        } else {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            error!("AppleScript error: {}", error);
            Err(error)
        }
    }

    /// Launch Terminal.app with a new window for a session
    pub fn launch_terminal_app(session_id: &str, command: Option<&str>) -> Result<String, String> {
        let default_cmd = format!("vt connect localhost:4022/{}", session_id);
        let cmd = command.unwrap_or(&default_cmd);
        
        let script = format!(
            r#"tell application "Terminal"
                activate
                do script "{}"
                set newWindow to front window
                set newTab to selected tab of newWindow
                return "tab id " & (id of newTab) & " of window id " & (id of newWindow)
            end tell"#,
            cmd.replace("\"", "\\\"")
        );
        
        Self::run_script(&script)
    }

    /// Launch iTerm2 with a new window/tab for a session
    pub fn launch_iterm2(session_id: &str, command: Option<&str>, new_window: bool) -> Result<String, String> {
        let default_cmd = format!("vt connect localhost:4022/{}", session_id);
        let cmd = command.unwrap_or(&default_cmd);
        
        let script = if new_window {
            format!(
                r#"tell application "iTerm"
                    activate
                    set newWindow to (create window with default profile)
                    tell current session of newWindow
                        write text "{}"
                    end tell
                    return id of newWindow as string
                end tell"#,
                cmd.replace("\"", "\\\"")
            )
        } else {
            format!(
                r#"tell application "iTerm"
                    activate
                    tell current window
                        set newTab to (create tab with default profile)
                        tell current session of newTab
                            write text "{}"
                        end tell
                        return id of newTab as string
                    end tell
                end tell"#,
                cmd.replace("\"", "\\\"")
            )
        };
        
        Self::run_script(&script)
    }

    /// Focus a specific Terminal.app window/tab
    pub fn focus_terminal_window(window_id: u64, tab_id: Option<u64>) -> Result<(), String> {
        let script = if let Some(tid) = tab_id {
            format!(
                r#"tell application "Terminal"
                    activate
                    set targetWindow to window id {}
                    set selected tab of targetWindow to tab id {} of targetWindow
                    set frontmost of targetWindow to true
                end tell"#,
                window_id, tid
            )
        } else {
            format!(
                r#"tell application "Terminal"
                    activate
                    set targetWindow to window id {}
                    set frontmost of targetWindow to true
                end tell"#,
                window_id
            )
        };
        
        Self::run_script(&script)?;
        Ok(())
    }

    /// Focus iTerm2 window
    pub fn focus_iterm2_window(window_id: &str) -> Result<(), String> {
        let script = format!(
            r#"tell application "iTerm"
                activate
                set targetWindow to (first window whose id is {})
                select targetWindow
            end tell"#,
            window_id
        );
        
        Self::run_script(&script)?;
        Ok(())
    }

    /// Get list of Terminal.app windows with their titles
    pub fn get_terminal_windows() -> Result<Vec<(u32, String)>, String> {
        let script = r#"tell application "Terminal"
            set windowList to {}
            repeat with w in windows
                set windowInfo to (id of w as string) & "|" & (name of w as string)
                set end of windowList to windowInfo
            end repeat
            return windowList
        end tell"#;
        
        let output = Self::run_script(script)?;
        let mut windows = Vec::new();
        
        for line in output.lines() {
            if let Some((id_str, title)) = line.split_once('|') {
                if let Ok(id) = id_str.trim().parse::<u32>() {
                    windows.push((id, title.trim().to_string()));
                }
            }
        }
        
        Ok(windows)
    }

    /// Check if an application is running
    pub fn is_app_running(app_name: &str) -> Result<bool, String> {
        let script = format!(
            r#"tell application "System Events"
                return exists (processes where name is "{}")
            end tell"#,
            app_name
        );
        
        let output = Self::run_script(&script)?;
        Ok(output.trim() == "true")
    }

    /// Launch an application by path
    pub fn launch_app(app_path: &str) -> Result<(), String> {
        let script = format!(
            r#"tell application "Finder"
                open POSIX file "{}"
            end tell"#,
            app_path
        );
        
        Self::run_script(&script)?;
        Ok(())
    }

    /// Send keystrokes to the frontmost application
    pub fn send_keystrokes(text: &str) -> Result<(), String> {
        let script = format!(
            r#"tell application "System Events"
                keystroke "{}"
            end tell"#,
            text.replace("\"", "\\\"")
        );
        
        Self::run_script(&script)?;
        Ok(())
    }

    /// Get the frontmost application name
    pub fn get_frontmost_app() -> Result<String, String> {
        let script = r#"tell application "System Events"
            return name of first application process whose frontmost is true
        end tell"#;
        
        Self::run_script(script)
    }
}

/// Enhanced terminal launching with AppleScript
pub struct AppleScriptTerminalLauncher;

impl AppleScriptTerminalLauncher {
    /// Launch a terminal with enhanced AppleScript control
    pub async fn launch_terminal(
        terminal_type: &str,
        session_id: &str,
        command: Option<&str>,
        working_directory: Option<&str>,
    ) -> Result<String, String> {
        info!("Launching {} for session {} via AppleScript", terminal_type, session_id);
        
        // Build the full command with working directory
        let full_command = if let Some(cwd) = working_directory {
            if let Some(cmd) = command {
                format!("cd '{}' && {}", cwd, cmd)
            } else {
                format!("cd '{}' && vt connect localhost:4022/{}", cwd, session_id)
            }
        } else {
            command.map(|c| c.to_string())
                .unwrap_or_else(|| format!("vt connect localhost:4022/{}", session_id))
        };

        match terminal_type {
            "Terminal" | "Terminal.app" => {
                AppleScriptRunner::launch_terminal_app(session_id, Some(&full_command))
            }
            "iTerm2" | "iTerm" => {
                AppleScriptRunner::launch_iterm2(session_id, Some(&full_command), true)
            }
            _ => {
                // For other terminals, try to launch via open command
                let mut cmd = Command::new("open");
                cmd.arg("-a").arg(terminal_type);
                
                if let Some(cwd) = working_directory {
                    cmd.arg("--args").arg("--working-directory").arg(cwd);
                }
                
                cmd.output()
                    .map_err(|e| format!("Failed to launch {}: {}", terminal_type, e))?;
                
                Ok(String::new())
            }
        }
    }

    /// Focus a terminal window using AppleScript
    pub async fn focus_terminal_window(
        terminal_type: &str,
        window_info: &str,
    ) -> Result<(), String> {
        match terminal_type {
            "Terminal" | "Terminal.app" => {
                // Parse window ID from window_info
                if let Ok(window_id) = window_info.parse::<u64>() {
                    AppleScriptRunner::focus_terminal_window(window_id, None)
                } else {
                    Err("Invalid window ID".to_string())
                }
            }
            "iTerm2" | "iTerm" => {
                AppleScriptRunner::focus_iterm2_window(window_info)
            }
            _ => {
                // For other terminals, just activate the app
                let script = format!(
                    r#"tell application "{}" to activate"#,
                    terminal_type
                );
                AppleScriptRunner::run_script(&script)?;
                Ok(())
            }
        }
    }
}