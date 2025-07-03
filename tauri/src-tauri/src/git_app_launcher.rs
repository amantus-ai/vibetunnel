use serde::{Deserialize, Serialize};
use std::process::Command;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GitApp {
    Cursor,
    Fork,
    GitHubDesktop,
    GitUp,
    SourceTree,
    SublimeMerge,
    Tower,
    VSCode,
    Windsurf,
}

impl GitApp {
    pub fn all() -> Vec<Self> {
        vec![
            Self::Cursor,
            Self::Fork,
            Self::GitHubDesktop,
            Self::GitUp,
            Self::SourceTree,
            Self::SublimeMerge,
            Self::Tower,
            Self::VSCode,
            Self::Windsurf,
        ]
    }

    pub fn raw_value(&self) -> &'static str {
        match self {
            Self::Cursor => "Cursor",
            Self::Fork => "Fork",
            Self::GitHubDesktop => "GitHub Desktop",
            Self::GitUp => "GitUp",
            Self::SourceTree => "SourceTree",
            Self::SublimeMerge => "Sublime Merge",
            Self::Tower => "Tower",
            Self::VSCode => "Visual Studio Code",
            Self::Windsurf => "Windsurf",
        }
    }

    pub fn from_raw_value(value: &str) -> Option<Self> {
        match value {
            "Cursor" => Some(Self::Cursor),
            "Fork" => Some(Self::Fork),
            "GitHub Desktop" => Some(Self::GitHubDesktop),
            "GitUp" => Some(Self::GitUp),
            "SourceTree" => Some(Self::SourceTree),
            "Sublime Merge" => Some(Self::SublimeMerge),
            "Tower" => Some(Self::Tower),
            "Visual Studio Code" => Some(Self::VSCode),
            "Windsurf" => Some(Self::Windsurf),
            _ => None,
        }
    }

    #[cfg(target_os = "macos")]
    pub fn bundle_identifier(&self) -> &'static str {
        match self {
            Self::Cursor => "com.todesktop.230313mzl4w4u92",
            Self::Fork => "com.DanPristupov.Fork",
            Self::GitHubDesktop => "com.github.GitHubClient",
            Self::GitUp => "co.gitup.mac",
            Self::SourceTree => "com.torusknot.SourceTreeNotMAS",
            Self::SublimeMerge => "com.sublimemerge",
            Self::Tower => "com.fournova.Tower3",
            Self::VSCode => "com.microsoft.VSCode",
            Self::Windsurf => "com.codeiumapp.windsurf",
        }
    }

    pub fn detection_priority(&self) -> u8 {
        match self {
            Self::Cursor => 70,
            Self::Fork => 75,
            Self::GitHubDesktop => 90,
            Self::GitUp => 60,
            Self::SourceTree => 80,
            Self::SublimeMerge => 85,
            Self::Tower => 100,
            Self::VSCode => 95,
            Self::Windsurf => 65,
        }
    }

    pub fn display_name(&self) -> &'static str {
        self.raw_value()
    }

    #[cfg(target_os = "macos")]
    pub fn is_installed(&self) -> bool {
        // Check if app is installed using mdfind
        let output = Command::new("mdfind")
            .arg(format!("kMDItemCFBundleIdentifier == '{}'", self.bundle_identifier()))
            .output()
            .ok();

        output
            .map(|o| !o.stdout.is_empty())
            .unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    pub fn is_installed(&self) -> bool {
        // Check common installation paths on Windows
        match self {
            Self::VSCode => {
                // Check if VS Code is in PATH
                Command::new("code")
                    .arg("--version")
                    .output()
                    .is_ok()
            }
            Self::GitHubDesktop => {
                // Check for GitHub Desktop in AppData
                let app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
                std::path::Path::new(&app_data)
                    .join("GitHubDesktop")
                    .join("GitHubDesktop.exe")
                    .exists()
            }
            Self::Fork => {
                // Check for Fork in Program Files
                let program_files = std::env::var("ProgramFiles").unwrap_or_default();
                std::path::Path::new(&program_files)
                    .join("Fork")
                    .join("Fork.exe")
                    .exists()
            }
            Self::SourceTree => {
                // Check for SourceTree in AppData
                let app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
                std::path::Path::new(&app_data)
                    .join("SourceTree")
                    .join("SourceTree.exe")
                    .exists()
            }
            Self::SublimeMerge => {
                // Check if Sublime Merge is in PATH
                Command::new("smerge")
                    .arg("--version")
                    .output()
                    .is_ok()
            }
            _ => false,
        }
    }

    #[cfg(target_os = "linux")]
    pub fn is_installed(&self) -> bool {
        // Check if application is available in PATH
        match self {
            Self::VSCode => Command::new("code").arg("--version").output().is_ok(),
            Self::SublimeMerge => Command::new("smerge").arg("--version").output().is_ok(),
            _ => false,
        }
    }

    pub fn installed_apps() -> Vec<Self> {
        Self::all()
            .into_iter()
            .filter(|app| app.is_installed())
            .collect()
    }
}

