use serde::{Deserialize, Serialize};
use std::io::Read;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tracing::{error, info};

const SOCKET_PATH: &str = "/tmp/vibetunnel-terminal.sock";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnRequest {
    pub tty_fwd_path: Option<String>,
    pub working_dir: String,
    pub session_id: String,
    pub command: String,
    pub terminal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnResponse {
    pub success: bool,
    pub error: Option<String>,
    pub session_id: Option<String>,
}

pub struct UnixSocketServer {
    request_tx: mpsc::Sender<SpawnRequest>,
    request_rx: Arc<Mutex<Option<mpsc::Receiver<SpawnRequest>>>>,
    terminal_spawn_service: Arc<crate::terminal_spawn_service::TerminalSpawnService>,
}

impl UnixSocketServer {
    pub fn new(
        terminal_spawn_service: Arc<crate::terminal_spawn_service::TerminalSpawnService>,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<SpawnRequest>(100);

        Self {
            request_tx: tx,
            request_rx: Arc::new(Mutex::new(Some(rx))),
            terminal_spawn_service,
        }
    }

    pub fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Spawn the handler for requests now that runtime is available
        let rx = self.request_rx.lock().unwrap().take();
        if let Some(mut rx) = rx {
            let spawn_service = self.terminal_spawn_service.clone();
            tokio::spawn(async move {
                while let Some(request) = rx.recv().await {
                    let service = spawn_service.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_spawn_request(request, service).await {
                            error!("Failed to handle spawn request: {}", e);
                        }
                    });
                }
            });
        }

        // Remove existing socket if it exists
        if Path::new(SOCKET_PATH).exists() {
            std::fs::remove_file(SOCKET_PATH)?;
        }

        let listener = UnixListener::bind(SOCKET_PATH)?;
        info!("Terminal spawn service listening on {}", SOCKET_PATH);

        let tx = self.request_tx.clone();

        // Spawn thread to handle Unix socket connections
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let tx = tx.clone();
                        std::thread::spawn(move || {
                            if let Err(e) = handle_connection(stream, tx) {
                                error!("Failed to handle connection: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        error!("Failed to accept connection: {}", e);
                    }
                }
            }
        });

        Ok(())
    }

    pub fn stop(&self) -> Result<(), Box<dyn std::error::Error>> {
        info!("Stopping terminal spawn service");
        if Path::new(SOCKET_PATH).exists() {
            std::fs::remove_file(SOCKET_PATH)?;
        }
        Ok(())
    }
}

fn handle_connection(
    mut stream: UnixStream,
    tx: mpsc::Sender<SpawnRequest>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer)?;

    let request: SpawnRequest = serde_json::from_slice(&buffer)?;
    info!("Received spawn request for session {}", request.session_id);

    // Send request to async handler
    if let Err(e) = tx.blocking_send(request.clone()) {
        let response = SpawnResponse {
            success: false,
            error: Some(format!("Failed to queue request: {e}")),
            session_id: None,
        };
        let response_data = serde_json::to_vec(&response)?;
        std::io::Write::write_all(&mut stream, &response_data)?;
        return Ok(());
    }

    // Send success response
    let response = SpawnResponse {
        success: true,
        error: None,
        session_id: Some(request.session_id),
    };
    let response_data = serde_json::to_vec(&response)?;
    std::io::Write::write_all(&mut stream, &response_data)?;

    Ok(())
}

async fn handle_spawn_request(
    request: SpawnRequest,
    terminal_spawn_service: Arc<crate::terminal_spawn_service::TerminalSpawnService>,
) -> Result<(), String> {
    let spawn_request = crate::terminal_spawn_service::TerminalSpawnRequest {
        session_id: request.session_id,
        terminal_type: request.terminal,
        command: Some(request.command),
        working_directory: Some(request.working_dir),
        environment: None,
    };

    terminal_spawn_service.spawn_terminal(spawn_request).await
}

impl Drop for UnixSocketServer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
