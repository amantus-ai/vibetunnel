use serde::{Serialize, Deserialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use chrono::{DateTime, Utc};
use tokio::process::Command;

/// Backend type enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum BackendType {
    Rust,
    NodeJS,
    Python,
    Go,
    Custom,
}

impl BackendType {
    pub fn as_str(&self) -> &str {
        match self {
            BackendType::Rust => "rust",
            BackendType::NodeJS => "nodejs",
            BackendType::Python => "python",
            BackendType::Go => "go",
            BackendType::Custom => "custom",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "rust" => BackendType::Rust,
            "nodejs" | "node" => BackendType::NodeJS,
            "python" => BackendType::Python,
            "go" => BackendType::Go,
            _ => BackendType::Custom,
        }
    }
}

/// Backend status
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum BackendStatus {
    NotInstalled,
    Installing,
    Installed,
    Starting,
    Running,
    Stopping,
    Stopped,
    Error,
}

/// Backend configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub backend_type: BackendType,
    pub name: String,
    pub version: String,
    pub executable_path: Option<PathBuf>,
    pub working_directory: Option<PathBuf>,
    pub environment_variables: HashMap<String, String>,
    pub arguments: Vec<String>,
    pub port: Option<u16>,
    pub features: BackendFeatures,
    pub requirements: BackendRequirements,
}

/// Backend features
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendFeatures {
    pub terminal_sessions: bool,
    pub file_browser: bool,
    pub port_forwarding: bool,
    pub authentication: bool,
    pub websocket_support: bool,
    pub rest_api: bool,
    pub graphql_api: bool,
    pub metrics: bool,
}

/// Backend requirements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendRequirements {
    pub runtime: Option<String>,
    pub runtime_version: Option<String>,
    pub dependencies: Vec<String>,
    pub system_packages: Vec<String>,
    pub min_memory_mb: Option<u32>,
    pub min_disk_space_mb: Option<u32>,
}

/// Backend instance information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendInstance {
    pub id: String,
    pub backend_type: BackendType,
    pub status: BackendStatus,
    pub pid: Option<u32>,
    pub port: u16,
    pub started_at: Option<DateTime<Utc>>,
    pub last_health_check: Option<DateTime<Utc>>,
    pub health_status: HealthStatus,
    pub metrics: BackendMetrics,
}

/// Health status
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

/// Backend metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendMetrics {
    pub cpu_usage_percent: Option<f32>,
    pub memory_usage_mb: Option<u64>,
    pub request_count: u64,
    pub error_count: u64,
    pub average_response_time_ms: Option<f32>,
    pub active_connections: u32,
}

/// Backend manager
pub struct BackendManager {
    configs: Arc<RwLock<HashMap<BackendType, BackendConfig>>>,
    instances: Arc<RwLock<HashMap<String, BackendInstance>>>,
    active_backend: Arc<RwLock<Option<BackendType>>>,
    notification_manager: Option<Arc<crate::notification_manager::NotificationManager>>,
}

impl BackendManager {
    /// Create a new backend manager
    pub fn new() -> Self {
        let manager = Self {
            configs: Arc::new(RwLock::new(HashMap::new())),
            instances: Arc::new(RwLock::new(HashMap::new())),
            active_backend: Arc::new(RwLock::new(Some(BackendType::Rust))),
            notification_manager: None,
        };
        
        // Initialize default backend configurations
        tokio::spawn({
            let configs = manager.configs.clone();
            async move {
                let default_configs = Self::initialize_default_configs();
                *configs.write().await = default_configs;
            }
        });
        
        manager
    }

    /// Set the notification manager
    pub fn set_notification_manager(&mut self, notification_manager: Arc<crate::notification_manager::NotificationManager>) {
        self.notification_manager = Some(notification_manager);
    }

