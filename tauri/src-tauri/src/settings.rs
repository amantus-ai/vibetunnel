use crate::state::AppState;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Manager, State};

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
    pub prompt_move_to_applications: Option<bool>,
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
    pub debug_mode: bool,
    pub log_level: String,
    pub session_timeout: u32,
    pub ngrok_auth_token: Option<String>,
    pub ngrok_region: Option<String>,
    pub ngrok_subdomain: Option<String>,
    pub enable_telemetry: Option<bool>,
    pub experimental_features: Option<bool>,
    pub preferred_git_app: Option<String>,
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
                prompt_move_to_applications: None,
            },
            dashboard: DashboardSettings {
                server_port: 4022,
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
                debug_mode: false,
                log_level: "info".to_string(),
                session_timeout: 0,
                ngrok_auth_token: None,
                ngrok_region: Some("us".to_string()),
                ngrok_subdomain: None,
                enable_telemetry: Some(false),
                experimental_features: Some(false),
                preferred_git_app: None,
            },
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

        let mut settings = if config_path.exists() {
            let contents = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read settings: {e}"))?;

            toml::from_str(&contents).map_err(|e| format!("Failed to parse settings: {e}"))?
        } else {
            Self::default()
        };

        // Load passwords from keychain
        if let Ok(Some(password)) = crate::keychain::KeychainManager::get_dashboard_password() {
            settings.dashboard.password = password;
        }

        if let Ok(Some(token)) = crate::keychain::KeychainManager::get_ngrok_auth_token() {
            settings.advanced.ngrok_auth_token = Some(token);
        }

        Ok(settings)
    }

    pub fn save(&self) -> Result<(), String> {
        let config_path = Self::config_path()?;

        // Ensure the config directory exists
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }

        // Clone settings to remove sensitive data before saving
        let mut settings_to_save = self.clone();

        // Save passwords to keychain and remove from TOML
        if !self.dashboard.password.is_empty() {
            crate::keychain::KeychainManager::set_dashboard_password(&self.dashboard.password)
                .map_err(|e| {
                    format!(
                        "Failed to save dashboard password to keychain: {}",
                        e.message
                    )
                })?;
            settings_to_save.dashboard.password = String::new();
        }

        if let Some(ref token) = self.advanced.ngrok_auth_token {
            if !token.is_empty() {
                crate::keychain::KeychainManager::set_ngrok_auth_token(token).map_err(|e| {
                    format!("Failed to save ngrok token to keychain: {}", e.message)
                })?;
                settings_to_save.advanced.ngrok_auth_token = None;
            }
        }

        let contents = toml::to_string_pretty(&settings_to_save)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;

        std::fs::write(&config_path, contents)
            .map_err(|e| format!("Failed to write settings: {e}"))?;

        Ok(())
    }

    fn config_path() -> Result<PathBuf, String> {
        let proj_dirs = ProjectDirs::from("com", "vibetunnel", "VibeTunnel")
            .ok_or_else(|| "Failed to get project directories".to_string())?;

        Ok(proj_dirs.config_dir().join("settings.toml"))
    }

    /// Migrate passwords from settings file to keychain (one-time operation)
    #[allow(dead_code)]
    pub fn migrate_passwords_to_keychain(&self) -> Result<(), String> {
        // Check if we have passwords in the settings file that need migration
        let config_path = Self::config_path()?;
        if !config_path.exists() {
            return Ok(());
        }

        let contents = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read settings for migration: {e}"))?;

        let raw_settings: Self = toml::from_str(&contents)
            .map_err(|e| format!("Failed to parse settings for migration: {e}"))?;

        let mut migrated = false;

        // Migrate dashboard password if present in file
        if !raw_settings.dashboard.password.is_empty() {
            crate::keychain::KeychainManager::set_dashboard_password(
                &raw_settings.dashboard.password,
            )
            .map_err(|e| format!("Failed to migrate dashboard password: {}", e.message))?;
            migrated = true;
        }

        // Migrate ngrok token if present in file
        if let Some(ref token) = raw_settings.advanced.ngrok_auth_token {
            if !token.is_empty() {
                crate::keychain::KeychainManager::set_ngrok_auth_token(token)
                    .map_err(|e| format!("Failed to migrate ngrok token: {}", e.message))?;
                migrated = true;
            }
        }

        // If we migrated anything, save the settings again to remove passwords from file
        if migrated {
            self.save()?;
        }

        Ok(())
    }
}

