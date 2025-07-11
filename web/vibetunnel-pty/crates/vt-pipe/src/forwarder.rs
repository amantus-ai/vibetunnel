#![allow(clippy::incompatible_msrv)]

use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::{session_store::FileSessionStore, socket_client::SocketClient, terminal::Terminal};
use vibetunnel_pty_core::pty::{create_pty, resize_pty};
use vibetunnel_pty_core::PtyHandle;
use vibetunnel_pty_core::{PtyConfig, SessionInfo, SessionStore};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleMode {
    None,
    Filter,
    Static,
    Dynamic,
}

pub struct Forwarder {
    title_mode: TitleMode,
    session_id: String,
    terminal: Terminal,
}

impl Forwarder {
    #[allow(dead_code)]
    pub fn title_mode(&self) -> TitleMode {
        self.title_mode
    }

    #[allow(dead_code)]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl Forwarder {
    pub fn new(title_mode: TitleMode) -> Result<Self> {
        let session_id = Uuid::new_v4().to_string();
        let terminal = Terminal::new()?;

        Ok(Self { title_mode, session_id, terminal })
    }

    pub async fn run(&mut self, command: Vec<String>) -> Result<()> {
        // Setup signal handlers
        let shutdown = Arc::new(Mutex::new(false));
        self.setup_signal_handlers(shutdown.clone());

        // Get current terminal size
        let (cols, rows) = self.terminal.size()?;

        // Create PTY configuration
        let cwd = std::env::current_dir()?;
        let mut config = PtyConfig {
            shell: Some(command[0].clone()),
            args: command[1..].to_vec(),
            cols,
            rows,
            cwd: Some(cwd.clone()),
            ..Default::default()
        };

        // Set environment
        config.env.insert(
            "TERM".to_string(),
            std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string()),
        );

        // Create PTY
        let mut handle = create_pty(&config)?;
        let pid = handle.pid;

        // Create session info
        let session_info = SessionInfo {
            id: self.session_id.clone(),
            name: command.join(" "),
            command: command.clone(),
            pid: Some(pid),
            created_at: chrono::Utc::now(),
            status: "running".to_string(),
            working_dir: cwd.to_string_lossy().to_string(),
            cols,
            rows,
            exit_code: None,
            title_mode: Some(format!("{:?}", self.title_mode).to_lowercase()),
            is_external_terminal: true,
        };

        // Create file-based session store
        let mut store = FileSessionStore::new(&self.session_id)?;
        store.create_session(session_info.clone())?;

        // Set environment variable for nested sessions
        std::env::set_var("VIBETUNNEL_SESSION_ID", &self.session_id);

        // Connect to Unix socket
        let socket_path = store.socket_path();
        let socket_client = match SocketClient::connect_with_retry(&socket_path, 10, 100).await {
            Ok(client) => Some(client),
            Err(e) => {
                eprintln!("Warning: Failed to connect to socket: {}", e);
                None
            }
        };

        // Enter raw mode
        self.terminal.enter_raw_mode()?;

        // Forward I/O
        let result = self.forward_io(&mut handle, socket_client, shutdown).await;

        // Restore terminal
        self.terminal.leave_raw_mode()?;

        // Update session status
        let mut final_info = session_info.clone();
        final_info.status = "exited".to_string();
        store.update_session(&self.session_id, final_info)?;