pub struct GitAppLauncher;

impl GitAppLauncher {
    /// Open a repository in the preferred Git app
    pub fn open_repository(path: &str) -> Result<(), String> {
        let git_app = Self::get_preferred_git_app();
        
        #[cfg(target_os = "macos")]
        {
            if let Some(app) = git_app {
                // Use open command with bundle identifier
                let output = Command::new("open")
                    .arg("-b")
                    .arg(app.bundle_identifier())
                    .arg(path)
                    .output()
                    .map_err(|e| format!("Failed to launch Git app: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("Failed to open Git app: {}", stderr));
                }
            } else {
                // Fallback to opening in Finder
                Command::new("open")
                    .arg(path)
                    .spawn()
                    .map_err(|e| format!("Failed to open in Finder: {}", e))?;
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(app) = git_app {
                match app {
                    GitApp::VSCode => {
                        Command::new("code")
                            .arg(path)
                            .spawn()
                            .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
                    }
                    GitApp::GitHubDesktop => {
                        let app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
                        let github_desktop = std::path::Path::new(&app_data)
                            .join("GitHubDesktop")
                            .join("GitHubDesktop.exe");
                        
                        Command::new(github_desktop)
                            .arg(path)
                            .spawn()
                            .map_err(|e| format!("Failed to launch GitHub Desktop: {}", e))?;
                    }
                    _ => {
                        // Fallback to Explorer
                        Command::new("explorer")
                            .arg(path)
                            .spawn()
                            .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
                    }
                }
            } else {
                // Fallback to Explorer
                Command::new("explorer")
                    .arg(path)
                    .spawn()
                    .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
            }
        }

        #[cfg(target_os = "linux")]
        {
            if let Some(app) = git_app {
                match app {
                    GitApp::VSCode => {
                        Command::new("code")
                            .arg(path)
                            .spawn()
                            .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
                    }
                    _ => {
                        // Fallback to file manager
                        Command::new("xdg-open")
                            .arg(path)
                            .spawn()
                            .map_err(|e| format!("Failed to open in file manager: {}", e))?;
                    }
                }
            } else {
                // Fallback to file manager
                Command::new("xdg-open")
                    .arg(path)
                    .spawn()
                    .map_err(|e| format!("Failed to open in file manager: {}", e))?;
            }
        }

        Ok(())
    }

    /// Get the preferred Git app from settings
    pub fn get_preferred_git_app() -> Option<GitApp> {
        if let Ok(settings) = crate::settings::Settings::load() {
            if let Some(app_name) = settings.advanced.preferred_git_app {
                return GitApp::from_raw_value(&app_name);
            }
        }

        // If no preference set, auto-detect the best available
        Self::auto_detect_git_app()
    }

    /// Auto-detect the best available Git app
    pub fn auto_detect_git_app() -> Option<GitApp> {
        let installed = GitApp::installed_apps();
        
        // Sort by priority and return the highest priority app
        installed
            .into_iter()
            .max_by_key(|app| app.detection_priority())
    }

    /// Set the preferred Git app and save to settings
    pub fn set_preferred_git_app(app: Option<&GitApp>) -> Result<(), String> {
        let mut settings = crate::settings::Settings::load().unwrap_or_default();
        settings.advanced.preferred_git_app = app.map(|a| a.raw_value().to_string());
        settings.save().map_err(|e| e.to_string())
    }

    /// Verify that the preferred Git app is still installed
    pub fn verify_preferred_git_app() -> Result<(), String> {
        if let Some(app) = Self::get_preferred_git_app() {
            if !app.is_installed() {
                // Clear the preference if app is no longer installed
                Self::set_preferred_git_app(None)?;
                info!("Cleared preferred Git app as it's no longer installed");
            }
        }
        Ok(())
    }
}

// Commands
#[derive(serde::Serialize)]
pub struct GitAppOption {
    pub value: String,
    pub label: String,
}

#[tauri::command]
pub fn get_installed_git_apps() -> Vec<GitAppOption> {
    GitApp::installed_apps()
        .into_iter()
        .map(|app| GitAppOption {
            value: app.raw_value().to_string(),
            label: app.raw_value().to_string(),
        })
        .collect()
}

#[tauri::command]
pub fn get_preferred_git_app() -> Option<String> {
    GitAppLauncher::get_preferred_git_app()
        .map(|app| app.raw_value().to_string())
}

#[tauri::command]
pub fn set_preferred_git_app(app: Option<String>) -> Result<(), String> {
    let git_app = app.and_then(|name| GitApp::from_raw_value(&name));
    GitAppLauncher::set_preferred_git_app(git_app.as_ref())
}

#[tauri::command]
pub fn open_repository_in_git_app(path: String) -> Result<(), String> {
    GitAppLauncher::open_repository(&path)
}

#[tauri::command]
pub fn verify_git_app_installation() -> Result<(), String> {
    GitAppLauncher::verify_preferred_git_app()
}