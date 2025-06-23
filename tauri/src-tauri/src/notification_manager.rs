use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::RwLock;

/// Notification type enumeration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum NotificationType {
    Info,
    Success,
    Warning,
    Error,
    ServerStatus,
    UpdateAvailable,
    PermissionRequired,
    SessionEvent,
}

/// Notification priority levels
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum NotificationPriority {
    Low,
    Normal,
    High,
    Critical,
}

/// Notification structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub notification_type: NotificationType,
    pub priority: NotificationPriority,
    pub title: String,
    pub body: String,
    pub timestamp: DateTime<Utc>,
    pub read: bool,
    pub actions: Vec<NotificationAction>,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Notification action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    pub id: String,
    pub label: String,
    pub action_type: String,
}

/// Notification settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub show_in_system: bool,
    pub play_sound: bool,
    pub enabled_types: HashMap<NotificationType, bool>,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        let mut enabled_types = HashMap::new();
        enabled_types.insert(NotificationType::Info, true);
        enabled_types.insert(NotificationType::Success, true);
        enabled_types.insert(NotificationType::Warning, true);
        enabled_types.insert(NotificationType::Error, true);
        enabled_types.insert(NotificationType::ServerStatus, true);
        enabled_types.insert(NotificationType::UpdateAvailable, true);
        enabled_types.insert(NotificationType::PermissionRequired, true);
        enabled_types.insert(NotificationType::SessionEvent, false);

        Self {
            enabled: true,
            show_in_system: true,
            play_sound: true,
            enabled_types,
        }
    }
}

/// Notification manager
pub struct NotificationManager {
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    notifications: Arc<RwLock<HashMap<String, Notification>>>,
    settings: Arc<RwLock<NotificationSettings>>,
    notification_history: Arc<RwLock<Vec<Notification>>>,
    max_history_size: usize,
}

impl Default for NotificationManager {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationManager {
    /// Create a new notification manager
    pub fn new() -> Self {
        Self {
            app_handle: Arc::new(RwLock::new(None)),
            notifications: Arc::new(RwLock::new(HashMap::new())),
            settings: Arc::new(RwLock::new(NotificationSettings::default())),
            notification_history: Arc::new(RwLock::new(Vec::new())),
            max_history_size: 100,
        }
    }

    /// Set the app handle
    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.write().await = Some(app_handle);
    }

    /// Update notification settings
    pub async fn update_settings(&self, settings: NotificationSettings) {
        *self.settings.write().await = settings;
    }

    /// Get notification settings
    pub async fn get_settings(&self) -> NotificationSettings {
        self.settings.read().await.clone()
    }

    /// Show a notification
    pub async fn show_notification(
        &self,
        notification_type: NotificationType,
        priority: NotificationPriority,
        title: String,
        body: String,
        actions: Vec<NotificationAction>,
        metadata: HashMap<String, serde_json::Value>,
    ) -> Result<String, String> {
        let settings = self.settings.read().await;

        // Check if notifications are enabled
        if !settings.enabled {
            return Ok("notifications_disabled".to_string());
        }

        // Check if this notification type is enabled
        if let Some(&enabled) = settings.enabled_types.get(&notification_type) {
            if !enabled {
                return Ok("notification_type_disabled".to_string());
            }
        }

        let notification_id = uuid::Uuid::new_v4().to_string();
        let notification = Notification {
            id: notification_id.clone(),
            notification_type,
            priority,
            title: title.clone(),
            body: body.clone(),
            timestamp: Utc::now(),
            read: false,
            actions,
            metadata,
        };

        // Store notification
        self.notifications
            .write()
            .await
            .insert(notification_id.clone(), notification.clone());

        // Add to history
        let mut history = self.notification_history.write().await;
        history.push(notification.clone());

        // Trim history if it exceeds max size
        if history.len() > self.max_history_size {
            let drain_count = history.len() - self.max_history_size;
            history.drain(0..drain_count);
        }

        // Show system notification if enabled
        if settings.show_in_system {
            match self
                .show_system_notification(&title, &body, notification_type)
                .await
            {
                Ok(()) => {}
                Err(e) => {
                    tracing::error!("Failed to show system notification: {}", e);
                }
            }
        }

        // Emit notification event to frontend
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            app_handle
                .emit("notification:new", &notification)
                .map_err(|e| format!("Failed to emit notification event: {e}"))?;
        }