        result
    }

    async fn forward_io(
        &mut self,
        handle: &mut PtyHandle,
        socket_client: Option<SocketClient>,
        shutdown: Arc<Mutex<bool>>,
    ) -> Result<()> {
        let socket_client = Arc::new(Mutex::new(socket_client));

        // Convert to Arc<Mutex> for sharing between tasks
        let writer = Arc::new(Mutex::new(None));
        let reader = Arc::new(Mutex::new(None));
        let master = Arc::new(Mutex::new(None));

        // Take ownership and store in Arc<Mutex>
        {
            let mut w = writer.lock().await;
            *w = Some(std::mem::replace(
                &mut handle.writer,
                Box::new(std::io::sink()) as Box<dyn std::io::Write + Send>,
            ));

            let mut r = reader.lock().await;
            *r = Some(std::mem::replace(
                &mut handle.reader,
                Box::new(std::io::empty()) as Box<dyn std::io::Read + Send>,
            ));

            let mut m = master.lock().await;
            *m = Some(std::mem::replace(
                &mut handle.master,
                Box::new(DummyMaster) as Box<dyn portable_pty::MasterPty + Send>,
            ));
        }

        // Spawn tasks for I/O forwarding
        let stdin_task =
            self.forward_stdin(writer.clone(), socket_client.clone(), shutdown.clone());
        let stdout_task =
            self.forward_stdout(reader.clone(), socket_client.clone(), shutdown.clone());
        let resize_task =
            self.handle_resize(master.clone(), socket_client.clone(), shutdown.clone());

        // Wait for any task to complete
        tokio::select! {
            result = stdin_task => result?,
            result = stdout_task => result?,
            result = resize_task => result?,
        }

        Ok(())
    }

    async fn forward_stdin(
        &self,
        writer: Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
        socket_client: Arc<Mutex<Option<SocketClient>>>,
        shutdown: Arc<Mutex<bool>>,
    ) -> Result<()> {
        use tokio::task;

        let mut stdin = tokio::io::stdin();
        let mut buffer = [0u8; 4096];

        loop {
            tokio::select! {
                result = stdin.read(&mut buffer) => {
                    let n = result?;
                    if n == 0 {
                        break;
                    }

                    let data = buffer[..n].to_vec();

                    // Write to PTY in blocking context
                    let writer_clone = writer.clone();
                    let data_clone = data.clone();
                    task::spawn_blocking(move || {
                        let mut writer_lock = writer_clone.blocking_lock();
                        if let Some(w) = writer_lock.as_mut() {
                            let _ = w.write_all(&data_clone);
                        }
                    }).await?;

                    // Forward to socket if connected
                    if let Some(client) = &mut *socket_client.lock().await {
                        client.send_stdin(&data).await?;
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
                    if *shutdown.lock().await {
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    async fn forward_stdout(
        &self,
        reader: Arc<Mutex<Option<Box<dyn std::io::Read + Send>>>>,
        _socket_client: Arc<Mutex<Option<SocketClient>>>,
        shutdown: Arc<Mutex<bool>>,
    ) -> Result<()> {
        use tokio::task;

        let mut stdout = tokio::io::stdout();

        loop {
            if *shutdown.lock().await {
                break;
            }

            // Read from PTY in blocking context
            let reader_clone = reader.clone();
            let read_result = task::spawn_blocking(move || {
                let mut buffer = vec![0u8; 4096];
                let mut reader_lock = reader_clone.blocking_lock();
                if let Some(r) = reader_lock.as_mut() {
                    match r.read(&mut buffer) {
                        Ok(0) => Ok(None), // EOF
                        Ok(n) => {
                            buffer.truncate(n);
                            Ok(Some(buffer))
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(Some(vec![])),
                        Err(e) => Err(e),
                    }
                } else {
                    Ok(None)
                }
            })
            .await?;

            match read_result? {
                None => break, // EOF
                Some(data) if data.is_empty() => {
                    // No data available, sleep briefly
                    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                    continue;
                }
                Some(data) => {
                    // Write to stdout
                    stdout.write_all(&data).await?;
                    stdout.flush().await?;
                }
            }
        }

        Ok(())
    }

    async fn handle_resize(
        &self,
        master: Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
        socket_client: Arc<Mutex<Option<SocketClient>>>,
        shutdown: Arc<Mutex<bool>>,
    ) -> Result<()> {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigwinch = signal(SignalKind::window_change())?;

        loop {
            tokio::select! {
                _ = sigwinch.recv() => {
                    // Get new terminal size
                    let (cols, rows) = self.terminal.size()?;

                    // Resize PTY
                    {
                        let master_lock = master.lock().await;
                        if let Some(m) = master_lock.as_ref() {
                            resize_pty(m.as_ref(), cols, rows)?;
                        }
                    }

                    // Send resize command to socket
                    if let Some(client) = &mut *socket_client.lock().await {
                        client.send_resize(cols, rows).await?;
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
                    if *shutdown.lock().await {
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    fn setup_signal_handlers(&self, shutdown: Arc<Mutex<bool>>) {
        let shutdown_clone = shutdown.clone();
        ctrlc::set_handler(move || {
            let shutdown = shutdown_clone.clone();
            tokio::spawn(async move {
                *shutdown.lock().await = true;
            });
        })
        .expect("Failed to set Ctrl-C handler");
    }
}

// Dummy implementation for the master type replacement
struct DummyMaster;

impl portable_pty::MasterPty for DummyMaster {
    fn resize(&self, _size: portable_pty::PtySize) -> anyhow::Result<()> {
        Ok(())
    }

    fn get_size(&self) -> anyhow::Result<portable_pty::PtySize> {
        Ok(portable_pty::PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
    }

    fn try_clone_reader(&self) -> anyhow::Result<Box<dyn std::io::Read + Send>> {
        Ok(Box::new(std::io::empty()))
    }

    fn take_writer(&self) -> anyhow::Result<Box<dyn std::io::Write + Send>> {
        Ok(Box::new(std::io::sink()))
    }

    fn process_group_leader(&self) -> Option<i32> {
        None
    }

    fn as_raw_fd(&self) -> Option<std::os::fd::RawFd> {
        None
    }
}
