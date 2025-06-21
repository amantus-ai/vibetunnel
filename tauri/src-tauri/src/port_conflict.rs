use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::process::Command;
use tracing::{error, info};

/// Information about a process using a port
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessDetails {
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
    pub parent_pid: Option<u32>,
}

impl ProcessDetails {
    /// Check if this is a VibeTunnel process
    pub fn is_vibetunnel(&self) -> bool {
        if let Some(path) = &self.path {
            return path.contains("vibetunnel") || path.contains("VibeTunnel");
        }
        self.name.contains("vibetunnel") || self.name.contains("VibeTunnel")
    }

    /// Check if this is one of our managed servers
    pub fn is_managed_server(&self) -> bool {
        self.name == "vibetunnel"
            || self.name.contains("node")
                && self
                    .path
                    .as_ref()
                    .map(|p| p.contains("VibeTunnel"))
                    .unwrap_or(false)
    }
}

/// Information about a port conflict
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortConflict {
    pub port: u16,
    pub process: ProcessDetails,
    pub root_process: Option<ProcessDetails>,
    pub suggested_action: ConflictAction,
    pub alternative_ports: Vec<u16>,
}

/// Suggested action for resolving a port conflict
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConflictAction {
    KillOurInstance { pid: u32, process_name: String },
    SuggestAlternativePort,
    ReportExternalApp { name: String },
}

/// Port conflict resolver
pub struct PortConflictResolver;

impl PortConflictResolver {
    /// Check if a port is available
    pub async fn is_port_available(port: u16) -> bool {
        TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok()
    }

    /// Detect what process is using a port
    pub async fn detect_conflict(port: u16) -> Option<PortConflict> {
        // First check if port is actually in use
        if Self::is_port_available(port).await {
            return None;
        }

        // Platform-specific conflict detection
        #[cfg(target_os = "macos")]
        return Self::detect_conflict_macos(port).await;

        #[cfg(target_os = "linux")]
        return Self::detect_conflict_linux(port).await;

        #[cfg(target_os = "windows")]
        return Self::detect_conflict_windows(port).await;
    }

