use tokio::sync::RwLock;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use crate::terminal::TerminalManager;
use crate::server::HttpServer;
use crate::ngrok::NgrokManager;

#[derive(Clone)]
pub struct AppState {
    pub terminal_manager: Arc<TerminalManager>,
    pub http_server: Arc<RwLock<Option<HttpServer>>>,
    pub ngrok_manager: Arc<NgrokManager>,
    pub server_monitoring: Arc<AtomicBool>,
    pub server_target_port: Arc<RwLock<Option<u16>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            terminal_manager: Arc::new(TerminalManager::new()),
            http_server: Arc::new(RwLock::new(None)),
            ngrok_manager: Arc::new(NgrokManager::new()),
            server_monitoring: Arc::new(AtomicBool::new(true)),
            server_target_port: Arc::new(RwLock::new(None)),
        }
    }
}