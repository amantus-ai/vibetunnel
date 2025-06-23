use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalInfo {
    pub name: String,
    pub path: String,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectedTerminals {
    pub default: Option<TerminalInfo>,
    pub available: Vec<TerminalInfo>,
}

pub fn detect_terminals() -> Result<DetectedTerminals, String> {
    let mut available_terminals = Vec::new();
    let mut default_terminal = None;

    #[cfg(target_os = "macos")]
    {
        // Check for Terminal.app
        if let Ok(_) = Command::new("open").args(["-Ra", "Terminal.app"]).output() {
            available_terminals.push(TerminalInfo {
                name: "Terminal".to_string(),
                path: "/System/Applications/Utilities/Terminal.app".to_string(),
                available: true,
            });
        }

        // Check for iTerm2
        if let Ok(_) = Command::new("open").args(["-Ra", "iTerm.app"]).output() {
            available_terminals.push(TerminalInfo {
                name: "iTerm2".to_string(),
                path: "/Applications/iTerm.app".to_string(),
                available: true,
            });
        }

        // Check for Warp
        if let Ok(output) = Command::new("which").arg("warp").output() {
            if output.status.success() {
                available_terminals.push(TerminalInfo {
                    name: "Warp".to_string(),
                    path: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                    available: true,
                });
            }
        }

        // Check for Hyper
        if let Ok(_) = Command::new("open").args(["-Ra", "Hyper.app"]).output() {
            available_terminals.push(TerminalInfo {
                name: "Hyper".to_string(),
                path: "/Applications/Hyper.app".to_string(),
                available: true,
            });
        }

        // Check for Alacritty
        if let Ok(output) = Command::new("which").arg("alacritty").output() {
            if output.status.success() {
                available_terminals.push(TerminalInfo {
                    name: "Alacritty".to_string(),
                    path: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                    available: true,
                });
            }
        }

        // Get default terminal from environment or system
        if let Ok(term_program) = std::env::var("TERM_PROGRAM") {
            match term_program.as_str() {
                "Apple_Terminal" => {
                    default_terminal = Some(TerminalInfo {
                        name: "Terminal".to_string(),
                        path: "/System/Applications/Utilities/Terminal.app".to_string(),
                        available: true,
                    });
                }
                "iTerm.app" => {
                    default_terminal = Some(TerminalInfo {
                        name: "iTerm2".to_string(),
                        path: "/Applications/iTerm.app".to_string(),
                        available: true,
                    });
                }
                _ => {}
            }
        }

        // If no default found, use first available
        if default_terminal.is_none() && !available_terminals.is_empty() {
            default_terminal = Some(available_terminals[0].clone());
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Check for Windows Terminal
        if let Ok(output) = Command::new("where").arg("wt.exe").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                available_terminals.push(TerminalInfo {
                    name: "Windows Terminal".to_string(),
                    path: path.clone(),
                    available: true,
                });
                default_terminal = Some(TerminalInfo {
                    name: "Windows Terminal".to_string(),
                    path,
                    available: true,
                });
            }
        }

        // Check for PowerShell
        if let Ok(output) = Command::new("where").arg("powershell.exe").output() {
            if output.status.success() {
                available_terminals.push(TerminalInfo {
                    name: "PowerShell".to_string(),
                    path: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                    available: true,
                });
            }
        }

        // Check for Command Prompt
        if let Ok(output) = Command::new("where").arg("cmd.exe").output() {
            if output.status.success() {
                available_terminals.push(TerminalInfo {
                    name: "Command Prompt".to_string(),
                    path: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                    available: true,
                });
            }
        }

        // Check for Git Bash
        let git_bash_path = "C:\\Program Files\\Git\\git-bash.exe";
        if std::path::Path::new(git_bash_path).exists() {
            available_terminals.push(TerminalInfo {
                name: "Git Bash".to_string(),
                path: git_bash_path.to_string(),
                available: true,
            });
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Check for various Linux terminals
        let terminals = vec![
            ("gnome-terminal", "GNOME Terminal"),
            ("konsole", "Konsole"),
            ("xfce4-terminal", "XFCE Terminal"),
            ("terminator", "Terminator"),
            ("alacritty", "Alacritty"),
            ("kitty", "Kitty"),
            ("tilix", "Tilix"),
            ("xterm", "XTerm"),
        ];

        for (cmd, name) in terminals {
            if let Ok(output) = Command::new("which").arg(cmd).output() {
                if output.status.success() {
                    available_terminals.push(TerminalInfo {
                        name: name.to_string(),
                        path: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                        available: true,
                    });
                }
            }
        }

        // Try to detect default terminal from environment
        if let Ok(desktop) = std::env::var("XDG_CURRENT_DESKTOP") {
            match desktop.to_lowercase().as_str() {
                "gnome" | "ubuntu" => {
                    default_terminal = available_terminals
                        .iter()
                        .find(|t| t.name == "GNOME Terminal")
                        .cloned();
                }
                "kde" => {
                    default_terminal = available_terminals
                        .iter()
                        .find(|t| t.name == "Konsole")
                        .cloned();
                }
                "xfce" => {
                    default_terminal = available_terminals
                        .iter()
                        .find(|t| t.name == "XFCE Terminal")
                        .cloned();
                }
                _ => {}
            }
        }

        // If no default found, use first available
        if default_terminal.is_none() && !available_terminals.is_empty() {
            default_terminal = Some(available_terminals[0].clone());
        }
    }

    Ok(DetectedTerminals {
        default: default_terminal,
        available: available_terminals,
    })
}

#[tauri::command]
pub async fn detect_system_terminals() -> Result<DetectedTerminals, String> {
    detect_terminals()
}

#[tauri::command]
pub async fn get_default_shell() -> Result<String, String> {
    #[cfg(unix)]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            return Ok(shell);
        }

        // Fallback to common shells
        let shells = vec!["/bin/zsh", "/bin/bash", "/bin/sh"];
        for shell in shells {
            if std::path::Path::new(shell).exists() {
                return Ok(shell.to_string());
            }
        }
    }

    #[cfg(windows)]
    {
        // On Windows, default to PowerShell
        if let Ok(output) = Command::new("where").arg("powershell.exe").output() {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }

        // Fallback to cmd
        return Ok("cmd.exe".to_string());
    }

    Err("Could not detect default shell".to_string())
}