#[tauri::command]
pub async fn get_settings(_state: State<'_, AppState>) -> Result<Settings, String> {
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
        let has_visible_windows = app
            .windows()
            .values()
            .any(|w| w.is_visible().unwrap_or(false));

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_general_settings_default() {
        let settings = GeneralSettings {
            launch_at_login: false,
            show_dock_icon: true,
            default_terminal: "system".to_string(),
            default_shell: "default".to_string(),
            show_welcome_on_startup: Some(true),
            theme: Some("auto".to_string()),
            language: Some("en".to_string()),
            check_updates_automatically: Some(true),
            prompt_move_to_applications: None,
        };

        assert!(!settings.launch_at_login);
        assert!(settings.show_dock_icon);
        assert_eq!(settings.default_terminal, "system");
        assert_eq!(settings.default_shell, "default");
        assert_eq!(settings.show_welcome_on_startup, Some(true));
        assert_eq!(settings.theme, Some("auto".to_string()));
        assert_eq!(settings.language, Some("en".to_string()));
        assert_eq!(settings.check_updates_automatically, Some(true));
        assert!(settings.prompt_move_to_applications.is_none());
    }

    #[test]
    fn test_dashboard_settings_default() {
        let settings = DashboardSettings {
            server_port: 4022,
            enable_password: false,
            password: String::new(),
            access_mode: "localhost".to_string(),
            auto_cleanup: true,
            session_limit: Some(10),
            idle_timeout_minutes: Some(30),
            enable_cors: Some(true),
            allowed_origins: Some(vec!["*".to_string()]),
        };

        assert_eq!(settings.server_port, 4022);
        assert!(!settings.enable_password);
        assert_eq!(settings.password, "");
        assert_eq!(settings.access_mode, "localhost");
        assert!(settings.auto_cleanup);
        assert_eq!(settings.session_limit, Some(10));
        assert_eq!(settings.idle_timeout_minutes, Some(30));
        assert_eq!(settings.enable_cors, Some(true));
        assert_eq!(settings.allowed_origins, Some(vec!["*".to_string()]));
    }

    #[test]
    fn test_advanced_settings_default() {
        let settings = AdvancedSettings {
            debug_mode: false,
            log_level: "info".to_string(),
            session_timeout: 0,
            ngrok_auth_token: None,
            ngrok_region: Some("us".to_string()),
            ngrok_subdomain: None,
            enable_telemetry: Some(false),
            experimental_features: Some(false),
        };

        assert!(!settings.debug_mode);
        assert_eq!(settings.log_level, "info");
        assert_eq!(settings.session_timeout, 0);
        assert!(settings.ngrok_auth_token.is_none());
        assert_eq!(settings.ngrok_region, Some("us".to_string()));
        assert!(settings.ngrok_subdomain.is_none());
        assert_eq!(settings.enable_telemetry, Some(false));
        assert_eq!(settings.experimental_features, Some(false));
    }

    #[test]
    fn test_tty_forward_settings() {
        let settings = TTYForwardSettings {
            enabled: false,
            default_port: 8022,
            bind_address: "127.0.0.1".to_string(),
            max_connections: 5,
            buffer_size: 4096,
            keep_alive: true,
            authentication: None,
        };

        assert!(!settings.enabled);
        assert_eq!(settings.default_port, 8022);
        assert_eq!(settings.bind_address, "127.0.0.1");
        assert_eq!(settings.max_connections, 5);
        assert_eq!(settings.buffer_size, 4096);
        assert!(settings.keep_alive);
        assert!(settings.authentication.is_none());
    }

    #[test]
    fn test_monitoring_settings() {
        let settings = MonitoringSettings {
            enabled: true,
            collect_metrics: true,
            metric_interval_seconds: 5,
            max_history_size: 1000,
            alert_on_high_cpu: false,
            alert_on_high_memory: false,
            cpu_threshold_percent: Some(80),
            memory_threshold_percent: Some(80),
        };

        assert!(settings.enabled);
        assert!(settings.collect_metrics);
        assert_eq!(settings.metric_interval_seconds, 5);
        assert_eq!(settings.max_history_size, 1000);
        assert!(!settings.alert_on_high_cpu);
        assert!(!settings.alert_on_high_memory);
        assert_eq!(settings.cpu_threshold_percent, Some(80));
        assert_eq!(settings.memory_threshold_percent, Some(80));
    }

    #[test]
    fn test_network_settings() {
        let settings = NetworkSettings {
            preferred_interface: None,
            enable_ipv6: true,
            dns_servers: None,
            proxy_settings: None,
            connection_timeout_seconds: 30,
            retry_attempts: 3,
        };

        assert!(settings.preferred_interface.is_none());
        assert!(settings.enable_ipv6);
        assert!(settings.dns_servers.is_none());
        assert!(settings.proxy_settings.is_none());
        assert_eq!(settings.connection_timeout_seconds, 30);
        assert_eq!(settings.retry_attempts, 3);
    }

    #[test]
    fn test_proxy_settings() {
        let settings = ProxySettings {
            enabled: true,
            proxy_type: "http".to_string(),
            host: "proxy.example.com".to_string(),
            port: 8080,
            username: Some("user".to_string()),
            password: Some("pass".to_string()),
            bypass_list: Some(vec!["localhost".to_string(), "127.0.0.1".to_string()]),
        };

        assert!(settings.enabled);
        assert_eq!(settings.proxy_type, "http");
        assert_eq!(settings.host, "proxy.example.com");
        assert_eq!(settings.port, 8080);
        assert_eq!(settings.username, Some("user".to_string()));
        assert_eq!(settings.password, Some("pass".to_string()));
        assert_eq!(
            settings.bypass_list,
            Some(vec!["localhost".to_string(), "127.0.0.1".to_string()])
        );
    }

    #[test]
    fn test_port_settings() {
        let settings = PortSettings {
            auto_resolve_conflicts: true,
            preferred_port_range_start: 4000,
            preferred_port_range_end: 5000,
            excluded_ports: Some(vec![4022, 8080]),
            conflict_resolution_strategy: "increment".to_string(),
        };

        assert!(settings.auto_resolve_conflicts);
        assert_eq!(settings.preferred_port_range_start, 4000);
        assert_eq!(settings.preferred_port_range_end, 5000);
        assert_eq!(settings.excluded_ports, Some(vec![4022, 8080]));
        assert_eq!(settings.conflict_resolution_strategy, "increment");
    }

    #[test]
    fn test_notification_settings() {
        let mut notification_types = HashMap::new();
        notification_types.insert("info".to_string(), true);
        notification_types.insert("error".to_string(), false);

        let settings = NotificationSettings {
            enabled: true,
            show_in_system: true,
            play_sound: false,
            notification_types,
            do_not_disturb_enabled: Some(true),
            do_not_disturb_start: Some("22:00".to_string()),
            do_not_disturb_end: Some("08:00".to_string()),
        };

        assert!(settings.enabled);
        assert!(settings.show_in_system);
        assert!(!settings.play_sound);
        assert_eq!(settings.notification_types.get("info"), Some(&true));
        assert_eq!(settings.notification_types.get("error"), Some(&false));
        assert_eq!(settings.do_not_disturb_enabled, Some(true));
        assert_eq!(settings.do_not_disturb_start, Some("22:00".to_string()));
        assert_eq!(settings.do_not_disturb_end, Some("08:00".to_string()));
    }

    #[test]
    fn test_terminal_config() {
        let mut env = HashMap::new();
        env.insert("TERM".to_string(), "xterm-256color".to_string());

        let config = TerminalConfig {
            path: Some("/usr/local/bin/terminal".to_string()),
            args: Some(vec!["--new-session".to_string()]),
            env: Some(env),
            working_directory: Some("/home/user".to_string()),
        };

        assert_eq!(config.path, Some("/usr/local/bin/terminal".to_string()));
        assert_eq!(config.args, Some(vec!["--new-session".to_string()]));
        assert_eq!(
            config.env.as_ref().unwrap().get("TERM"),
            Some(&"xterm-256color".to_string())
        );
        assert_eq!(config.working_directory, Some("/home/user".to_string()));
    }

    #[test]
    fn test_update_settings() {
        let settings = UpdateSettings {
            channel: "stable".to_string(),
            check_frequency: "weekly".to_string(),
            auto_download: false,
            auto_install: false,
            show_release_notes: true,
            include_pre_releases: false,
        };

        assert_eq!(settings.channel, "stable");
        assert_eq!(settings.check_frequency, "weekly");
        assert!(!settings.auto_download);
        assert!(!settings.auto_install);
        assert!(settings.show_release_notes);
        assert!(!settings.include_pre_releases);
    }

    #[test]
    fn test_security_settings() {
        let settings = SecuritySettings {
            enable_encryption: true,
            encryption_algorithm: Some("aes-256-gcm".to_string()),
            require_authentication: true,
            session_token_expiry_hours: Some(24),
            allowed_ip_addresses: Some(vec!["192.168.1.0/24".to_string()]),
            blocked_ip_addresses: Some(vec!["10.0.0.0/8".to_string()]),
            rate_limiting_enabled: true,
            rate_limit_requests_per_minute: Some(60),
        };

        assert!(settings.enable_encryption);
        assert_eq!(
            settings.encryption_algorithm,
            Some("aes-256-gcm".to_string())
        );
        assert!(settings.require_authentication);
        assert_eq!(settings.session_token_expiry_hours, Some(24));
        assert_eq!(
            settings.allowed_ip_addresses,
            Some(vec!["192.168.1.0/24".to_string()])
        );
        assert_eq!(
            settings.blocked_ip_addresses,
            Some(vec!["10.0.0.0/8".to_string()])
        );
        assert!(settings.rate_limiting_enabled);
        assert_eq!(settings.rate_limit_requests_per_minute, Some(60));
    }

    #[test]
    fn test_debug_settings() {
        let settings = DebugSettings {
            enable_debug_menu: true,
            show_performance_stats: true,
            enable_verbose_logging: false,
            log_to_file: true,
            log_file_path: Some("/var/log/vibetunnel.log".to_string()),
            max_log_file_size_mb: Some(100),
            enable_dev_tools: false,
            show_internal_errors: true,
        };

        assert!(settings.enable_debug_menu);
        assert!(settings.show_performance_stats);
        assert!(!settings.enable_verbose_logging);
        assert!(settings.log_to_file);
        assert_eq!(
            settings.log_file_path,
            Some("/var/log/vibetunnel.log".to_string())
        );
        assert_eq!(settings.max_log_file_size_mb, Some(100));
        assert!(!settings.enable_dev_tools);
        assert!(settings.show_internal_errors);
    }

    #[test]
    fn test_settings_default() {
        let settings = Settings::default();

        // Test that all required fields have defaults
        assert_eq!(settings.general.default_terminal, "system");
        assert_eq!(settings.dashboard.server_port, 4022);
        assert_eq!(settings.advanced.log_level, "info");

        // Test that optional fields have sensible defaults
        assert!(settings.tty_forward.is_some());
        assert!(settings.monitoring.is_some());
        assert!(settings.network.is_some());
        assert!(settings.port.is_some());
        assert!(settings.notifications.is_some());
        assert!(settings.terminal_integrations.is_some());
        assert!(settings.updates.is_some());
        assert!(settings.security.is_some());
        assert!(settings.debug.is_some());
    }

    #[test]
    fn test_settings_serialization() {
        let settings = Settings::default();

        // Test that settings can be serialized to TOML
        let toml_result = toml::to_string_pretty(&settings);
        assert!(toml_result.is_ok());

        let toml_str = toml_result.unwrap();
        assert!(toml_str.contains("[general]"));
        assert!(toml_str.contains("[dashboard]"));
        assert!(toml_str.contains("[advanced]"));
    }

    #[test]
    fn test_settings_deserialization() {
        let toml_str = r#"
[general]
launch_at_login = true
show_dock_icon = false
default_terminal = "iTerm2"
default_shell = "/bin/zsh"

[dashboard]
server_port = 8080
enable_password = true
password = ""
access_mode = "network"
auto_cleanup = false

[advanced]
debug_mode = true
log_level = "debug"
session_timeout = 3600
"#;

        let settings_result: Result<Settings, _> = toml::from_str(toml_str);
        assert!(settings_result.is_ok());

        let settings = settings_result.unwrap();
        assert!(settings.general.launch_at_login);
        assert!(!settings.general.show_dock_icon);
        assert_eq!(settings.general.default_terminal, "iTerm2");
        assert_eq!(settings.general.default_shell, "/bin/zsh");
        assert_eq!(settings.dashboard.server_port, 8080);
        assert!(settings.dashboard.enable_password);
        assert_eq!(settings.dashboard.access_mode, "network");
        assert!(!settings.dashboard.auto_cleanup);
        assert!(settings.advanced.debug_mode);
        assert_eq!(settings.advanced.log_level, "debug");
        assert_eq!(settings.advanced.session_timeout, 3600);
    }

    #[test]
    fn test_settings_partial_deserialization() {
        // Test that missing optional fields don't cause deserialization to fail
        let toml_str = r#"
[general]
launch_at_login = false
show_dock_icon = true
default_terminal = "system"
default_shell = "default"

[dashboard]
server_port = 4022
enable_password = false
password = ""
access_mode = "localhost"
auto_cleanup = true

[advanced]
debug_mode = false
log_level = "info"
session_timeout = 0
"#;

        let settings_result: Result<Settings, _> = toml::from_str(toml_str);
        assert!(settings_result.is_ok());

        let settings = settings_result.unwrap();
        // All optional sections should be None
        assert!(settings.tty_forward.is_none());
        assert!(settings.monitoring.is_none());
        assert!(settings.network.is_none());
    }

    #[test]
    fn test_terminal_integration_settings() {
        let mut enabled_terminals = HashMap::new();
        enabled_terminals.insert("Terminal".to_string(), true);
        enabled_terminals.insert("iTerm2".to_string(), false);

        let mut terminal_configs = HashMap::new();
        terminal_configs.insert(
            "Terminal".to_string(),
            TerminalConfig {
                path: Some("/System/Applications/Utilities/Terminal.app".to_string()),
                args: None,
                env: None,
                working_directory: None,
            },
        );

        let settings = TerminalIntegrationSettings {
            enabled_terminals,
            terminal_configs,
            default_terminal_override: Some("Terminal".to_string()),
        };

        assert_eq!(settings.enabled_terminals.get("Terminal"), Some(&true));
        assert_eq!(settings.enabled_terminals.get("iTerm2"), Some(&false));
        assert!(settings.terminal_configs.contains_key("Terminal"));
        assert_eq!(
            settings.default_terminal_override,
            Some("Terminal".to_string())
        );
    }

    #[test]
    fn test_settings_clone() {
        let original = Settings::default();
        let cloned = original.clone();

        // Verify that clone produces identical values
        assert_eq!(
            original.general.launch_at_login,
            cloned.general.launch_at_login
        );
        assert_eq!(original.dashboard.server_port, cloned.dashboard.server_port);
        assert_eq!(original.advanced.log_level, cloned.advanced.log_level);
    }

    #[test]
    fn test_sensitive_data_removal() {
        let mut settings = Settings::default();
        settings.dashboard.password = "secret123".to_string();
        settings.advanced.ngrok_auth_token = Some("token456".to_string());

        let mut settings_to_save = settings.clone();
        // Simulate what happens during save
        settings_to_save.dashboard.password = String::new();
        settings_to_save.advanced.ngrok_auth_token = None;

        assert_eq!(settings_to_save.dashboard.password, "");
        assert!(settings_to_save.advanced.ngrok_auth_token.is_none());
    }
}
