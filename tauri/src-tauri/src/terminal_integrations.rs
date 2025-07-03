use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Terminal emulator type
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TerminalEmulator {
    SystemDefault,
    Terminal,        // macOS Terminal.app
    ITerm2,          // iTerm2
    Hyper,           // Hyper
    Alacritty,       // Alacritty
    Kitty,           // Kitty
    WezTerm,         // WezTerm
    Ghostty,         // Ghostty
    Warp,            // Warp
    WindowsTerminal, // Windows Terminal
    ConEmu,          // ConEmu
    Cmder,           // Cmder
    Gnome,           // GNOME Terminal
    Konsole,         // KDE Konsole
    Xterm,           // XTerm
    Custom,          // Custom terminal
}

impl TerminalEmulator {
    pub const fn display_name(&self) -> &str {
        match self {
            Self::SystemDefault => "System Default",
            Self::Terminal => "Terminal",
            Self::ITerm2 => "iTerm2",
            Self::Hyper => "Hyper",
            Self::Alacritty => "Alacritty",
            Self::Kitty => "Kitty",
            Self::WezTerm => "WezTerm",
            Self::Ghostty => "Ghostty",
            Self::Warp => "Warp",
            Self::WindowsTerminal => "Windows Terminal",
            Self::ConEmu => "ConEmu",
            Self::Cmder => "Cmder",
            Self::Gnome => "GNOME Terminal",
            Self::Konsole => "Konsole",
            Self::Xterm => "XTerm",
            Self::Custom => "Custom",
        }
    }
}

/// Terminal integration configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub emulator: TerminalEmulator,
    pub name: String,
    pub executable_path: PathBuf,
    pub args_template: Vec<String>,
    pub env_vars: HashMap<String, String>,
    pub features: TerminalFeatures,
    pub platform: Vec<String>, // ["macos", "windows", "linux"]
}

/// Terminal features
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalFeatures {
    pub supports_tabs: bool,
    pub supports_splits: bool,
    pub supports_profiles: bool,
    pub supports_themes: bool,
    pub supports_scripting: bool,
    pub supports_url_scheme: bool,
    pub supports_remote_control: bool,
}

/// Terminal launch options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalLaunchOptions {
    pub working_directory: Option<PathBuf>,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env_vars: HashMap<String, String>,
    pub title: Option<String>,
    pub profile: Option<String>,
    pub tab: bool,
    pub split: Option<SplitDirection>,
    pub window_size: Option<(u32, u32)>,
}

/// Split direction
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

/// Terminal integration info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalIntegrationInfo {
    pub emulator: TerminalEmulator,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<PathBuf>,
    pub is_default: bool,
    pub config: Option<TerminalConfig>,
}

/// Terminal URL scheme
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalURLScheme {
    pub scheme: String,
    pub supports_ssh: bool,
    pub supports_local: bool,
    pub template: String,
}

/// Terminal integrations manager
pub struct TerminalIntegrationsManager {
    configs: Arc<RwLock<HashMap<TerminalEmulator, TerminalConfig>>>,
    detected_terminals: Arc<RwLock<HashMap<TerminalEmulator, TerminalIntegrationInfo>>>,
    default_terminal: Arc<RwLock<TerminalEmulator>>,
    url_schemes: Arc<RwLock<HashMap<TerminalEmulator, TerminalURLScheme>>>,
    notification_manager: Option<Arc<crate::notification_manager::NotificationManager>>,
}

impl Default for TerminalIntegrationsManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalIntegrationsManager {
    /// Create a new terminal integrations manager
    pub fn new() -> Self {
        Self {
            configs: Arc::new(RwLock::new(Self::initialize_default_configs())),
            detected_terminals: Arc::new(RwLock::new(HashMap::new())),
            default_terminal: Arc::new(RwLock::new(TerminalEmulator::SystemDefault)),
            url_schemes: Arc::new(RwLock::new(Self::initialize_url_schemes())),
            notification_manager: None,
        }
    }

    /// Set the notification manager
    pub fn set_notification_manager(
        &mut self,
        notification_manager: Arc<crate::notification_manager::NotificationManager>,
    ) {
        self.notification_manager = Some(notification_manager);
    }

