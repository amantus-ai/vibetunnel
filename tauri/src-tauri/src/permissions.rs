use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tracing::{debug, info};

/// Permission type enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PermissionType {
    ScreenRecording,
    Accessibility,
    NetworkAccess,
    FileSystemFull,
    FileSystemRestricted,
    TerminalAccess,
    NotificationAccess,
    CameraAccess,
    MicrophoneAccess,
    AutoStart,
}

/// Permission status
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
    NotApplicable,
}

/// Permission information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionInfo {
    pub permission_type: PermissionType,
    pub status: PermissionStatus,
    pub required: bool,
    pub platform_specific: bool,
    pub description: String,
    pub last_checked: Option<DateTime<Utc>>,
    pub request_count: u32,
}

/// Permission request result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestResult {
    pub permission_type: PermissionType,
    pub status: PermissionStatus,
    pub message: Option<String>,
    pub requires_restart: bool,
    pub requires_system_settings: bool,
}

/// Platform-specific permission settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformPermissions {
    pub macos: HashMap<PermissionType, PermissionInfo>,
    pub windows: HashMap<PermissionType, PermissionInfo>,
    pub linux: HashMap<PermissionType, PermissionInfo>,
}

/// Permissions manager
pub struct PermissionsManager {
    permissions: Arc<RwLock<HashMap<PermissionType, PermissionInfo>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    notification_manager: Option<Arc<crate::notification_manager::NotificationManager>>,
    monitor_registration_count: Arc<AtomicUsize>,
    monitor_handle: Arc<RwLock<Option<tokio::task::JoinHandle<()>>>>,
}

impl Default for PermissionsManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PermissionsManager {
    /// Create a new permissions manager
    pub fn new() -> Self {
        Self {
            permissions: Arc::new(RwLock::new(Self::initialize_permissions())),
            app_handle: Arc::new(RwLock::new(None)),
            notification_manager: None,
            monitor_registration_count: Arc::new(AtomicUsize::new(0)),
            monitor_handle: Arc::new(RwLock::new(None)),
        }
    }