    #[cfg(target_os = "macos")]
    async fn detect_conflict_macos(port: u16) -> Option<PortConflict> {
        // Use lsof to find process using the port
        let output = Command::new("/usr/sbin/lsof")
            .args(&["-i", &format!(":{}", port), "-n", "-P", "-F"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let process_info = Self::parse_lsof_output(&stdout)?;

        // Get root process
        let root_process = Self::find_root_process(&process_info).await;

        // Find alternative ports
        let alternatives = Self::find_available_ports(port, 3).await;

        // Determine action
        let action = Self::determine_action(&process_info, &root_process);

        Some(PortConflict {
            port,
            process: process_info,
            root_process,
            suggested_action: action,
            alternative_ports: alternatives,
        })
    }

    #[cfg(target_os = "linux")]
    async fn detect_conflict_linux(port: u16) -> Option<PortConflict> {
        // Try lsof first
        if let Ok(output) = Command::new("lsof")
            .args(&["-i", &format!(":{}", port), "-n", "-P", "-F"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(process_info) = Self::parse_lsof_output(&stdout) {
                    let root_process = Self::find_root_process(&process_info).await;
                    let alternatives = Self::find_available_ports(port, 3).await;
                    let action = Self::determine_action(&process_info, &root_process);

                    return Some(PortConflict {
                        port,
                        process: process_info,
                        root_process,
                        suggested_action: action,
                        alternative_ports: alternatives,
                    });
                }
            }
        }

        // Fallback to netstat
        if let Ok(output) = Command::new("netstat").args(&["-tulpn"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse netstat output (simplified)
            for line in stdout.lines() {
                if line.contains(&format!(":{}", port)) && line.contains("LISTEN") {
                    // Extract PID from line (format: "tcp ... LISTEN 1234/process")
                    if let Some(pid_part) = line.split_whitespace().last() {
                        if let Some(pid_str) = pid_part.split('/').next() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                let name =
                                    pid_part.split('/').nth(1).unwrap_or("unknown").to_string();
                                let process_info = ProcessDetails {
                                    pid,
                                    name,
                                    path: None,
                                    parent_pid: None,
                                };

                                let alternatives = Self::find_available_ports(port, 3).await;
                                let action = Self::determine_action(&process_info, &None);

                                return Some(PortConflict {
                                    port,
                                    process: process_info,
                                    root_process: None,
                                    suggested_action: action,
                                    alternative_ports: alternatives,
                                });
                            }
                        }
                    }
                }
            }
        }

        None
    }

    #[cfg(target_os = "windows")]
    async fn detect_conflict_windows(port: u16) -> Option<PortConflict> {
        // Use netstat to find process using the port
        let output = Command::new("netstat")
            .args(&["-ano", "-p", "tcp"])
            .output()
            .ok()?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse netstat output to find the PID
        for line in stdout.lines() {
            if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                // Extract PID from the last column
                if let Some(pid_str) = line.split_whitespace().last() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        // Get process name using tasklist
                        if let Ok(tasklist_output) = Command::new("tasklist")
                            .args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
                            .output()
                        {
                            let tasklist_stdout = String::from_utf8_lossy(&tasklist_output.stdout);
                            if let Some(line) = tasklist_stdout.lines().next() {
                                let parts: Vec<&str> = line.split(',').collect();
                                if parts.len() > 0 {
                                    let name = parts[0].trim_matches('"').to_string();
                                    let process_info = ProcessDetails {
                                        pid,
                                        name,
                                        path: None,
                                        parent_pid: None,
                                    };

                                    let alternatives = Self::find_available_ports(port, 3).await;
                                    let action = Self::determine_action(&process_info, &None);

                                    return Some(PortConflict {
                                        port,
                                        process: process_info,
                                        root_process: None,
                                        suggested_action: action,
                                        alternative_ports: alternatives,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        None
    }

    /// Parse lsof output
    fn parse_lsof_output(output: &str) -> Option<ProcessDetails> {
        let mut pid: Option<u32> = None;
        let mut name: Option<String> = None;
        let mut ppid: Option<u32> = None;

        // Parse lsof field output format
        for line in output.lines() {
            if line.starts_with('p') {
                pid = line[1..].parse().ok();
            } else if line.starts_with('c') {
                name = Some(line[1..].to_string());
            } else if line.starts_with('R') {
                ppid = line[1..].parse().ok();
            }
        }

        if let (Some(pid), Some(name)) = (pid, name) {
            // Get additional process info
            let path = Self::get_process_path(pid);

            Some(ProcessDetails {
                pid,
                name,
                path,
                parent_pid: ppid,
            })
        } else {
            None
        }
    }

    /// Get process path
    fn get_process_path(pid: u32) -> Option<String> {
        #[cfg(unix)]
        {
            if let Ok(output) = Command::new("ps")
                .args(&["-p", &pid.to_string(), "-o", "comm="])
                .output()
            {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }

        None
    }

    /// Find root process
    async fn find_root_process(process: &ProcessDetails) -> Option<ProcessDetails> {
        let mut current = process.clone();
        let mut visited = std::collections::HashSet::new();

        while let Some(parent_pid) = current.parent_pid {
            if parent_pid <= 1 || visited.contains(&parent_pid) {
                break;
            }
            visited.insert(current.pid);

            // Get parent process info
            if let Some(parent_info) = Self::get_process_info(parent_pid).await {
                // If parent is VibeTunnel, it's our root
                if parent_info.is_vibetunnel() {
                    return Some(parent_info);
                }
                current = parent_info;
            } else {
                break;
            }
        }

        None
    }

    /// Get process info by PID
    async fn get_process_info(pid: u32) -> Option<ProcessDetails> {
        #[cfg(unix)]
        {
            if let Ok(output) = Command::new("ps")
                .args(&["-p", &pid.to_string(), "-o", "pid=,ppid=,comm="])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let parts: Vec<&str> = stdout.trim().split_whitespace().collect();

                if parts.len() >= 3 {
                    let pid = parts[0].parse().ok()?;
                    let ppid = parts[1].parse().ok();
                    let name = parts[2..].join(" ");
                    let path = Self::get_process_path(pid);

                    return Some(ProcessDetails {
                        pid,
                        name,
                        path,
                        parent_pid: ppid,
                    });
                }
            }
        }

        #[cfg(windows)]
        {
            // Windows implementation would use WMI or similar
            // For now, return None
        }

        None
    }

    /// Find available ports near a given port
    async fn find_available_ports(near_port: u16, count: usize) -> Vec<u16> {
        let mut available_ports = Vec::new();
        let start = near_port.saturating_sub(10).max(1024);
        let end = near_port.saturating_add(100).min(65535);

        for port in start..=end {
            if port != near_port && Self::is_port_available(port).await {
                available_ports.push(port);
                if available_ports.len() >= count {
                    break;
                }
            }
        }

        available_ports
    }

    /// Determine action for conflict resolution
    fn determine_action(
        process: &ProcessDetails,
        root_process: &Option<ProcessDetails>,
    ) -> ConflictAction {
        // If it's our managed server, kill it
        if process.is_managed_server() {
            return ConflictAction::KillOurInstance {
                pid: process.pid,
                process_name: process.name.clone(),
            };
        }

        // If root process is VibeTunnel, kill the whole app
        if let Some(root) = root_process {
            if root.is_vibetunnel() {
                return ConflictAction::KillOurInstance {
                    pid: root.pid,
                    process_name: root.name.clone(),
                };
            }
        }

        // If the process itself is VibeTunnel
        if process.is_vibetunnel() {
            return ConflictAction::KillOurInstance {
                pid: process.pid,
                process_name: process.name.clone(),
            };
        }

        // Otherwise, it's an external app
        ConflictAction::ReportExternalApp {
            name: process.name.clone(),
        }
    }

    /// Resolve a port conflict
    pub async fn resolve_conflict(conflict: &PortConflict) -> Result<(), String> {
        match &conflict.suggested_action {
            ConflictAction::KillOurInstance { pid, process_name } => {
                info!(
                    "Killing conflicting process: {} (PID: {})",
                    process_name, pid
                );

                #[cfg(unix)]
                {
                    let output = Command::new("kill")
                        .args(&["-9", &pid.to_string()])
                        .output()
                        .map_err(|e| format!("Failed to execute kill command: {}", e))?;

                    if !output.status.success() {
                        return Err(format!("Failed to kill process {}", pid));
                    }
                }

                #[cfg(windows)]
                {
                    let output = Command::new("taskkill")
                        .args(&["/F", "/PID", &pid.to_string()])
                        .output()
                        .map_err(|e| format!("Failed to execute taskkill command: {}", e))?;

                    if !output.status.success() {
                        return Err(format!("Failed to kill process {}", pid));
                    }
                }

                // Wait for port to be released
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                Ok(())
            }
            ConflictAction::SuggestAlternativePort | ConflictAction::ReportExternalApp { .. } => {
                // These require user action
                Err("This conflict requires user action to resolve".to_string())
            }
        }
    }

    /// Force kill a process
    pub async fn force_kill_process(conflict: &PortConflict) -> Result<(), String> {
        info!(
            "Force killing process: {} (PID: {})",
            conflict.process.name, conflict.process.pid
        );

        #[cfg(unix)]
        {
            let output = Command::new("kill")
                .args(&["-9", &conflict.process.pid.to_string()])
                .output()
                .map_err(|e| format!("Failed to execute kill command: {}", e))?;

            if !output.status.success() {
                error!("Failed to kill process with regular permissions");
                return Err(format!("Failed to kill process {}", conflict.process.pid));
            }
        }

        #[cfg(windows)]
        {
            let output = Command::new("taskkill")
                .args(&["/F", "/PID", &conflict.process.pid.to_string()])
                .output()
                .map_err(|e| format!("Failed to execute taskkill command: {}", e))?;

            if !output.status.success() {
                return Err(format!("Failed to kill process {}", conflict.process.pid));
            }
        }

        // Wait for port to be released
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        Ok(())
    }
}