    /// Initialize default backend configurations
    fn initialize_default_configs() -> HashMap<BackendType, BackendConfig> {
        let mut configs = HashMap::new();
        
        // Rust backend (built-in)
        configs.insert(BackendType::Rust, BackendConfig {
            backend_type: BackendType::Rust,
            name: "Rust (Built-in)".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            executable_path: None,
            working_directory: None,
            environment_variables: HashMap::new(),
            arguments: vec![],
            port: Some(4020),
            features: BackendFeatures {
                terminal_sessions: true,
                file_browser: true,
                port_forwarding: true,
                authentication: true,
                websocket_support: true,
                rest_api: true,
                graphql_api: false,
                metrics: true,
            },
            requirements: BackendRequirements {
                runtime: None,
                runtime_version: None,
                dependencies: vec![],
                system_packages: vec![],
                min_memory_mb: Some(64),
                min_disk_space_mb: Some(10),
            },
        });
        
        // Node.js backend
        configs.insert(BackendType::NodeJS, BackendConfig {
            backend_type: BackendType::NodeJS,
            name: "Node.js Server".to_string(),
            version: "1.0.0".to_string(),
            executable_path: Some(PathBuf::from("node")),
            working_directory: None,
            environment_variables: HashMap::new(),
            arguments: vec!["server.js".to_string()],
            port: Some(4021),
            features: BackendFeatures {
                terminal_sessions: true,
                file_browser: true,
                port_forwarding: false,
                authentication: true,
                websocket_support: true,
                rest_api: true,
                graphql_api: true,
                metrics: false,
            },
            requirements: BackendRequirements {
                runtime: Some("node".to_string()),
                runtime_version: Some(">=16.0.0".to_string()),
                dependencies: vec![
                    "express".to_string(),
                    "socket.io".to_string(),
                    "node-pty".to_string(),
                ],
                system_packages: vec![],
                min_memory_mb: Some(128),
                min_disk_space_mb: Some(50),
            },
        });
        
        // Python backend
        configs.insert(BackendType::Python, BackendConfig {
            backend_type: BackendType::Python,
            name: "Python Server".to_string(),
            version: "1.0.0".to_string(),
            executable_path: Some(PathBuf::from("python3")),
            working_directory: None,
            environment_variables: HashMap::new(),
            arguments: vec!["-m".to_string(), "vibetunnel_server".to_string()],
            port: Some(4022),
            features: BackendFeatures {
                terminal_sessions: true,
                file_browser: true,
                port_forwarding: false,
                authentication: true,
                websocket_support: true,
                rest_api: true,
                graphql_api: false,
                metrics: true,
            },
            requirements: BackendRequirements {
                runtime: Some("python3".to_string()),
                runtime_version: Some(">=3.8".to_string()),
                dependencies: vec![
                    "fastapi".to_string(),
                    "uvicorn".to_string(),
                    "websockets".to_string(),
                    "ptyprocess".to_string(),
                ],
                system_packages: vec![],
                min_memory_mb: Some(96),
                min_disk_space_mb: Some(30),
            },
        });
        
        configs
    }

    /// Get available backends
    pub async fn get_available_backends(&self) -> Vec<BackendConfig> {
        self.configs.read().await.values().cloned().collect()
    }

    /// Get backend configuration
    pub async fn get_backend_config(&self, backend_type: BackendType) -> Option<BackendConfig> {
        self.configs.read().await.get(&backend_type).cloned()
    }

    /// Check if backend is installed
    pub async fn is_backend_installed(&self, backend_type: BackendType) -> bool {
        match backend_type {
            BackendType::Rust => true, // Built-in
            BackendType::NodeJS => self.check_nodejs_installed().await,
            BackendType::Python => self.check_python_installed().await,
            BackendType::Go => self.check_go_installed().await,
            BackendType::Custom => false,
        }
    }

    /// Install backend
    pub async fn install_backend(&self, backend_type: BackendType) -> Result<(), String> {
        match backend_type {
            BackendType::Rust => Ok(()), // Already installed
            BackendType::NodeJS => self.install_nodejs_backend().await,
            BackendType::Python => self.install_python_backend().await,
            BackendType::Go => Err("Go backend not yet implemented".to_string()),
            BackendType::Custom => Err("Custom backend installation not supported".to_string()),
        }
    }

    /// Start backend
    pub async fn start_backend(&self, backend_type: BackendType) -> Result<String, String> {
        // Check if backend is installed
        if !self.is_backend_installed(backend_type).await {
            return Err(format!("{:?} backend is not installed", backend_type));
        }
        
        // Get backend configuration
        let config = self.get_backend_config(backend_type).await
            .ok_or_else(|| "Backend configuration not found".to_string())?;
        
        // Generate instance ID
        let instance_id = uuid::Uuid::new_v4().to_string();
        
        // Create backend instance
        let instance = BackendInstance {
            id: instance_id.clone(),
            backend_type,
            status: BackendStatus::Starting,
            pid: None,
            port: config.port.unwrap_or(4020),
            started_at: None,
            last_health_check: None,
            health_status: HealthStatus::Unknown,
            metrics: BackendMetrics {
                cpu_usage_percent: None,
                memory_usage_mb: None,
                request_count: 0,
                error_count: 0,
                average_response_time_ms: None,
                active_connections: 0,
            },
        };
        
        // Store instance
        self.instances.write().await.insert(instance_id.clone(), instance);
        
        // Start backend process
        match backend_type {
            BackendType::Rust => {
                // Rust backend is handled internally
                self.update_instance_status(&instance_id, BackendStatus::Running).await;
                *self.active_backend.write().await = Some(BackendType::Rust);
                Ok(instance_id)
            }
            _ => {
                // Start external backend process
                self.start_external_backend(&instance_id, config).await
            }
        }
    }

