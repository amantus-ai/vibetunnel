use serde::Serialize;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

const CLI_SCRIPT: &str = r#"#!/bin/bash
# VibeTunnel CLI wrapper

# Get the VibeTunnel app path
if [ -d "/Applications/VibeTunnel.app" ]; then
    APP_PATH="/Applications/VibeTunnel.app"
elif [ -d "$HOME/Applications/VibeTunnel.app" ]; then
    APP_PATH="$HOME/Applications/VibeTunnel.app"
else
    echo "Error: VibeTunnel.app not found in /Applications or ~/Applications"
    exit 1
fi

# Launch VibeTunnel with CLI arguments
"$APP_PATH/Contents/MacOS/VibeTunnel" --cli "$@"
"#;

#[cfg(target_os = "windows")]
const WINDOWS_CLI_SCRIPT: &str = r#"@echo off
:: VibeTunnel CLI wrapper for Windows

:: Get the VibeTunnel installation path
set "APP_PATH=%LOCALAPPDATA%\VibeTunnel\VibeTunnel.exe"

if not exist "%APP_PATH%" (
    echo Error: VibeTunnel.exe not found in %LOCALAPPDATA%\VibeTunnel\
    exit /b 1
)

:: Launch VibeTunnel with CLI arguments
"%APP_PATH%" --cli %*
"#;

#[cfg(target_os = "linux")]
const LINUX_CLI_SCRIPT: &str = r#"#!/bin/bash
# VibeTunnel CLI wrapper for Linux

# Try common installation paths
if [ -x "/usr/local/bin/vibetunnel" ]; then
    APP_PATH="/usr/local/bin/vibetunnel"
elif [ -x "/opt/vibetunnel/vibetunnel" ]; then
    APP_PATH="/opt/vibetunnel/vibetunnel"
elif [ -x "$HOME/.local/bin/vibetunnel" ]; then
    APP_PATH="$HOME/.local/bin/vibetunnel"
else
    echo "Error: VibeTunnel executable not found"
    exit 1
fi

# Launch VibeTunnel with CLI arguments
"$APP_PATH" --cli "$@"
"#;

#[derive(Debug, Serialize)]
pub struct CliInstallResult {
    pub installed: bool,
    pub path: String,
    pub message: String,
}

pub fn install_cli_tool() -> Result<CliInstallResult, String> {
    #[cfg(target_os = "macos")]
    {
        install_cli_macos()
    }

    #[cfg(target_os = "windows")]
    {
        install_cli_windows()
    }

    #[cfg(target_os = "linux")]
    {
        install_cli_linux()
    }
}

#[cfg(target_os = "macos")]
fn install_cli_macos() -> Result<CliInstallResult, String> {
    let cli_path = PathBuf::from("/usr/local/bin/vt");

    // Check if /usr/local/bin exists, create if not
    let bin_dir = cli_path.parent().unwrap();
    if !bin_dir.exists() {
        fs::create_dir_all(bin_dir).map_err(|e| {
            format!(
                "Failed to create /usr/local/bin: {}. Try running with sudo.",
                e
            )
        })?;
    }

    // Write the CLI script
    fs::write(&cli_path, CLI_SCRIPT)
        .map_err(|e| format!("Failed to write CLI script: {}. Try running with sudo.", e))?;

    // Make it executable
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&cli_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&cli_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    Ok(CliInstallResult {
        installed: true,
        path: cli_path.to_string_lossy().to_string(),
        message: "CLI tool installed successfully at /usr/local/bin/vt".to_string(),
    })
}

#[cfg(target_os = "windows")]
fn install_cli_windows() -> Result<CliInstallResult, String> {
    let user_path = std::env::var("USERPROFILE").map_err(|_| "Failed to get user profile path")?;

    let cli_dir = PathBuf::from(&user_path).join(".vibetunnel");
    let cli_path = cli_dir.join("vt.cmd");

    // Create directory if it doesn't exist
    if !cli_dir.exists() {
        fs::create_dir_all(&cli_dir)
            .map_err(|e| format!("Failed to create CLI directory: {}", e))?;
    }

    // Write the CLI script
    fs::write(&cli_path, WINDOWS_CLI_SCRIPT)
        .map_err(|e| format!("Failed to write CLI script: {}", e))?;

    // Add to PATH if not already there
    add_to_windows_path(&cli_dir)?;

    Ok(CliInstallResult {
        installed: true,
        path: cli_path.to_string_lossy().to_string(),
        message: format!(
            "CLI tool installed successfully at {}. Restart your terminal to use 'vt' command.",
            cli_path.display()
        ),
    })
}

