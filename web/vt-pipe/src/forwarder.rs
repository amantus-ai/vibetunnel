use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
  session::{Session, SessionInfo},
  socket_client::SocketClient,
  terminal::Terminal,
  TitleMode,
};

/// Connect to socket with retry logic
async fn connect_with_retry(
  socket_path: &std::path::Path,
  max_retries: u32,
  delay_ms: u64,
) -> Result<SocketClient> {
  let mut last_error = None;
  
  for attempt in 0..max_retries {
    match SocketClient::connect(socket_path).await {
      Ok(client) => return Ok(client),
      Err(e) => {
        last_error = Some(e);
        if attempt < max_retries - 1 {
          tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        }
      },
    }
  }
  
  Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to connect after {} attempts", max_retries)))
}

pub struct Forwarder {
  title_mode: TitleMode,
  session_id: String,
  terminal: Terminal,
}

impl Forwarder {
  pub fn new(title_mode: TitleMode) -> Result<Self> {
    let session_id = Uuid::new_v4().to_string();
    let terminal = Terminal::new()?;

    Ok(Self {
      title_mode,
      session_id,
      terminal,
    })
  }

  pub async fn run(&mut self, command: Vec<String>) -> Result<()> {
    // Setup signal handlers
    let shutdown = Arc::new(Mutex::new(false));
    self.setup_signal_handlers(shutdown.clone());

    // Get current terminal size
    let (cols, rows) = self.terminal.size()?;

    // Create PTY
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
      .openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
      })
      .context("Failed to open PTY")?;

    // Build command
    let mut cmd = CommandBuilder::new(&command[0]);
    for arg in &command[1..] {
      cmd.arg(arg);
    }

    // Set environment
    cmd.env(
      "TERM",
      std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string()),
    );

    // Get working directory
    let cwd = std::env::current_dir()?;
    cmd.cwd(&cwd);

    // Spawn process
    let child = pair
      .slave
      .spawn_command(cmd)
      .context("Failed to spawn command")?;

    let pid = child.process_id().unwrap_or(0) as i32;

    // Create session
    let session_info = SessionInfo {
      id: self.session_id.clone(),
      name: command.join(" "),
      command: command.clone(),
      pid: Some(pid as u32),
      created_at: chrono::Utc::now(),
      status: "running".to_string(),
      working_dir: cwd.to_string_lossy().to_string(),
      cols,
      rows,
      exit_code: None,
      title_mode: Some(format!("{:?}", self.title_mode).to_lowercase()),
      is_external_terminal: true,
    };

    let session = Session::create(session_info)?;

    // Set environment variable for nested sessions
    std::env::set_var("VIBETUNNEL_SESSION_ID", &self.session_id);

    // Connect to Unix socket with retry logic
    let socket_path = session.socket_path();

    let socket_client = connect_with_retry(&socket_path, 10, 100)
      .await
      .context(format!(
        "Failed to connect to VibeTunnel server socket at {:?}. \
         Is VibeTunnel running? Try launching it first.",
        socket_path
      ))?;

    // Enter raw mode
    self.terminal.enter_raw_mode()?;

    // Get writer and reader from master
    let writer = pair
      .master
      .take_writer()
      .context("Failed to take PTY writer")?;
    let reader = pair
      .master
      .try_clone_reader()
      .context("Failed to clone PTY reader")?;

    // Forward I/O
    let result = self
      .forward_io(writer, reader, pair.master, Some(socket_client), shutdown, child)
      .await;

    // Restore terminal
    self.terminal.leave_raw_mode()?;

    // Clean up session
    session.cleanup()?;

    result
  }

  async fn forward_io(
    &mut self,
    writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
    master: Box<dyn MasterPty + Send>,
    socket_client: Option<SocketClient>,
    shutdown: Arc<Mutex<bool>>,
    child: Box<dyn portable_pty::Child + Send>,
  ) -> Result<()> {
    let writer = Arc::new(Mutex::new(writer));
    let reader = Arc::new(Mutex::new(reader));
    let master = Arc::new(Mutex::new(master));
    let socket_client = Arc::new(Mutex::new(socket_client));

    // Spawn tasks for I/O forwarding
    let stdin_task = self.forward_stdin(writer.clone(), socket_client.clone(), shutdown.clone());
    let stdout_task = self.forward_stdout(reader.clone(), socket_client.clone(), shutdown.clone());
    let resize_task = self.handle_resize(master.clone(), socket_client.clone(), shutdown.clone());

    // Wait for any task to complete
    tokio::select! {
        result = stdin_task => result?,
        result = stdout_task => result?,
        result = resize_task => result?,
    }

    // Wait for child to exit
    drop(child);

    Ok(())
  }

  async fn forward_stdin(
    &self,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
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
                  let mut writer = writer_clone.blocking_lock();
                  writer.write_all(&data_clone)
              }).await??;

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
    reader: Arc<Mutex<Box<dyn Read + Send>>>,
    socket_client: Arc<Mutex<Option<SocketClient>>>,
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
        let mut reader = reader_clone.blocking_lock();
        match reader.read(&mut buffer) {
          Ok(0) => Ok(None), // EOF
          Ok(n) => {
            buffer.truncate(n);
            Ok(Some(buffer))
          },
          Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(Some(vec![])),
          Err(e) => Err(e),
        }
      })
      .await?;

      match read_result? {
        None => break, // EOF
        Some(data) if data.is_empty() => {
          // No data available, sleep briefly
          tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
          continue;
        },
        Some(data) => {
          // Write to stdout for local display
          stdout.write_all(&data).await?;
          stdout.flush().await?;

          // CRITICAL: Forward to socket so it appears in the web UI
          if let Some(client) = &mut *socket_client.lock().await {
            client.send_stdout(&data).await?;
          }
        },
      }
    }

    Ok(())
  }

  async fn handle_resize(
    &self,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
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
                  let master = master.lock().await;
                  master.resize(PtySize {
                      rows,
                      cols,
                      pixel_width: 0,
                      pixel_height: 0,
                  })?;
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
    // Signal handler setup for Ctrl-C

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