    /// Initialize default terminal configurations
    fn initialize_default_configs() -> HashMap<TerminalEmulator, TerminalConfig> {
        let mut configs = HashMap::new();

        // WezTerm configuration
        configs.insert(
            TerminalEmulator::WezTerm,
            TerminalConfig {
                emulator: TerminalEmulator::WezTerm,
                name: "WezTerm".to_string(),
                executable_path: PathBuf::from("/Applications/WezTerm.app/Contents/MacOS/wezterm"),
                args_template: vec![
                    "start".to_string(),
                    "--cwd".to_string(),
                    "{working_directory}".to_string(),
                    "--".to_string(),
                    "{command}".to_string(),
                    "{args}".to_string(),
                ],
                env_vars: HashMap::new(),
                features: TerminalFeatures {
                    supports_tabs: true,
                    supports_splits: true,
                    supports_profiles: true,
                    supports_themes: true,
                    supports_scripting: true,
                    supports_url_scheme: false,
                    supports_remote_control: true,
                },
                platform: vec![
                    "macos".to_string(),
                    "windows".to_string(),
                    "linux".to_string(),
                ],
            },
        );

        // Ghostty configuration
        configs.insert(
            TerminalEmulator::Ghostty,
            TerminalConfig {
                emulator: TerminalEmulator::Ghostty,
                name: "Ghostty".to_string(),
                executable_path: PathBuf::from("/Applications/Ghostty.app/Contents/MacOS/ghostty"),
                args_template: vec![
                    "--working-directory".to_string(),
                    "{working_directory}".to_string(),
                    "--command".to_string(),
                    "{command}".to_string(),
                    "{args}".to_string(),
                ],
                env_vars: HashMap::new(),
                features: TerminalFeatures {
                    supports_tabs: true,
                    supports_splits: true,
                    supports_profiles: true,
                    supports_themes: true,
                    supports_scripting: false,
                    supports_url_scheme: false,
                    supports_remote_control: false,
                },
                platform: vec!["macos".to_string()],
            },
        );

        // iTerm2 configuration
        configs.insert(
            TerminalEmulator::ITerm2,
            TerminalConfig {
                emulator: TerminalEmulator::ITerm2,
                name: "iTerm2".to_string(),
                executable_path: PathBuf::from("/Applications/iTerm.app/Contents/MacOS/iTerm2"),
                args_template: vec![],
                env_vars: HashMap::new(),
                features: TerminalFeatures {
                    supports_tabs: true,
                    supports_splits: true,
                    supports_profiles: true,
                    supports_themes: true,
                    supports_scripting: true,
                    supports_url_scheme: true,
                    supports_remote_control: true,
                },
                platform: vec!["macos".to_string()],
            },
        );

        // Alacritty configuration
        configs.insert(
            TerminalEmulator::Alacritty,
            TerminalConfig {
                emulator: TerminalEmulator::Alacritty,
                name: "Alacritty".to_string(),
                executable_path: PathBuf::from(
                    "/Applications/Alacritty.app/Contents/MacOS/alacritty",
                ),
                args_template: vec![
                    "--working-directory".to_string(),
                    "{working_directory}".to_string(),
                    "-e".to_string(),
                    "{command}".to_string(),
                    "{args}".to_string(),
                ],
                env_vars: HashMap::new(),
                features: TerminalFeatures {
                    supports_tabs: false,
                    supports_splits: false,
                    supports_profiles: true,
                    supports_themes: true,
                    supports_scripting: false,
                    supports_url_scheme: false,
                    supports_remote_control: false,
                },
                platform: vec![
                    "macos".to_string(),
                    "windows".to_string(),
                    "linux".to_string(),
                ],
            },
        );

        // Kitty configuration
        configs.insert(
            TerminalEmulator::Kitty,
            TerminalConfig {
                emulator: TerminalEmulator::Kitty,
                name: "Kitty".to_string(),
                executable_path: PathBuf::from("/Applications/kitty.app/Contents/MacOS/kitty"),
                args_template: vec![
                    "--directory".to_string(),
                    "{working_directory}".to_string(),
                    "{command}".to_string(),
                    "{args}".to_string(),
                ],
                env_vars: HashMap::new(),
                features: TerminalFeatures {
                    supports_tabs: true,
                    supports_splits: true,
                    supports_profiles: true,
                    supports_themes: true,
                    supports_scripting: true,
                    supports_url_scheme: false,
                    supports_remote_control: true,
                },
                platform: vec!["macos".to_string(), "linux".to_string()],
            },
        );

        configs
    }