    /// Set the app handle
    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.write().await = Some(app_handle);
    }

    /// Set the notification manager
    pub fn set_notification_manager(
        &mut self,
        notification_manager: Arc<crate::notification_manager::NotificationManager>,
    ) {
        self.notification_manager = Some(notification_manager);
    }

    /// Initialize default permissions based on platform
    fn initialize_permissions() -> HashMap<PermissionType, PermissionInfo> {
        let mut permissions = HashMap::new();

        // Get current platform
        let platform = std::env::consts::OS;

        match platform {
            "macos" => {
                permissions.insert(
                    PermissionType::ScreenRecording,
                    PermissionInfo {
                        permission_type: PermissionType::ScreenRecording,
                        status: PermissionStatus::NotDetermined,
                        required: false,
                        platform_specific: true,
                        description: "Required for recording terminal sessions with system UI"
                            .to_string(),
                        last_checked: None,
                        request_count: 0,
                    },
                );

                permissions.insert(
                    PermissionType::Accessibility,
                    PermissionInfo {
                        permission_type: PermissionType::Accessibility,
                        status: PermissionStatus::NotDetermined,
                        required: false,
                        platform_specific: true,
                        description: "Required for advanced terminal integration features"
                            .to_string(),
                        last_checked: None,
                        request_count: 0,
                    },
                );

                permissions.insert(
                    PermissionType::NotificationAccess,
                    PermissionInfo {
                        permission_type: PermissionType::NotificationAccess,
                        status: PermissionStatus::NotDetermined,
                        required: false,
                        platform_specific: true,
                        description: "Required to show system notifications".to_string(),
                        last_checked: None,
                        request_count: 0,
                    },
                );
            }
            "windows" => {
                permissions.insert(
                    PermissionType::TerminalAccess,
                    PermissionInfo {
                        permission_type: PermissionType::TerminalAccess,
                        status: PermissionStatus::NotDetermined,
                        required: true,
                        platform_specific: true,
                        description: "Required to create and manage terminal sessions".to_string(),
                        last_checked: None,
                        request_count: 0,
                    },
                );

                permissions.insert(
                    PermissionType::AutoStart,
                    PermissionInfo {
                        permission_type: PermissionType::AutoStart,
                        status: PermissionStatus::NotDetermined,
                        required: false,
                        platform_specific: true,
                        description: "Required to start VibeTunnel with Windows".to_string(),
                        last_checked: None,
                        request_count: 0,
                    },
                );
            }
            "linux" => {
                permissions.insert(
                    PermissionType::FileSystemFull,
                    PermissionInfo {
                        permission_type: PermissionType::FileSystemFull,
                        status: PermissionStatus::Granted,
                        required: true,
                        platform_specific: false,
                        description: "Required for saving recordings and configurations"
                            .to_string(),
                        last_checked: None,
                        request_count: 0,
                    },
                );
            }
            _ => {}
        }

        // Add common permissions
        permissions.insert(
            PermissionType::NetworkAccess,
            PermissionInfo {
                permission_type: PermissionType::NetworkAccess,
                status: PermissionStatus::Granted,
                required: true,
                platform_specific: false,
                description: "Required for web server and remote access features".to_string(),
                last_checked: None,
                request_count: 0,
            },
        );

        permissions.insert(
            PermissionType::FileSystemRestricted,
            PermissionInfo {
                permission_type: PermissionType::FileSystemRestricted,
                status: PermissionStatus::Granted,
                required: true,
                platform_specific: false,
                description: "Required for basic application functionality".to_string(),
                last_checked: None,
                request_count: 0,
            },
        );

        permissions
    }

    /// Check all permissions
    pub async fn check_all_permissions(&self) -> Vec<PermissionInfo> {
        let mut permissions = self.permissions.write().await;

        for (permission_type, info) in permissions.iter_mut() {
            info.status = self.check_permission_internal(*permission_type).await;
            info.last_checked = Some(Utc::now());
        }

        permissions.values().cloned().collect()
    }

    /// Check specific permission
    pub async fn check_permission(&self, permission_type: PermissionType) -> PermissionStatus {
        let status = self.check_permission_internal(permission_type).await;

        // Update stored status
        if let Some(info) = self.permissions.write().await.get_mut(&permission_type) {
            info.status = status;
            info.last_checked = Some(Utc::now());
        }

        status
    }

    /// Check specific permission silently (without triggering any prompts or notifications)
    pub async fn check_permission_silent(
        &self,
        permission_type: PermissionType,
    ) -> PermissionStatus {
        // Just check the status without updating or notifying
        self.check_permission_internal(permission_type).await
    }

    /// Internal permission checking logic
    async fn check_permission_internal(&self, permission_type: PermissionType) -> PermissionStatus {
        let platform = std::env::consts::OS;

        match (platform, permission_type) {
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::ScreenRecording) => {
                self.check_screen_recording_permission_macos().await
            }
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::Accessibility) => {
                self.check_accessibility_permission_macos().await
            }
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::NotificationAccess) => {
                self.check_notification_permission_macos().await
            }
            #[cfg(target_os = "windows")]
            ("windows", PermissionType::TerminalAccess) => {
                self.check_terminal_permission_windows().await
            }
            #[cfg(target_os = "windows")]
            ("windows", PermissionType::AutoStart) => {
                self.check_auto_start_permission_windows().await
            }
            _ => PermissionStatus::NotApplicable,
        }
    }

    /// Request permission
    pub async fn request_permission(
        &self,
        permission_type: PermissionType,
    ) -> Result<PermissionRequestResult, String> {
        // Update request count
        if let Some(info) = self.permissions.write().await.get_mut(&permission_type) {
            info.request_count += 1;
        }

        let platform = std::env::consts::OS;

        match (platform, permission_type) {
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::ScreenRecording) => {
                self.request_screen_recording_permission_macos().await
            }
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::Accessibility) => {
                self.request_accessibility_permission_macos().await
            }
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::NotificationAccess) => {
                self.request_notification_permission_macos().await
            }
            _ => Ok(PermissionRequestResult {
                permission_type,
                status: PermissionStatus::NotApplicable,
                message: Some("Permission not applicable on this platform".to_string()),
                requires_restart: false,
                requires_system_settings: false,
            }),
        }
    }

    /// Get permission info
    pub async fn get_permission_info(
        &self,
        permission_type: PermissionType,
    ) -> Option<PermissionInfo> {
        self.permissions.read().await.get(&permission_type).cloned()
    }

    /// Get all permissions
    pub async fn get_all_permissions(&self) -> Vec<PermissionInfo> {
        self.permissions.read().await.values().cloned().collect()
    }

    /// Get required permissions
    pub async fn get_required_permissions(&self) -> Vec<PermissionInfo> {
        self.permissions
            .read()
            .await
            .values()
            .filter(|info| info.required)
            .cloned()
            .collect()
    }

    /// Get missing required permissions
    pub async fn get_missing_required_permissions(&self) -> Vec<PermissionInfo> {
        self.permissions
            .read()
            .await
            .values()
            .filter(|info| info.required && info.status != PermissionStatus::Granted)
            .cloned()
            .collect()
    }

    /// Check if all required permissions are granted
    pub async fn all_required_permissions_granted(&self) -> bool {
        !self
            .permissions
            .read()
            .await
            .values()
            .any(|info| info.required && info.status != PermissionStatus::Granted)
    }

    /// Open system settings for permission
    pub async fn open_system_settings(
        &self,
        permission_type: PermissionType,
    ) -> Result<(), String> {
        let platform = std::env::consts::OS;

        match (platform, permission_type) {
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::ScreenRecording) => {
                self.open_screen_recording_settings_macos().await
            }
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::Accessibility) => {
                self.open_accessibility_settings_macos().await
            }
            #[cfg(target_os = "macos")]
            ("macos", PermissionType::NotificationAccess) => {
                self.open_notification_settings_macos().await
            }
            #[cfg(target_os = "windows")]
            ("windows", PermissionType::AutoStart) => self.open_startup_settings_windows().await,
            _ => Err("No system settings available for this permission".to_string()),
        }
    }

    /// Register for permission monitoring (call when a view appears)
    pub async fn register_for_monitoring(&self) {
        let prev_count = self.monitor_registration_count.fetch_add(1, Ordering::SeqCst);
        debug!("Registered for monitoring, count: {}", prev_count + 1);

        if prev_count == 0 {
            // First registration, start monitoring
            self.start_monitoring().await;
        }
    }

    /// Unregister from permission monitoring (call when a view disappears)
    pub async fn unregister_from_monitoring(&self) {
        let prev_count = self.monitor_registration_count.fetch_sub(1, Ordering::SeqCst);
        debug!("Unregistered from monitoring, count: {}", prev_count.saturating_sub(1));

        if prev_count == 1 {
            // No more registrations, stop monitoring
            self.stop_monitoring().await;
        }
    }

    /// Start monitoring permissions
    async fn start_monitoring(&self) {
        info!("Starting permission monitoring");

        // Initial check
        let _ = self.check_all_permissions().await;

        // Clone necessary references for the monitoring task
        let permissions = self.permissions.clone();
        let app_handle = self.app_handle.clone();
        let _notification_manager = self.notification_manager.clone();

        // Start monitoring task
        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            
            loop {
                interval.tick().await;
                
                // Check permissions
                let mut perms = permissions.write().await;
                let mut changed = false;
                
                for (permission_type, info) in perms.iter_mut() {
                    let old_status = info.status;
                    
                    // Use platform-specific checks
                    let platform = std::env::consts::OS;
                    let new_status = match (platform, permission_type) {
                        #[cfg(target_os = "macos")]
                        ("macos", PermissionType::ScreenRecording) => {
                            check_screen_recording_permission_macos_static().await
                        }
                        #[cfg(target_os = "macos")]
                        ("macos", PermissionType::Accessibility) => {
                            check_accessibility_permission_macos_static().await
                        }
                        #[cfg(target_os = "macos")]
                        ("macos", PermissionType::NotificationAccess) => {
                            PermissionStatus::Granted // Tauri handles this
                        }
                        _ => info.status, // Keep existing status for other permissions
                    };
                    
                    if old_status != new_status {
                        info.status = new_status;
                        info.last_checked = Some(Utc::now());
                        changed = true;
                    }
                }
                
                // Emit permission change event if any changed
                if changed {
                    if let Some(app) = app_handle.read().await.as_ref() {
                        let _ = app.emit("permissions_updated", ());
                    }
                }
            }
        });

        *self.monitor_handle.write().await = Some(handle);
    }

    /// Stop monitoring permissions
    async fn stop_monitoring(&self) {
        info!("Stopping permission monitoring");
        
        if let Some(handle) = self.monitor_handle.write().await.take() {
            handle.abort();
        }
    }

    /// Show permission alert dialog
    pub async fn show_permission_alert(&self, permission_type: PermissionType) -> Result<(), String> {
        let permission_info = self.get_permission_info(permission_type).await
            .ok_or_else(|| "Permission not found".to_string())?;

        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            // Emit event for frontend to show dialog
            app_handle.emit("show_permission_dialog", &permission_info)
                .map_err(|e| format!("Failed to emit permission dialog event: {}", e))?;
        }

        Ok(())
    }

    // Platform-specific implementations
    #[cfg(target_os = "macos")]
    async fn check_screen_recording_permission_macos(&self) -> PermissionStatus {
        // Use CGDisplayStream API to check screen recording permission
        use std::process::Command;

        let output = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to get properties")
            .output();

        match output {
            Ok(output) if output.status.success() => PermissionStatus::Granted,
            _ => PermissionStatus::NotDetermined,
        }
    }

    #[cfg(target_os = "macos")]
    async fn request_screen_recording_permission_macos(
        &self,
    ) -> Result<PermissionRequestResult, String> {
        // Show notification about needing to grant permission
        if let Some(notification_manager) = &self.notification_manager {
            let _ = notification_manager
                .notify_permission_required(
                    "Screen Recording",
                    "VibeTunnel needs screen recording permission to capture terminal sessions",
                )
                .await;
        }

        // Open system preferences
        let _ = self.open_screen_recording_settings_macos().await;

        Ok(PermissionRequestResult {
            permission_type: PermissionType::ScreenRecording,
            status: PermissionStatus::NotDetermined,
            message: Some(
                "Please grant screen recording permission in System Settings".to_string(),
            ),
            requires_restart: true,
            requires_system_settings: true,
        })
    }

    #[cfg(target_os = "macos")]
    async fn open_screen_recording_settings_macos(&self) -> Result<(), String> {
        use std::process::Command;

        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map_err(|e| format!("Failed to open system preferences: {e}"))?;

        Ok(())
    }

    #[cfg(target_os = "macos")]
    async fn check_accessibility_permission_macos(&self) -> PermissionStatus {
        use std::process::Command;

        let output = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to get UI elements enabled")
            .output();

        match output {
            Ok(output) if output.status.success() => {
                let result = String::from_utf8_lossy(&output.stdout);
                if result.trim() == "true" {
                    PermissionStatus::Granted
                } else {
                    PermissionStatus::Denied
                }
            }
            _ => PermissionStatus::NotDetermined,
        }
    }

    #[cfg(target_os = "macos")]
    async fn request_accessibility_permission_macos(
        &self,
    ) -> Result<PermissionRequestResult, String> {
        let _ = self.open_accessibility_settings_macos().await;

        Ok(PermissionRequestResult {
            permission_type: PermissionType::Accessibility,
            status: PermissionStatus::NotDetermined,
            message: Some("Please grant accessibility permission in System Settings".to_string()),
            requires_restart: false,
            requires_system_settings: true,
        })
    }

    #[cfg(target_os = "macos")]
    async fn open_accessibility_settings_macos(&self) -> Result<(), String> {
        use std::process::Command;

        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| format!("Failed to open system preferences: {e}"))?;

        Ok(())
    }

    #[cfg(target_os = "macos")]
    async fn check_notification_permission_macos(&self) -> PermissionStatus {
        // For now, assume granted as Tauri handles this
        PermissionStatus::Granted
    }

    #[cfg(target_os = "macos")]
    async fn request_notification_permission_macos(
        &self,
    ) -> Result<PermissionRequestResult, String> {
        Ok(PermissionRequestResult {
            permission_type: PermissionType::NotificationAccess,
            status: PermissionStatus::Granted,
            message: Some("Notification permission is handled by the system".to_string()),
            requires_restart: false,
            requires_system_settings: false,
        })
    }

    #[cfg(target_os = "macos")]
    async fn open_notification_settings_macos(&self) -> Result<(), String> {
        use std::process::Command;

        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.notifications")
            .spawn()
            .map_err(|e| format!("Failed to open system preferences: {e}"))?;

        Ok(())
    }

    #[cfg(target_os = "windows")]
    async fn check_terminal_permission_windows(&self) -> PermissionStatus {
        // On Windows, terminal access is generally granted
        PermissionStatus::Granted
    }

    #[cfg(target_os = "windows")]
    async fn check_auto_start_permission_windows(&self) -> PermissionStatus {
        // Check if auto-start is configured
        use crate::auto_launch;

        match auto_launch::get_auto_launch().await {
            Ok(enabled) => {
                if enabled {
                    PermissionStatus::Granted
                } else {
                    PermissionStatus::Denied
                }
            }
            Err(_) => PermissionStatus::NotDetermined,
        }
    }

    #[cfg(target_os = "windows")]
    async fn open_startup_settings_windows(&self) -> Result<(), String> {
        use std::process::Command;

        Command::new("cmd")
            .args(&["/c", "start", "ms-settings:startupapps"])
            .spawn()
            .map_err(|e| format!("Failed to open startup settings: {}", e))?;

        Ok(())
    }

    /// Show permission required notification
    #[allow(dead_code)]
    pub async fn notify_permission_required(
        &self,
        permission_info: &PermissionInfo,
    ) -> Result<(), String> {
        if let Some(notification_manager) = &self.notification_manager {
            notification_manager
                .notify_permission_required(
                    &format!("{:?}", permission_info.permission_type),
                    &permission_info.description,
                )
                .await?;
        }

        Ok(())
    }
}

