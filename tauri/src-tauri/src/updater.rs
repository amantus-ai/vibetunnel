use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::RwLock;

/// Update channel type
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum UpdateChannel {
    Stable,
    Beta,
    Nightly,
    Custom,
}

impl UpdateChannel {
    pub fn as_str(&self) -> &str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
            UpdateChannel::Nightly => "nightly",
            UpdateChannel::Custom => "custom",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "stable" => UpdateChannel::Stable,
            "beta" => UpdateChannel::Beta,
            "nightly" => UpdateChannel::Nightly,
            _ => UpdateChannel::Custom,
        }
    }
}

/// Update status
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
    NoUpdate,
}

/// Update information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub pub_date: Option<DateTime<Utc>>,
    pub download_size: Option<u64>,
    pub signature: Option<String>,
    pub download_url: String,
    pub channel: UpdateChannel,
}

/// Update progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f32,
    pub bytes_per_second: Option<u64>,
    pub eta_seconds: Option<u64>,
}

/// Update settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdaterSettings {
    pub channel: UpdateChannel,
    pub check_on_startup: bool,
    pub check_interval_hours: u32,
    pub auto_download: bool,
    pub auto_install: bool,
    pub show_release_notes: bool,
    pub include_pre_releases: bool,
    pub custom_endpoint: Option<String>,
    pub proxy: Option<String>,
}

impl Default for UpdaterSettings {
    fn default() -> Self {
        Self {
            channel: UpdateChannel::Stable,
            check_on_startup: true,
            check_interval_hours: 24,
            auto_download: false,
            auto_install: false,
            show_release_notes: true,
            include_pre_releases: false,
            custom_endpoint: None,
            proxy: None,
        }
    }
}

/// Update manager state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateState {
    pub status: UpdateStatus,
    pub current_version: String,
    pub available_update: Option<UpdateInfo>,
    pub progress: Option<UpdateProgress>,
    pub last_check: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub update_history: Vec<UpdateHistoryEntry>,
}

/// Update history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateHistoryEntry {
    pub version: String,
    pub from_version: String,
    pub channel: UpdateChannel,
    pub installed_at: DateTime<Utc>,
    pub success: bool,
    pub notes: Option<String>,
}

/// Update manager
pub struct UpdateManager {
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    settings: Arc<RwLock<UpdaterSettings>>,
    state: Arc<RwLock<UpdateState>>,
    notification_manager: Option<Arc<crate::notification_manager::NotificationManager>>,
}