        Ok(notification_id)
    }

    /// Show a system notification using Tauri's notification plugin
    async fn show_system_notification(
        &self,
        title: &str,
        body: &str,
        notification_type: NotificationType,
    ) -> Result<(), String> {
        let app_handle_guard = self.app_handle.read().await;
        let app_handle = app_handle_guard
            .as_ref()
            .ok_or_else(|| "App handle not set".to_string())?;

        let mut builder = app_handle.notification().builder().title(title).body(body);

        // Set icon based on notification type
        let icon = match notification_type {
            NotificationType::Success => Some("✅"),
            NotificationType::Warning => Some("⚠️"),
            NotificationType::Error => Some("❌"),
            NotificationType::UpdateAvailable => Some("🔄"),
            NotificationType::PermissionRequired => Some("🔐"),
            NotificationType::ServerStatus => Some("🖥️"),
            NotificationType::SessionEvent => Some("💻"),
            NotificationType::Info => Some("ℹ️"),
        };

        if let Some(icon_str) = icon {
            builder = builder.icon(icon_str);
        }

        builder
            .show()
            .map_err(|e| format!("Failed to show notification: {e}"))?;

        Ok(())
    }

    /// Mark notification as read
    pub async fn mark_as_read(&self, notification_id: &str) -> Result<(), String> {
        let mut notifications = self.notifications.write().await;
        if let Some(notification) = notifications.get_mut(notification_id) {
            notification.read = true;

            // Update history
            let mut history = self.notification_history.write().await;
            if let Some(hist_notification) = history.iter_mut().find(|n| n.id == notification_id) {
                hist_notification.read = true;
            }

            Ok(())
        } else {
            Err("Notification not found".to_string())
        }
    }

    /// Mark all notifications as read
    pub async fn mark_all_as_read(&self) -> Result<(), String> {
        let mut notifications = self.notifications.write().await;
        for notification in notifications.values_mut() {
            notification.read = true;
        }

        let mut history = self.notification_history.write().await;
        for notification in history.iter_mut() {
            notification.read = true;
        }

        Ok(())
    }

    /// Get all notifications
    pub async fn get_notifications(&self) -> Vec<Notification> {
        self.notifications.read().await.values().cloned().collect()
    }

    /// Get unread notification count
    pub async fn get_unread_count(&self) -> usize {
        self.notifications
            .read()
            .await
            .values()
            .filter(|n| !n.read)
            .count()
    }

    /// Get notification history
    pub async fn get_history(&self, limit: Option<usize>) -> Vec<Notification> {
        let history = self.notification_history.read().await;
        match limit {
            Some(l) => history.iter().rev().take(l).cloned().collect(),
            None => history.clone(),
        }
    }

    /// Clear notification
    pub async fn clear_notification(&self, notification_id: &str) -> Result<(), String> {
        self.notifications.write().await.remove(notification_id);
        Ok(())
    }

    /// Clear all notifications
    pub async fn clear_all_notifications(&self) -> Result<(), String> {
        self.notifications.write().await.clear();
        Ok(())
    }

    /// Show server status notification
    pub async fn notify_server_status(&self, running: bool, port: u16) -> Result<String, String> {
        let (title, body) = if running {
            (
                "Server Started".to_string(),
                format!("VibeTunnel server is now running on port {port}"),
            )
        } else {
            (
                "Server Stopped".to_string(),
                "VibeTunnel server has been stopped".to_string(),
            )
        };

        self.show_notification(
            NotificationType::ServerStatus,
            NotificationPriority::Normal,
            title,
            body,
            vec![],
            HashMap::new(),
        )
        .await
    }

    /// Show update available notification
    pub async fn notify_update_available(
        &self,
        version: &str,
        download_url: &str,
    ) -> Result<String, String> {
        let mut metadata = HashMap::new();
        metadata.insert(
            "version".to_string(),
            serde_json::Value::String(version.to_string()),
        );
        metadata.insert(
            "download_url".to_string(),
            serde_json::Value::String(download_url.to_string()),
        );

        self.show_notification(
            NotificationType::UpdateAvailable,
            NotificationPriority::High,
            "Update Available".to_string(),
            format!(
                "VibeTunnel {version} is now available. Click to download."
            ),
            vec![NotificationAction {
                id: "download".to_string(),
                label: "Download".to_string(),
                action_type: "open_url".to_string(),
            }],
            metadata,
        )
        .await
    }

    /// Show permission required notification
    pub async fn notify_permission_required(
        &self,
        permission: &str,
        reason: &str,
    ) -> Result<String, String> {
        let mut metadata = HashMap::new();
        metadata.insert(
            "permission".to_string(),
            serde_json::Value::String(permission.to_string()),
        );

        self.show_notification(
            NotificationType::PermissionRequired,
            NotificationPriority::High,
            "Permission Required".to_string(),
            format!("{permission} permission is required: {reason}"),
            vec![NotificationAction {
                id: "grant".to_string(),
                label: "Grant Permission".to_string(),
                action_type: "request_permission".to_string(),
            }],
            metadata,
        )
        .await
    }

    /// Show error notification
    pub async fn notify_error(&self, title: &str, error_message: &str) -> Result<String, String> {
        self.show_notification(
            NotificationType::Error,
            NotificationPriority::High,
            title.to_string(),
            error_message.to_string(),
            vec![],
            HashMap::new(),
        )
        .await
    }

    /// Show success notification
    pub async fn notify_success(&self, title: &str, message: &str) -> Result<String, String> {
        self.show_notification(
            NotificationType::Success,
            NotificationPriority::Normal,
            title.to_string(),
            message.to_string(),
            vec![],
            HashMap::new(),
        )
        .await
    }
}