    /// Stop backend
    pub async fn stop_backend(&self, instance_id: &str) -> Result<(), String> {
        let instance = self.instances.read().await
            .get(instance_id)
            .cloned()
            .ok_or_else(|| "Backend instance not found".to_string())?;
        
        match instance.backend_type {
            BackendType::Rust => {
                // Rust backend is handled internally
                self.update_instance_status(instance_id, BackendStatus::Stopped).await;
                Ok(())
            }
            _ => {
                // Stop external backend process
                self.stop_external_backend(instance_id).await
            }
        }
    }

    /// Switch active backend
    pub async fn switch_backend(&self, backend_type: BackendType) -> Result<(), String> {
        // Stop current backend if different
        let current_backend = *self.active_backend.read().await;
        if let Some(current) = current_backend {
            if current != backend_type {
                // Find and stop current backend instances
                let instance_id = {
                    let instances = self.instances.read().await;
                    instances.iter()
                        .find(|(_, instance)| instance.backend_type == current && instance.status == BackendStatus::Running)
                        .map(|(id, _)| id.clone())
                };
                if let Some(id) = instance_id {
                    self.stop_backend(&id).await?;
                }
            }
        }
        
        // Start new backend
        self.start_backend(backend_type).await?;
        
        // Update active backend
        *self.active_backend.write().await = Some(backend_type);
        
        // Notify about backend switch
        if let Some(notification_manager) = &self.notification_manager {
            let _ = notification_manager.notify_success(
                "Backend Switched",
                &format!("Switched to {:?} backend", backend_type)
            ).await;
        }
        
        Ok(())
    }

    /// Get active backend
    pub async fn get_active_backend(&self) -> Option<BackendType> {
        *self.active_backend.read().await
    }

    /// Get backend instances
    pub async fn get_backend_instances(&self) -> Vec<BackendInstance> {
        self.instances.read().await.values().cloned().collect()
    }

    /// Get backend health
    pub async fn check_backend_health(&self, instance_id: &str) -> Result<HealthStatus, String> {
        let instance = self.instances.read().await
            .get(instance_id)
            .cloned()
            .ok_or_else(|| "Backend instance not found".to_string())?;
        
        if instance.status != BackendStatus::Running {
            return Ok(HealthStatus::Unknown);
        }
        
        // Perform health check based on backend type
        let health_status = match instance.backend_type {
            BackendType::Rust => HealthStatus::Healthy, // Always healthy for built-in
            _ => self.check_external_backend_health(&instance).await?,
        };
        
        // Update instance health status
        if let Some(instance) = self.instances.write().await.get_mut(instance_id) {
            instance.health_status = health_status;
            instance.last_health_check = Some(Utc::now());
        }
        
        Ok(health_status)
    }

    // Helper methods
    async fn check_nodejs_installed(&self) -> bool {
        Command::new("node")
            .arg("--version")
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    async fn check_python_installed(&self) -> bool {
        Command::new("python3")
            .arg("--version")
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    async fn check_go_installed(&self) -> bool {
        Command::new("go")
            .arg("version")
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    async fn install_nodejs_backend(&self) -> Result<(), String> {
        // TODO: Implement Node.js backend installation
        // This would involve:
        // 1. Creating package.json
        // 2. Installing dependencies
        // 3. Copying server files
        Err("Node.js backend installation not yet implemented".to_string())
    }

    async fn install_python_backend(&self) -> Result<(), String> {
        // TODO: Implement Python backend installation
        // This would involve:
        // 1. Creating virtual environment
        // 2. Installing pip dependencies
        // 3. Copying server files
        Err("Python backend installation not yet implemented".to_string())
    }

    async fn start_external_backend(&self, _instance_id: &str, _config: BackendConfig) -> Result<String, String> {
        // TODO: Implement external backend startup
        Err("External backend startup not yet implemented".to_string())
    }

    async fn stop_external_backend(&self, _instance_id: &str) -> Result<(), String> {
        // TODO: Implement external backend shutdown
        Err("External backend shutdown not yet implemented".to_string())
    }

    async fn check_external_backend_health(&self, _instance: &BackendInstance) -> Result<HealthStatus, String> {
        // TODO: Implement health check for external backends
        Ok(HealthStatus::Unknown)
    }

    async fn update_instance_status(&self, instance_id: &str, status: BackendStatus) {
        if let Some(instance) = self.instances.write().await.get_mut(instance_id) {
            instance.status = status;
            if status == BackendStatus::Running {
                instance.started_at = Some(Utc::now());
            }
        }
    }
}

/// Backend statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendStats {
    pub total_backends: usize,
    pub installed_backends: usize,
    pub running_instances: usize,
    pub active_backend: Option<BackendType>,
    pub health_summary: HashMap<HealthStatus, usize>,
}