    /// Initialize URL schemes
    fn initialize_url_schemes() -> HashMap<TerminalEmulator, TerminalURLScheme> {
        let mut schemes = HashMap::new();

        schemes.insert(
            TerminalEmulator::ITerm2,
            TerminalURLScheme {
                scheme: "iterm2".to_string(),
                supports_ssh: true,
                supports_local: true,
                template: "iterm2://ssh/{user}@{host}:{port}".to_string(),
            },
        );

        schemes
    }

    /// Detect installed terminals
    pub async fn detect_terminals(&self) -> Vec<TerminalIntegrationInfo> {
        let mut detected = Vec::new();
        let configs = self.configs.read().await;

        for (emulator, config) in configs.iter() {
            let info = self.check_terminal_installation(emulator, config).await;
            if info.installed {
                detected.push(info.clone());
                self.detected_terminals
                    .write()
                    .await
                    .insert(*emulator, info);
            }
        }

        // Check system default
        let default_info = self.detect_system_default().await;
        detected.insert(0, default_info);

        detected
    }

    /// Check if a specific terminal is installed
    async fn check_terminal_installation(
        &self,
        emulator: &TerminalEmulator,
        config: &TerminalConfig,
    ) -> TerminalIntegrationInfo {
        let installed = config.executable_path.exists();
        let version = if installed {
            self.get_terminal_version(emulator, &config.executable_path)
                .await
        } else {
            None
        };

        TerminalIntegrationInfo {
            emulator: *emulator,
            installed,
            version,
            path: if installed {
                Some(config.executable_path.clone())
            } else {
                None
            },
            is_default: false,
            config: if installed {
                Some(config.clone())
            } else {
                None
            },
        }
    }

