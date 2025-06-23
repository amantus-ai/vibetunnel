use bytes::Bytes;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, RwLock};
use tracing::{error, info};
use uuid::Uuid;

/// Represents a forwarded TTY session
pub struct ForwardedSession {
    pub id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub connected: bool,
    pub client_count: usize,
}

/// Manages TTY forwarding sessions
pub struct TTYForwardManager {
    sessions: Arc<RwLock<HashMap<String, ForwardedSession>>>,
    listeners: Arc<RwLock<HashMap<String, oneshot::Sender<()>>>>,
}

impl Default for TTYForwardManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TTYForwardManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            listeners: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Start a TTY forwarding session
    pub async fn start_forward(
        &self,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
        shell: Option<String>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();

        // Create TCP listener
        let listener = TcpListener::bind(format!("127.0.0.1:{local_port}"))
            .await
            .map_err(|e| format!("Failed to bind to port {local_port}: {e}"))?;

        let actual_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {e}"))?
            .port();

        // Create session
        let session = ForwardedSession {
            id: id.clone(),
            local_port: actual_port,
            remote_host: remote_host.clone(),
            remote_port,
            connected: false,
            client_count: 0,
        };

        // Store session
        self.sessions.write().await.insert(id.clone(), session);

        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        self.listeners.write().await.insert(id.clone(), shutdown_tx);

        // Start listening for connections
        let sessions = self.sessions.clone();
        let session_id = id.clone();
        let shell = shell.unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(target_os = "windows") {
                    "cmd.exe".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
        });

        tokio::spawn(async move {
            Self::accept_connections(
                listener,
                sessions,
                session_id,
                remote_host,
                remote_port,
                shell,
                shutdown_rx,
            )
            .await;
        });

        info!("Started TTY forward on port {} (ID: {})", actual_port, id);
        Ok(id)
    }

    /// Accept incoming connections and forward them
    async fn accept_connections(
        listener: TcpListener,
        sessions: Arc<RwLock<HashMap<String, ForwardedSession>>>,
        session_id: String,
        _remote_host: String,
        _remote_port: u16,
        shell: String,
        mut shutdown_rx: oneshot::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, addr)) => {
                            info!("New TTY forward connection from {}", addr);

                            // Update client count
                            if let Some(session) = sessions.write().await.get_mut(&session_id) {
                                session.client_count += 1;
                                session.connected = true;
                            }

                            // Handle the connection
                            let sessions_clone = sessions.clone();
                            let session_id_clone = session_id.clone();
                            let shell_clone = shell.clone();

                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_client(
                                    stream,
                                    sessions_clone.clone(),
                                    session_id_clone.clone(),
                                    shell_clone,
                                ).await {
                                    error!("Error handling TTY forward client: {}", e);
                                }

                                // Decrease client count
                                if let Some(session) = sessions_clone.write().await.get_mut(&session_id_clone) {
                                    session.client_count = session.client_count.saturating_sub(1);
                                    if session.client_count == 0 {
                                        session.connected = false;
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            error!("Failed to accept connection: {}", e);
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    info!("Shutting down TTY forward listener for session {}", session_id);
                    break;
                }
            }
        }
    }

    /// Handle a single client connection
    async fn handle_client(
        stream: TcpStream,
        _sessions: Arc<RwLock<HashMap<String, ForwardedSession>>>,
        _session_id: String,
        shell: String,
    ) -> Result<(), String> {
        // Set up PTY
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        // Spawn shell
        let cmd = CommandBuilder::new(&shell);
        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {e}"))?;

        // Get reader and writer
        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {e}"))?;

        let mut writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {e}"))?;

        // Create channels for bidirectional communication
        let (tx_to_pty, mut rx_from_tcp) = mpsc::unbounded_channel::<Bytes>();
        let (tx_to_tcp, mut rx_from_pty) = mpsc::unbounded_channel::<Bytes>();

        // Split the TCP stream
        let (mut tcp_reader, mut tcp_writer) = stream.into_split();

        // Task 1: Read from TCP and write to PTY
        let tcp_to_pty = tokio::spawn(async move {
            let mut tcp_buf = [0u8; 4096];
            loop {
                match tcp_reader.read(&mut tcp_buf).await {
                    Ok(0) => break, // Connection closed
                    Ok(n) => {
                        let data = Bytes::copy_from_slice(&tcp_buf[..n]);
                        if tx_to_pty.send(data).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Error reading from TCP: {}", e);
                        break;
                    }
                }
            }
        });

        // Task 2: Read from PTY and write to TCP
        let pty_to_tcp = tokio::spawn(async move {
            while let Some(data) = rx_from_pty.recv().await {
                if tcp_writer.write_all(&data).await.is_err() {
                    break;
                }
                if tcp_writer.flush().await.is_err() {
                    break;
                }
            }
        });

        // Task 3: PTY reader thread
        let reader_handle = std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = Bytes::copy_from_slice(&buffer[..n]);
                        // Since we're in a thread, we can't use blocking_send on unbounded channel
                        // We'll use a different approach
                        if tx_to_tcp.send(data).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Error reading from PTY: {}", e);
                        break;
                    }
                }
            }
        });

        // Task 4: PTY writer thread
        let writer_handle = std::thread::spawn(move || {
            // Create a blocking runtime for the thread
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();

            rt.block_on(async {
                while let Some(data) = rx_from_tcp.recv().await {
                    if writer.write_all(&data).is_err() {
                        break;
                    }
                    if writer.flush().is_err() {
                        break;
                    }
                }
            });
        });

        // Wait for any task to complete
        tokio::select! {
            _ = tcp_to_pty => {},
            _ = pty_to_tcp => {},
        }

        // Clean up
        drop(child);
        let _ = reader_handle.join();
        let _ = writer_handle.join();

        Ok(())
    }

    /// Stop a TTY forwarding session
    pub async fn stop_forward(&self, id: &str) -> Result<(), String> {
        // Remove session
        self.sessions.write().await.remove(id);

        // Send shutdown signal
        if let Some(shutdown_tx) = self.listeners.write().await.remove(id) {
            let _ = shutdown_tx.send(());
        }

        info!("Stopped TTY forward session: {}", id);
        Ok(())
    }

    /// List all active forwarding sessions
    pub async fn list_forwards(&self) -> Vec<ForwardedSession> {
        self.sessions
            .read()
            .await
            .values()
            .map(|s| ForwardedSession {
                id: s.id.clone(),
                local_port: s.local_port,
                remote_host: s.remote_host.clone(),
                remote_port: s.remote_port,
                connected: s.connected,
                client_count: s.client_count,
            })
            .collect()
    }

    /// Get a specific forwarding session
    pub async fn get_forward(&self, id: &str) -> Option<ForwardedSession> {
        self.sessions
            .read()
            .await
            .get(id)
            .map(|s| ForwardedSession {
                id: s.id.clone(),
                local_port: s.local_port,
                remote_host: s.remote_host.clone(),
                remote_port: s.remote_port,
                connected: s.connected,
                client_count: s.client_count,
            })
    }
}

/// HTTP endpoint handler for terminal spawn requests
pub async fn handle_terminal_spawn(port: u16, _shell: Option<String>) -> Result<(), String> {
    // Listen for HTTP requests on the specified port
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| format!("Failed to bind spawn listener: {e}"))?;

    info!("Terminal spawn service listening on port {}", port);

    loop {
        let (stream, addr) = listener
            .accept()
            .await
            .map_err(|e| format!("Failed to accept spawn connection: {e}"))?;

        info!("Terminal spawn request from {}", addr);

        // Handle the spawn request
        tokio::spawn(async move {
            if let Err(e) = handle_spawn_request(stream, None).await {
                error!("Error handling spawn request: {}", e);
            }
        });
    }
}

/// Handle a single terminal spawn request
async fn handle_spawn_request(mut stream: TcpStream, _shell: Option<String>) -> Result<(), String> {
    // Simple HTTP response
    let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nTerminal spawned\r\n";
    stream
        .write_all(response)
        .await
        .map_err(|e| format!("Failed to write response: {e}"))?;

    // TODO: Implement actual terminal spawning logic
    // This would integrate with the system's terminal emulator

    Ok(())
}