/// Permission statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionStats {
    pub total_permissions: usize,
    pub granted_permissions: usize,
    pub denied_permissions: usize,
    pub required_permissions: usize,
    pub missing_required: usize,
    pub platform: String,
}

// Static permission check functions for use in monitoring task
#[cfg(target_os = "macos")]
async fn check_screen_recording_permission_macos_static() -> PermissionStatus {
    use std::process::Command;

    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to get properties")
        .output();

    match output {
        Ok(output) if output.status.success() => PermissionStatus::Granted,
        _ => PermissionStatus::NotDetermined,
    }
}

// Add enhanced screen recording check for macOS
#[cfg(target_os = "macos")]
fn check_screen_recording_with_cg() -> PermissionStatus {
    use core_graphics::display::CGDisplay;
    
    // Try to get display information - this requires screen recording permission
    match CGDisplay::active_displays() {
        Ok(displays) => {
            if displays.is_empty() {
                // No displays found could mean no permission
                PermissionStatus::NotDetermined
            } else {
                PermissionStatus::Granted
            }
        }
        Err(_) => PermissionStatus::Denied,
    }
}

// Tauri commands for enhanced permission functionality are in commands.rs

#[cfg(target_os = "macos")]
async fn check_accessibility_permission_macos_static() -> PermissionStatus {
    use std::process::Command;

    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to get UI elements enabled")
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let result = String::from_utf8_lossy(&output.stdout);
            if result.trim() == "true" {
                PermissionStatus::Granted
            } else {
                PermissionStatus::Denied
            }
        }
        _ => PermissionStatus::NotDetermined,
    }
}