    /// Get terminal version
    async fn get_terminal_version(
        &self,
        emulator: &TerminalEmulator,
        path: &PathBuf,
    ) -> Option<String> {
        match emulator {
            TerminalEmulator::WezTerm => Command::new(path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .map(|v| v.trim().to_string()),
            TerminalEmulator::Alacritty => Command::new(path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .map(|v| v.trim().to_string()),
            _ => None,
        }
    }

    /// Detect system default terminal
    async fn detect_system_default(&self) -> TerminalIntegrationInfo {
        #[cfg(target_os = "macos")]
        {
            TerminalIntegrationInfo {
                emulator: TerminalEmulator::Terminal,
                installed: true,
                version: None,
                path: Some(PathBuf::from("/System/Applications/Utilities/Terminal.app")),
                is_default: true,
                config: None,
            }
        }

        #[cfg(target_os = "windows")]
        {
            TerminalIntegrationInfo {
                emulator: TerminalEmulator::WindowsTerminal,
                installed: true,
                version: None,
                path: None,
                is_default: true,
                config: None,
            }
        }

        #[cfg(target_os = "linux")]
        {
            TerminalIntegrationInfo {
                emulator: TerminalEmulator::Gnome,
                installed: true,
                version: None,
                path: None,
                is_default: true,
                config: None,
            }
        }
    }

    /// Get default terminal
    pub async fn get_default_terminal(&self) -> TerminalEmulator {
        *self.default_terminal.read().await
    }

    /// Set default terminal
    pub async fn set_default_terminal(&self, emulator: TerminalEmulator) -> Result<(), String> {
        // Check if terminal is installed
        let detected = self.detected_terminals.read().await;
        if emulator != TerminalEmulator::SystemDefault && !detected.contains_key(&emulator) {
            return Err("Terminal not installed".to_string());
        }

        *self.default_terminal.write().await = emulator;

        // Notify user
        if let Some(notification_manager) = &self.notification_manager {
            let _ = notification_manager
                .notify_success(
                    "Default Terminal Changed",
                    &format!("Default terminal set to {}", emulator.display_name()),
                )
                .await;
        }

        Ok(())
    }

    /// Launch terminal
    pub async fn launch_terminal(
        &self,
        emulator: Option<TerminalEmulator>,
        options: TerminalLaunchOptions,
    ) -> Result<(), String> {
        let emulator = emulator.unwrap_or(*self.default_terminal.read().await);

        // Use AppleScript for enhanced terminal control on macOS
        #[cfg(target_os = "macos")]
        {
            match emulator {
                TerminalEmulator::Terminal | TerminalEmulator::ITerm2 => {
                    let session_id = uuid::Uuid::new_v4().to_string();
                    let command = options.command.as_deref();
                    let working_dir = options.working_directory
                        .as_ref()
                        .and_then(|p| p.to_str());
                    
                    let terminal_name = match emulator {
                        TerminalEmulator::Terminal => "Terminal",
                        TerminalEmulator::ITerm2 => "iTerm2",
                        _ => unreachable!(),
                    };
                    
                    return crate::applescript::AppleScriptTerminalLauncher::launch_terminal(
                        terminal_name,
                        &session_id,
                        command,
                        working_dir,
                    ).await
                    .map(|_| ());
                }
                _ => {}
            }
        }

        match emulator {
            TerminalEmulator::SystemDefault => self.launch_system_terminal(options).await,
            _ => self.launch_specific_terminal(emulator, options).await,
        }
    }

    /// Launch system terminal
    async fn launch_system_terminal(&self, options: TerminalLaunchOptions) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.launch_macos_terminal(options).await
        }

        #[cfg(target_os = "windows")]
        {
            self.launch_windows_terminal(options).await
        }

        #[cfg(target_os = "linux")]
        {
            self.launch_linux_terminal(options).await
        }
    }

    /// Launch specific terminal
    async fn launch_specific_terminal(
        &self,
        emulator: TerminalEmulator,
        options: TerminalLaunchOptions,
    ) -> Result<(), String> {
        let configs = self.configs.read().await;
        let config = configs
            .get(&emulator)
            .ok_or_else(|| "Terminal configuration not found".to_string())?;

        let mut command = Command::new(&config.executable_path);

        // Build command arguments
        for arg_template in &config.args_template {
            let arg = self.replace_template_variables(arg_template, &options);
            if !arg.is_empty() {
                command.arg(arg);
            }
        }

        // Set environment variables
        for (key, value) in &config.env_vars {
            command.env(key, value);
        }
        for (key, value) in &options.env_vars {
            command.env(key, value);
        }

        // Set working directory
        if let Some(cwd) = &options.working_directory {
            command.current_dir(cwd);
        }

        // Launch terminal
        command
            .spawn()
            .map_err(|e| format!("Failed to launch terminal: {e}"))?;

        Ok(())
    }

    /// Launch macOS terminal
    #[cfg(target_os = "macos")]
    async fn launch_macos_terminal(&self, options: TerminalLaunchOptions) -> Result<(), String> {
        use std::process::Command;

        let mut script = String::from("tell application \"Terminal\"\n");
        script.push_str("    activate\n");

        if options.tab {
            script.push_str(
                "    tell application \"System Events\" to keystroke \"t\" using command down\n",
            );
        }

        if let Some(cwd) = options.working_directory {
            script.push_str(&format!(
                "    do script \"cd '{}'\" in front window\n",
                cwd.display()
            ));
        }

        if let Some(command) = options.command {
            let full_command = if options.args.is_empty() {
                command
            } else {
                format!("{} {}", command, options.args.join(" "))
            };
            script.push_str(&format!(
                "    do script \"{full_command}\" in front window\n"
            ));
        }

        script.push_str("end tell\n");

        Command::new("osascript")
            .arg("-e")
            .arg(script)
            .spawn()
            .map_err(|e| format!("Failed to launch Terminal: {e}"))?;

        Ok(())
    }

