use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use directories::ProjectDirs;
use tauri::{Manager, State};
use crate::state::AppState;
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub show_dock_icon: bool,
    pub default_terminal: String,
    pub default_shell: String,
    pub show_welcome_on_startup: Option<bool>,
    pub theme: Option<String>,
    pub language: Option<String>,
    pub check_updates_automatically: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSettings {
    pub server_port: u16,
    pub enable_password: bool,
    pub password: String,
    pub access_mode: String,
    pub auto_cleanup: bool,
    pub session_limit: Option<u32>,
    pub idle_timeout_minutes: Option<u32>,
    pub enable_cors: Option<bool>,
    pub allowed_origins: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdvancedSettings {
    pub server_mode: String,
    pub debug_mode: bool,
    pub log_level: String,
    pub session_timeout: u32,
    pub ngrok_auth_token: Option<String>,
    pub ngrok_region: Option<String>,
    pub ngrok_subdomain: Option<String>,
    pub enable_telemetry: Option<bool>,
    pub experimental_features: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordingSettings {
    pub enabled: bool,
    pub output_directory: Option<String>,
    pub format: String,
    pub include_timing: bool,
    pub compress_output: bool,
    pub max_file_size_mb: Option<u32>,
    pub auto_save: bool,
    pub filename_template: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TTYForwardSettings {
    pub enabled: bool,
    pub default_port: u16,
    pub bind_address: String,
    pub max_connections: u32,
    pub buffer_size: u32,
    pub keep_alive: bool,
    pub authentication: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitoringSettings {
    pub enabled: bool,
    pub collect_metrics: bool,
    pub metric_interval_seconds: u32,
    pub max_history_size: u32,
    pub alert_on_high_cpu: bool,
    pub alert_on_high_memory: bool,
    pub cpu_threshold_percent: Option<u8>,
    pub memory_threshold_percent: Option<u8>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkSettings {
    pub preferred_interface: Option<String>,
    pub enable_ipv6: bool,
    pub dns_servers: Option<Vec<String>>,
    pub proxy_settings: Option<ProxySettings>,
    pub connection_timeout_seconds: u32,
    pub retry_attempts: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxySettings {
    pub enabled: bool,
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub bypass_list: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortSettings {
    pub auto_resolve_conflicts: bool,
    pub preferred_port_range_start: u16,
    pub preferred_port_range_end: u16,
    pub excluded_ports: Option<Vec<u16>>,
    pub conflict_resolution_strategy: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub show_in_system: bool,
    pub play_sound: bool,
    pub notification_types: HashMap<String, bool>,
    pub do_not_disturb_enabled: Option<bool>,
    pub do_not_disturb_start: Option<String>,
    pub do_not_disturb_end: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalIntegrationSettings {
    pub enabled_terminals: HashMap<String, bool>,
    pub terminal_configs: HashMap<String, TerminalConfig>,
    pub default_terminal_override: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalConfig {
    pub path: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateSettings {
    pub channel: String,
    pub check_frequency: String,
    pub auto_download: bool,
    pub auto_install: bool,
    pub show_release_notes: bool,
    pub include_pre_releases: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SecuritySettings {
    pub enable_encryption: bool,
    pub encryption_algorithm: Option<String>,
    pub require_authentication: bool,
    pub session_token_expiry_hours: Option<u32>,
    pub allowed_ip_addresses: Option<Vec<String>>,
    pub blocked_ip_addresses: Option<Vec<String>>,
    pub rate_limiting_enabled: bool,
    pub rate_limit_requests_per_minute: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DebugSettings {
    pub enable_debug_menu: bool,
    pub show_performance_stats: bool,
    pub enable_verbose_logging: bool,
    pub log_to_file: bool,
    pub log_file_path: Option<String>,
    pub max_log_file_size_mb: Option<u32>,
    pub enable_dev_tools: bool,
    pub show_internal_errors: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub general: GeneralSettings,
    pub dashboard: DashboardSettings,
    pub advanced: AdvancedSettings,
    pub recording: Option<RecordingSettings>,
    pub tty_forward: Option<TTYForwardSettings>,
    pub monitoring: Option<MonitoringSettings>,
    pub network: Option<NetworkSettings>,
    pub port: Option<PortSettings>,
    pub notifications: Option<NotificationSettings>,
    pub terminal_integrations: Option<TerminalIntegrationSettings>,
    pub updates: Option<UpdateSettings>,
    pub security: Option<SecuritySettings>,
    pub debug: Option<DebugSettings>,
}

impl Default for Settings {
    fn default() -> Self {
        let mut default_notification_types = HashMap::new();
        default_notification_types.insert("info".to_string(), true);
        default_notification_types.insert("success".to_string(), true);
        default_notification_types.insert("warning".to_string(), true);
        default_notification_types.insert("error".to_string(), true);
        default_notification_types.insert("server_status".to_string(), true);
        default_notification_types.insert("update_available".to_string(), true);
        
        let mut enabled_terminals = HashMap::new();
        enabled_terminals.insert("Terminal".to_string(), true);
        enabled_terminals.insert("iTerm2".to_string(), true);
        enabled_terminals.insert("Hyper".to_string(), true);
        enabled_terminals.insert("Alacritty".to_string(), true);
        enabled_terminals.insert("Warp".to_string(), true);
        enabled_terminals.insert("Ghostty".to_string(), false);
        enabled_terminals.insert("WezTerm".to_string(), false);
        
        Self {
            general: GeneralSettings {
                launch_at_login: false,
                show_dock_icon: true,
                default_terminal: "system".to_string(),
                default_shell: "default".to_string(),
                show_welcome_on_startup: Some(true),
                theme: Some("auto".to_string()),
                language: Some("en".to_string()),
                check_updates_automatically: Some(true),
            },
            dashboard: DashboardSettings {
                server_port: 4020,
                enable_password: false,
                password: String::new(),
                access_mode: "localhost".to_string(),
                auto_cleanup: true,
                session_limit: Some(10),
                idle_timeout_minutes: Some(30),
                enable_cors: Some(true),
                allowed_origins: Some(vec!["*".to_string()]),
            },
            advanced: AdvancedSettings {
                server_mode: "rust".to_string(),
                debug_mode: false,
                log_level: "info".to_string(),
                session_timeout: 0,
                ngrok_auth_token: None,
                ngrok_region: Some("us".to_string()),
                ngrok_subdomain: None,
                enable_telemetry: Some(false),
                experimental_features: Some(false),
            },
            recording: Some(RecordingSettings {
                enabled: true,
                output_directory: None,
                format: "asciinema".to_string(),
                include_timing: true,
                compress_output: false,
                max_file_size_mb: Some(100),
                auto_save: false,
                filename_template: Some("vibetunnel_%Y%m%d_%H%M%S".to_string()),
            }),
            tty_forward: Some(TTYForwardSettings {
                enabled: false,
                default_port: 8022,
                bind_address: "127.0.0.1".to_string(),
                max_connections: 5,
                buffer_size: 4096,
                keep_alive: true,
                authentication: None,
            }),
            monitoring: Some(MonitoringSettings {
                enabled: true,
                collect_metrics: true,
                metric_interval_seconds: 5,
                max_history_size: 1000,
                alert_on_high_cpu: false,
                alert_on_high_memory: false,
                cpu_threshold_percent: Some(80),
                memory_threshold_percent: Some(80),
            }),
            network: Some(NetworkSettings {
                preferred_interface: None,
                enable_ipv6: true,
                dns_servers: None,
                proxy_settings: None,
                connection_timeout_seconds: 30,
                retry_attempts: 3,
            }),
            port: Some(PortSettings {
                auto_resolve_conflicts: true,
                preferred_port_range_start: 4000,
                preferred_port_range_end: 5000,
                excluded_ports: None,
                conflict_resolution_strategy: "increment".to_string(),
            }),
            notifications: Some(NotificationSettings {
                enabled: true,
                show_in_system: true,
                play_sound: true,
                notification_types: default_notification_types,
                do_not_disturb_enabled: Some(false),
                do_not_disturb_start: None,
                do_not_disturb_end: None,
            }),
            terminal_integrations: Some(TerminalIntegrationSettings {
                enabled_terminals,
                terminal_configs: HashMap::new(),
                default_terminal_override: None,
            }),
            updates: Some(UpdateSettings {
                channel: "stable".to_string(),
                check_frequency: "weekly".to_string(),
                auto_download: false,
                auto_install: false,
                show_release_notes: true,
                include_pre_releases: false,
            }),
            security: Some(SecuritySettings {
                enable_encryption: false,
                encryption_algorithm: Some("aes-256-gcm".to_string()),
                require_authentication: false,
                session_token_expiry_hours: Some(24),
                allowed_ip_addresses: None,
                blocked_ip_addresses: None,
                rate_limiting_enabled: false,
                rate_limit_requests_per_minute: Some(60),
            }),
            debug: Some(DebugSettings {
                enable_debug_menu: false,
                show_performance_stats: false,
                enable_verbose_logging: false,
                log_to_file: false,
                log_file_path: None,
                max_log_file_size_mb: Some(50),
                enable_dev_tools: false,
                show_internal_errors: false,
            }),
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