#[cfg(target_os = "linux")]
fn install_cli_linux() -> Result<CliInstallResult, String> {
    let home_dir = std::env::var("HOME").map_err(|_| "Failed to get home directory")?;

    let local_bin = PathBuf::from(&home_dir).join(".local").join("bin");
    let cli_path = local_bin.join("vt");

    // Create ~/.local/bin if it doesn't exist
    if !local_bin.exists() {
        fs::create_dir_all(&local_bin)
            .map_err(|e| format!("Failed to create ~/.local/bin: {}", e))?;
    }

    // Write the CLI script
    fs::write(&cli_path, LINUX_CLI_SCRIPT)
        .map_err(|e| format!("Failed to write CLI script: {}", e))?;

    // Make it executable
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&cli_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&cli_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    Ok(CliInstallResult {
        installed: true,
        path: cli_path.to_string_lossy().to_string(),
        message: format!(
            "CLI tool installed successfully at {}. Make sure ~/.local/bin is in your PATH.",
            cli_path.display()
        ),
    })
}

#[cfg(target_os = "windows")]
fn add_to_windows_path(dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env = hkcu
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("Failed to open registry key: {}", e))?;

        let path: String = env.get_value("Path").unwrap_or_default();
        let dir_str = dir.to_string_lossy();

        if !path.contains(&*dir_str) {
            let new_path = if path.is_empty() {
                dir_str.to_string()
            } else {
                format!("{};{}", path, dir_str)
            };

            env.set_value("Path", &new_path)
                .map_err(|e| format!("Failed to update PATH: {}", e))?;
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        Ok(())
    }
}

pub fn uninstall_cli_tool() -> Result<CliInstallResult, String> {
    #[cfg(target_os = "macos")]
    {
        let cli_path = PathBuf::from("/usr/local/bin/vt");
        if cli_path.exists() {
            fs::remove_file(&cli_path)
                .map_err(|e| format!("Failed to remove CLI tool: {}. Try running with sudo.", e))?;
        }

        Ok(CliInstallResult {
            installed: false,
            path: cli_path.to_string_lossy().to_string(),
            message: "CLI tool uninstalled successfully".to_string(),
        })
    }

    #[cfg(target_os = "windows")]
    {
        let user_path =
            std::env::var("USERPROFILE").map_err(|_| "Failed to get user profile path")?;
        let cli_path = PathBuf::from(&user_path).join(".vibetunnel").join("vt.cmd");

        if cli_path.exists() {
            fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI tool: {}", e))?;
        }

        Ok(CliInstallResult {
            installed: false,
            path: cli_path.to_string_lossy().to_string(),
            message: "CLI tool uninstalled successfully".to_string(),
        })
    }

    #[cfg(target_os = "linux")]
    {
        let home_dir = std::env::var("HOME").map_err(|_| "Failed to get home directory")?;
        let cli_path = PathBuf::from(&home_dir)
            .join(".local")
            .join("bin")
            .join("vt");

        if cli_path.exists() {
            fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI tool: {}", e))?;
        }

        Ok(CliInstallResult {
            installed: false,
            path: cli_path.to_string_lossy().to_string(),
            message: "CLI tool uninstalled successfully".to_string(),
        })
    }
}

pub fn is_cli_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/usr/local/bin/vt").exists()
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(user_path) = std::env::var("USERPROFILE") {
            PathBuf::from(&user_path)
                .join(".vibetunnel")
                .join("vt.cmd")
                .exists()
        } else {
            false
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home_dir) = std::env::var("HOME") {
            PathBuf::from(&home_dir)
                .join(".local")
                .join("bin")
                .join("vt")
                .exists()
        } else {
            false
        }
    }
}

#[tauri::command]
pub fn install_cli() -> Result<CliInstallResult, String> {
    install_cli_tool()
}

#[tauri::command]
pub fn uninstall_cli() -> Result<CliInstallResult, String> {
    uninstall_cli_tool()
}

#[tauri::command]
pub fn check_cli_installed() -> Result<bool, String> {
    Ok(is_cli_installed())
}