    /// Launch Windows terminal
    #[cfg(target_os = "windows")]
    async fn launch_windows_terminal(&self, options: TerminalLaunchOptions) -> Result<(), String> {
        use std::process::Command;

        let mut command = Command::new("wt.exe");

        if let Some(cwd) = options.working_directory {
            command.args(&["-d", cwd.to_str().unwrap_or(".")]);
        }

        if options.tab {
            command.arg("new-tab");
        }

        if let Some(cmd) = options.command {
            command.args(&["--", &cmd]);
            for arg in options.args {
                command.arg(arg);
            }
        }

        command
            .spawn()
            .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;

        Ok(())
    }

    /// Launch Linux terminal
    #[cfg(target_os = "linux")]
    async fn launch_linux_terminal(&self, options: TerminalLaunchOptions) -> Result<(), String> {
        use std::process::Command;

        // Try common terminal emulators
        let terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"];

        for terminal in &terminals {
            if let Ok(output) = Command::new("which").arg(terminal).output() {
                if output.status.success() {
                    let mut command = Command::new(terminal);

                    if let Some(cwd) = &options.working_directory {
                        match *terminal {
                            "gnome-terminal" => {
                                command.arg("--working-directory").arg(cwd);
                            }
                            "konsole" => {
                                command.arg("--workdir").arg(cwd);
                            }
                            _ => {}
                        }
                    }

                    if let Some(cmd) = &options.command {
                        match *terminal {
                            "gnome-terminal" => {
                                command.arg("--").arg(cmd);
                            }
                            "konsole" => {
                                command.arg("-e").arg(cmd);
                            }
                            _ => {
                                command.arg("-e").arg(cmd);
                            }
                        }
                        for arg in &options.args {
                            command.arg(arg);
                        }
                    }

                    return command
                        .spawn()
                        .map_err(|e| format!("Failed to launch terminal: {}", e))
                        .map(|_| ());
                }
            }
        }

        Err("No suitable terminal emulator found".to_string())
    }

    /// Create SSH URL
    pub async fn create_ssh_url(
        &self,
        emulator: TerminalEmulator,
        user: &str,
        host: &str,
        port: u16,
    ) -> Option<String> {
        let schemes = self.url_schemes.read().await;
        schemes.get(&emulator).map(|scheme| {
            scheme
                .template
                .replace("{user}", user)
                .replace("{host}", host)
                .replace("{port}", &port.to_string())
        })
    }

    /// Get terminal configuration
    pub async fn get_terminal_config(&self, emulator: TerminalEmulator) -> Option<TerminalConfig> {
        self.configs.read().await.get(&emulator).cloned()
    }

    /// Update terminal configuration
    pub async fn update_terminal_config(&self, config: TerminalConfig) {
        self.configs.write().await.insert(config.emulator, config);
    }

    /// List detected terminals
    pub async fn list_detected_terminals(&self) -> Vec<TerminalIntegrationInfo> {
        self.detected_terminals
            .read()
            .await
            .values()
            .cloned()
            .collect()
    }

    // Helper methods
    fn replace_template_variables(
        &self,
        template: &str,
        options: &TerminalLaunchOptions,
    ) -> String {
        let mut result = template.to_string();

        if let Some(cwd) = &options.working_directory {
            result = result.replace("{working_directory}", cwd.to_str().unwrap_or(""));
        }

        if let Some(command) = &options.command {
            result = result.replace("{command}", command);
        }

        result = result.replace("{args}", &options.args.join(" "));

        if let Some(title) = &options.title {
            result = result.replace("{title}", title);
        }

        // Remove empty placeholders
        result = result.replace("{working_directory}", "");
        result = result.replace("{command}", "");
        result = result.replace("{args}", "");
        result = result.replace("{title}", "");

        result.trim().to_string()
    }
}

/// Terminal integration statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalIntegrationStats {
    pub total_terminals: usize,
    pub installed_terminals: usize,
    pub default_terminal: TerminalEmulator,
    pub terminals_by_platform: HashMap<String, Vec<TerminalEmulator>>,
}
