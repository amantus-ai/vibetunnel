use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use directories::ProjectDirs;
use tauri::{Manager, State};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub show_dock_icon: bool,
    pub default_terminal: String,
    pub default_shell: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSettings {
    pub server_port: u16,
    pub enable_password: bool,
    pub password: String,
    pub access_mode: String,
    pub auto_cleanup: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdvancedSettings {
    pub server_mode: String,
    pub debug_mode: bool,
    pub log_level: String,
    pub session_timeout: u32,
    pub ngrok_auth_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub general: GeneralSettings,
    pub dashboard: DashboardSettings,
    pub advanced: AdvancedSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            general: GeneralSettings {
                launch_at_login: false,
                show_dock_icon: true,
                default_terminal: "system".to_string(),
                default_shell: "default".to_string(),
            },
            dashboard: DashboardSettings {
                server_port: 4020,
                enable_password: false,
                password: String::new(),
                access_mode: "localhost".to_string(),
                auto_cleanup: true,
            },
            advanced: AdvancedSettings {
                server_mode: "rust".to_string(),
                debug_mode: false,
                log_level: "info".to_string(),
                session_timeout: 0,
                ngrok_auth_token: None,
            },
        }
    }
}

impl Settings {
    pub fn load() -> Result<Self, String> {
        let config_path = Self::config_path()?;
        
        if !config_path.exists() {
            return Ok(Self::default());
        }
        
        let contents = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
            
        toml::from_str(&contents)
            .map_err(|e| format!("Failed to parse settings: {}", e))
    }
    
    pub fn save(&self) -> Result<(), String> {
        let config_path = Self::config_path()?;
        
        // Ensure the config directory exists
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
        
        let contents = toml::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
            
        std::fs::write(&config_path, contents)
            .map_err(|e| format!("Failed to write settings: {}", e))?;
            
        Ok(())
    }
    
    fn config_path() -> Result<PathBuf, String> {
        let proj_dirs = ProjectDirs::from("com", "vibetunnel", "VibeTunnel")
            .ok_or_else(|| "Failed to get project directories".to_string())?;
            
        Ok(proj_dirs.config_dir().join("settings.toml"))
    }
}

#[tauri::command]
pub async fn get_settings(
    _state: State<'_, AppState>,
) -> Result<Settings, String> {
    Settings::load()
}

#[tauri::command]
pub async fn save_settings(
    settings: Settings,
    _state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    settings.save()?;
    
    // Apply settings that need immediate effect
    if settings.general.launch_at_login {
        crate::auto_launch::enable_auto_launch()?;
    } else {
        crate::auto_launch::disable_auto_launch()?;
    }
    
    // Apply dock icon visibility on macOS
    #[cfg(target_os = "macos")]
    {
        // Check if any windows are visible
        let has_visible_windows = app.windows().values().any(|w| w.is_visible().unwrap_or(false));
        
        if !has_visible_windows && !settings.general.show_dock_icon {
            // Hide dock icon if no windows are visible and setting is disabled
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        } else if settings.general.show_dock_icon && !has_visible_windows {
            // Show dock icon if setting is enabled (even with no windows)
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        }
        // Note: If windows are visible, we always show the dock icon regardless of setting
    }
    
    Ok(())
}