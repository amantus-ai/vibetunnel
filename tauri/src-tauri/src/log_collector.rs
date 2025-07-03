use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

pub struct LogCollector {
    buffer: Arc<RwLock<VecDeque<LogEntry>>>,
    max_size: usize,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl LogCollector {
    pub fn new(max_size: usize) -> Self {
        Self {
            buffer: Arc::new(RwLock::new(VecDeque::with_capacity(max_size))),
            max_size,
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.write().await = Some(app_handle);
    }

    pub async fn add_log(&self, level: &str, message: String) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let entry = LogEntry {
            timestamp,
            level: level.to_string(),
            message,
        };

        // Emit to frontend if app handle is available
        if let Some(ref app) = *self.app_handle.read().await {
            let _ = app.emit("server-log", &entry);
        }

        // Add to buffer
        let mut buffer = self.buffer.write().await;
        if buffer.len() >= self.max_size {
            buffer.pop_front();
        }
        buffer.push_back(entry);
    }

    pub async fn get_logs(&self) -> Vec<LogEntry> {
        self.buffer.read().await.iter().cloned().collect()
    }

    pub async fn clear(&self) {
        self.buffer.write().await.clear();
    }
}

// Global log collector instance
lazy_static::lazy_static! {
    pub static ref SERVER_LOG_COLLECTOR: Arc<LogCollector> = Arc::new(LogCollector::new(1000));
}

// These functions are exposed through commands.rs which already has the tauri::command attributes

// Initialize the log collector with app handle
pub async fn init_log_collector(app_handle: AppHandle) {
    SERVER_LOG_COLLECTOR.set_app_handle(app_handle).await;
}