impl UpdateManager {
    /// Create a new update manager
    pub fn new(current_version: String) -> Self {
        Self {
            app_handle: Arc::new(RwLock::new(None)),
            settings: Arc::new(RwLock::new(UpdaterSettings::default())),
            state: Arc::new(RwLock::new(UpdateState {
                status: UpdateStatus::Idle,
                current_version,
                available_update: None,
                progress: None,
                last_check: None,
                last_error: None,
                update_history: Vec::new(),
            })),
            notification_manager: None,
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

    /// Load settings from configuration
    pub async fn load_settings(&self) -> Result<(), String> {
        if let Ok(settings) = crate::settings::Settings::load() {
            if let Some(update_settings) = settings.updates {
                let mut updater_settings = self.settings.write().await;
                updater_settings.channel = UpdateChannel::from_str(&update_settings.channel);
                updater_settings.check_on_startup = true;
                updater_settings.check_interval_hours =
                    match update_settings.check_frequency.as_str() {
                        "daily" => 24,
                        "weekly" => 168,
                        "monthly" => 720,
                        _ => 24,
                    };
                updater_settings.auto_download = update_settings.auto_download;
                updater_settings.auto_install = update_settings.auto_install;
                updater_settings.show_release_notes = update_settings.show_release_notes;
                updater_settings.include_pre_releases = update_settings.include_pre_releases;
            }
        }
        Ok(())
    }

    /// Get update settings
    pub async fn get_settings(&self) -> UpdaterSettings {
        self.settings.read().await.clone()
    }

    /// Update settings
    pub async fn update_settings(&self, settings: UpdaterSettings) -> Result<(), String> {
        *self.settings.write().await = settings.clone();

        // Save to persistent settings
        if let Ok(mut app_settings) = crate::settings::Settings::load() {
            app_settings.updates = Some(crate::settings::UpdateSettings {
                channel: settings.channel.as_str().to_string(),
                check_frequency: match settings.check_interval_hours {
                    1..=23 => "daily".to_string(),
                    24..=167 => "daily".to_string(),
                    168..=719 => "weekly".to_string(),
                    _ => "monthly".to_string(),
                },
                auto_download: settings.auto_download,
                auto_install: settings.auto_install,
                show_release_notes: settings.show_release_notes,
                include_pre_releases: settings.include_pre_releases,
            });
            app_settings.save()?;
        }

        Ok(())
    }

    /// Get current update state
    pub async fn get_state(&self) -> UpdateState {
        self.state.read().await.clone()
    }

    /// Check for updates
    pub async fn check_for_updates(&self) -> Result<Option<UpdateInfo>, String> {
        // Update status
        {
            let mut state = self.state.write().await;
            state.status = UpdateStatus::Checking;
            state.last_error = None;
        }

        // Emit checking event
        self.emit_update_event("checking", None).await;

        let app_handle_guard = self.app_handle.read().await;
        let app_handle = app_handle_guard
            .as_ref()
            .ok_or_else(|| "App handle not set".to_string())?;

        // Get the updater instance
        let updater = app_handle.updater_builder();

        // Configure updater based on settings
        let settings = self.settings.read().await;

        // Build updater with channel-specific endpoint
        let updater_result = match settings.channel {
            UpdateChannel::Stable => updater.endpoints(vec![
                "https://releases.vibetunnel.com/stable/{{target}}/{{arch}}/{{current_version}}"
                    .parse()
                    .unwrap(),
            ]),
            UpdateChannel::Beta => updater.endpoints(vec![
                "https://releases.vibetunnel.com/beta/{{target}}/{{arch}}/{{current_version}}"
                    .parse()
                    .unwrap(),
            ]),
            UpdateChannel::Nightly => updater.endpoints(vec![
                "https://releases.vibetunnel.com/nightly/{{target}}/{{arch}}/{{current_version}}"
                    .parse()
                    .unwrap(),
            ]),
            UpdateChannel::Custom => {
                if let Some(endpoint) = &settings.custom_endpoint {
                    match endpoint.parse() {
                        Ok(url) => updater.endpoints(vec![url]),
                        Err(_) => return Err("Invalid custom endpoint URL".to_string()),
                    }
                } else {
                    return Err("Custom endpoint not configured".to_string());
                }
            }
        };

        // Build and check
        match updater_result {
            Ok(updater_builder) => match updater_builder.build() {
                Ok(updater) => {
                    match updater.check().await {
                        Ok(Some(update)) => {
                            let update_info = UpdateInfo {
                                version: update.version.clone(),
                                notes: update.body.clone().unwrap_or_default(),
                                pub_date: update.date.map(|d| {
                                    Utc.timestamp_opt(d.unix_timestamp(), 0)
                                        .single()
                                        .unwrap_or(Utc::now())
                                }),
                                download_size: None, // TODO: Get from update
                                signature: None,
                                download_url: String::new(), // Will be set by updater
                                channel: settings.channel,
                            };

                            // Update state
                            {
                                let mut state = self.state.write().await;
                                state.status = UpdateStatus::Available;
                                state.available_update = Some(update_info.clone());
                                state.last_check = Some(Utc::now());
                            }

                            // Emit available event
                            self.emit_update_event("available", Some(&update_info))
                                .await;

                            // Show notification
                            if let Some(notification_manager) = &self.notification_manager {
                                let _ = notification_manager
                                    .notify_update_available(
                                        &update_info.version,
                                        &update_info.download_url,
                                    )
                                    .await;
                            }

                            // Auto-download if enabled
                            if settings.auto_download {
                                let _ = self.download_update().await;
                            }

                            Ok(Some(update_info))
                        }
                        Ok(None) => {
                            // No update available
                            let mut state = self.state.write().await;
                            state.status = UpdateStatus::NoUpdate;
                            state.last_check = Some(Utc::now());

                            self.emit_update_event("no-update", None).await;

                            Ok(None)
                        }
                        Err(e) => {
                            let error_msg = format!("Failed to check for updates: {}", e);

                            let mut state = self.state.write().await;
                            state.status = UpdateStatus::Error;
                            state.last_error = Some(error_msg.clone());
                            state.last_check = Some(Utc::now());

                            self.emit_update_event("error", None).await;

                            Err(error_msg)
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to build updater: {}", e);

                    let mut state = self.state.write().await;
                    state.status = UpdateStatus::Error;
                    state.last_error = Some(error_msg.clone());

                    Err(error_msg)
                }
            },
            Err(e) => {
                let error_msg = format!("Failed to configure updater endpoints: {}", e);

                let mut state = self.state.write().await;
                state.status = UpdateStatus::Error;
                state.last_error = Some(error_msg.clone());

                Err(error_msg)
            }
        }
    }

    /// Download update
    pub async fn download_update(&self) -> Result<(), String> {
        let update_available = {
            let state = self.state.read().await;
            state.available_update.is_some()
        };

        if !update_available {
            return Err("No update available to download".to_string());
        }

        // Update status
        {
            let mut state = self.state.write().await;
            state.status = UpdateStatus::Downloading;
            state.progress = Some(UpdateProgress {
                downloaded: 0,
                total: 0,
                percentage: 0.0,
                bytes_per_second: None,
                eta_seconds: None,
            });
        }

        self.emit_update_event("downloading", None).await;

        // TODO: Implement actual download with progress tracking
        // For now, simulate download completion
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Update status to ready
        {
            let mut state = self.state.write().await;
            state.status = UpdateStatus::Ready;
            state.progress = None;
        }

        self.emit_update_event("ready", None).await;

        // Auto-install if enabled
        let settings = self.settings.read().await;
        if settings.auto_install {
            let _ = self.install_update().await;
        }

        Ok(())
    }

    /// Install update
    pub async fn install_update(&self) -> Result<(), String> {
        let update_info = {
            let state = self.state.read().await;
            if state.status != UpdateStatus::Ready {
                return Err("Update not ready for installation".to_string());
            }
            state.available_update.clone()
        };

        let update_info = update_info.ok_or_else(|| "No update available".to_string())?;

        // Update status
        {
            let mut state = self.state.write().await;
            state.status = UpdateStatus::Installing;
        }

        self.emit_update_event("installing", None).await;

        // Add to history
        {
            let mut state = self.state.write().await;
            let from_version = state.current_version.clone();
            state.update_history.push(UpdateHistoryEntry {
                version: update_info.version.clone(),
                from_version,
                channel: update_info.channel,
                installed_at: Utc::now(),
                success: true,
                notes: Some(update_info.notes.clone()),
            });
        }

        // TODO: Implement actual installation
        // For now, return success

        self.emit_update_event("installed", None).await;

        Ok(())
    }

    /// Cancel update
    pub async fn cancel_update(&self) -> Result<(), String> {
        let mut state = self.state.write().await;

        match state.status {
            UpdateStatus::Downloading => {
                // TODO: Cancel download
                state.status = UpdateStatus::Available;
                state.progress = None;
                Ok(())
            }
            _ => Err("No update in progress to cancel".to_string()),
        }
    }

    /// Switch update channel
    pub async fn switch_channel(&self, channel: UpdateChannel) -> Result<(), String> {
        let mut settings = self.settings.write().await;
        settings.channel = channel;
        drop(settings);

        // Save settings
        self.update_settings(self.get_settings().await).await?;

        // Clear current update info when switching channels
        let mut state = self.state.write().await;
        state.available_update = None;
        state.status = UpdateStatus::Idle;

        Ok(())
    }

    /// Get update history
    pub async fn get_update_history(&self, limit: Option<usize>) -> Vec<UpdateHistoryEntry> {
        let state = self.state.read().await;
        match limit {
            Some(l) => state.update_history.iter().rev().take(l).cloned().collect(),
            None => state.update_history.clone(),
        }
    }

    /// Start automatic update checking
    pub async fn start_auto_check(self: Arc<Self>) {
        let settings = self.settings.read().await;
        if !settings.check_on_startup {
            return;
        }

        let check_interval =
            std::time::Duration::from_secs(settings.check_interval_hours as u64 * 3600);
        drop(settings);

        tokio::spawn(async move {
            loop {
                let _ = self.check_for_updates().await;
                tokio::time::sleep(check_interval).await;
            }
        });
    }

    /// Emit update event
    async fn emit_update_event(&self, event_type: &str, update_info: Option<&UpdateInfo>) {
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let event_data = serde_json::json!({
                "type": event_type,
                "update": update_info,
                "state": self.get_state().await,
            });

            let _ = app_handle.emit("updater:event", event_data);
        }
    }
}

/// Update check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub channel: UpdateChannel,
    pub checked_at: DateTime<Utc>,
}
