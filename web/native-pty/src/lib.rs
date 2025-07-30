#![deny(clippy::all)]

use crossbeam_channel::{bounded, Receiver, Sender};
use napi::bindgen_prelude::*;
use napi::{
  threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
  JsFunction,
};
use napi_derive::napi;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use log::{debug, error, info, warn};

// Initialize logging once
#[cfg(target_os = "macos")]
lazy_static::lazy_static! {
  static ref LOGGER_INIT: () = {
    use oslog::OsLogger;
    use log::LevelFilter;
    
    // Initialize the macOS logger with VibeTunnel's subsystem
    // This will make logs appear in Console.app and be visible to vtlog
    if let Err(e) = OsLogger::new("sh.vibetunnel.rust-pty")
      .level_filter(LevelFilter::Debug)
      .init() {
      eprintln!("Failed to initialize oslog: {}", e);
    }
  };
}

// For non-macOS platforms, use env_logger
#[cfg(not(target_os = "macos"))]
lazy_static::lazy_static! {
  static ref LOGGER_INIT: () = {
    env_logger::init();
  };
}

#[napi]
pub struct NativePty {
  session_id: String,
  pid: u32,
  #[allow(dead_code)]
  cols: u16,
  #[allow(dead_code)]
  rows: u16,
}

// Global PTY manager
lazy_static::lazy_static! {
  static ref PTY_MANAGER: Arc<Mutex<PtyManager>> = Arc::new(Mutex::new(PtyManager::new()));
}

struct PtyManager {
  sessions: HashMap<String, PtySession>,
}

struct PtySession {
  master: Box<dyn portable_pty::MasterPty + Send>,
  writer: Box<dyn std::io::Write + Send>,
  child: Box<dyn portable_pty::Child + Send>,
  reader_thread: Option<JoinHandle<()>>,
  output_receiver: Receiver<Vec<u8>>,
  shutdown_sender: Sender<()>,
  // Event-driven callback for data
  data_callback: Option<Arc<ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal>>>,
}

impl PtyManager {
  fn new() -> Self {
    Self {
      sessions: HashMap::new(),
    }
  }
}

#[napi]
impl NativePty {
  #[napi(constructor)]
  pub fn new(
    shell: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
  ) -> Result<Self> {
    // Ensure logger is initialized
    lazy_static::initialize(&LOGGER_INIT);
    
    info!("NativePty::new called with shell={:?}, args={:?}", shell, args);
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    info!("Creating native PTY system...");
    let pty_system = native_pty_system();

    info!("Opening PTY with size {}x{}", cols, rows);
    let pty_pair = pty_system
      .openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
      })
      .map_err(|e| {
        error!("Failed to open PTY: {}", e);
        Error::from_reason(format!("Failed to open PTY: {e}"))
      })?;
    info!("PTY opened successfully");

    let default_shell = if cfg!(windows) {
      "cmd.exe"
    } else {
      "/bin/bash"
    };
    let mut cmd = CommandBuilder::new(shell.as_deref().unwrap_or(default_shell));

    if let Some(args) = args {
      cmd.args(args);
    }

    if let Some(cwd) = cwd {
      cmd.cwd(cwd);
    }

    if let Some(env) = env {
      for (key, value) in env {
        cmd.env(key, value);
      }
    }

    info!("Spawning command...");
    let child = pty_pair
      .slave
      .spawn_command(cmd)
      .map_err(|e| {
        error!("Failed to spawn command: {}", e);
        Error::from_reason(format!("Failed to spawn: {e}"))
      })?;
    info!("Command spawned successfully");

    let pid = child
      .process_id()
      .ok_or_else(|| Error::from_reason("Failed to get PID"))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    info!("Created session ID: {}", session_id);

    // Take the writer once and store it
    info!("Taking writer from master PTY...");
    let writer = pty_pair
      .master
      .take_writer()
      .map_err(|e| {
        error!("Failed to take writer: {}", e);
        Error::from_reason(format!("Failed to take writer: {e}"))
      })?;
    info!("Writer obtained successfully");

    // Create channels for output and shutdown
    let (output_sender, output_receiver) = bounded::<Vec<u8>>(100); // Bounded channel for backpressure
    let (shutdown_sender, shutdown_receiver) = bounded::<()>(1);

    // Clone reader for the thread
    let mut reader = pty_pair
      .master
      .try_clone_reader()
      .map_err(|e| Error::from_reason(format!("Failed to clone reader: {e}")))?;

    // Store session ID for reader thread
    let reader_session_id = session_id.clone();

    // Spawn reader thread
    info!("Spawning reader thread for session {}", reader_session_id);
    let reader_thread = thread::spawn(move || {
      info!("Reader thread started for session {}", reader_session_id);
      let mut buffer = vec![0u8; 4096];
      let mut total_bytes_read = 0usize;
      loop {
        // Check for shutdown signal
        if shutdown_receiver.try_recv().is_ok() {
          info!("Reader thread received shutdown signal for session {}", reader_session_id);
          break;
        }

        match reader.read(&mut buffer) {
          Ok(0) => {
            info!("Reader thread EOF for session {}", reader_session_id);
            break; // EOF
          },
          Ok(n) => {
            total_bytes_read += n;
            debug!("Read {} bytes from PTY (total: {} bytes) for session {}", n, total_bytes_read, reader_session_id);
            let data = buffer[..n].to_vec();

            // Check if we have a callback to call
            let callback = {
              let manager = PTY_MANAGER.lock();
              manager
                .sessions
                .get(&reader_session_id)
                .and_then(|session| session.data_callback.clone())
            };

            // If callback exists, call it directly from this thread
            if let Some(tsfn) = callback {
              let data_clone = data.clone();
              let _ = tsfn.call(data_clone, ThreadsafeFunctionCallMode::NonBlocking);
            }

            // Also send to channel for polling-based consumers
            match output_sender.try_send(data) {
              Ok(_) => {},
              Err(crossbeam_channel::TrySendError::Full(_)) => {
                // Channel is full, skip this data to prevent blocking
                eprintln!("PTY output buffer full, dropping data");
              },
              Err(crossbeam_channel::TrySendError::Disconnected(_)) => break,
            }
          },
          Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            // No data available, sleep briefly
            thread::sleep(Duration::from_millis(1));
          },
          Err(_) => break,
        }
      }
    });

    // Store in global manager
    info!("Storing session {} in global PTY manager", session_id);
    {
      let mut manager = PTY_MANAGER.lock();
      manager.sessions.insert(
        session_id.clone(),
        PtySession {
          master: pty_pair.master,
          writer,
          child,
          reader_thread: Some(reader_thread),
          output_receiver,
          shutdown_sender,
          data_callback: None,
        },
      );
    }

    info!("NativePty constructor completed successfully for session {}, PID {}", session_id, pid);
    Ok(Self {
      session_id,
      pid: pid as u32,
      cols,
      rows,
    })
  }

  #[napi]
  pub fn set_on_data(&self, callback: JsFunction) -> Result<()> {
    // Create a ThreadsafeFunction from the callback
    let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> = callback
      .create_threadsafe_function(0, |ctx| {
        // Convert Vec<u8> to Buffer for JavaScript
        ctx
          .env
          .create_buffer_with_data(ctx.value)
          .map(|buffer| vec![buffer.into_raw()])
      })?;

    let tsfn = Arc::new(tsfn);

    // Store the callback - the reader thread will call it directly
    let mut manager = PTY_MANAGER.lock();
    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      session.data_callback = Some(tsfn);
    } else {
      return Err(Error::from_reason("Session not found"));
    }

    Ok(())
  }

  #[napi]
  pub fn write(&self, data: Buffer) -> Result<()> {
    use std::io::Write;

    info!("write() called for session {} with {} bytes", self.session_id, data.len());
    
    // Log the actual data for debugging (limit to first 100 bytes)
    let preview = if data.len() <= 100 {
      String::from_utf8_lossy(&data).to_string()
    } else {
      format!("{}... ({} bytes total)", String::from_utf8_lossy(&data[..100]), data.len())
    };
    debug!("Write data: {:?}", preview);

    let mut manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      info!("Found session, writing to PTY");
      // Use the stored writer - no need to take it
      session
        .writer
        .write_all(&data)
        .map_err(|e| {
          error!("Write failed: {}", e);
          Error::from_reason(format!("Write failed: {e}"))
        })?;

      session
        .writer
        .flush()
        .map_err(|e| {
          error!("Flush failed: {}", e);
          Error::from_reason(format!("Flush failed: {e}"))
        })?;
      
      info!("Write successful for session {}", self.session_id);
    } else {
      error!("Session {} not found in write()", self.session_id);
      return Err(Error::from_reason("Session not found"));
    }

    Ok(())
  }

  #[napi]
  pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
    let mut manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      session
        .master
        .resize(PtySize {
          rows,
          cols,
          pixel_width: 0,
          pixel_height: 0,
        })
        .map_err(|e| Error::from_reason(format!("Resize failed: {e}")))?;
    } else {
      return Err(Error::from_reason("Session not found"));
    }

    Ok(())
  }

  #[napi]
  pub fn get_pid(&self) -> u32 {
    self.pid
  }

  #[napi]
  pub fn kill(&self, _signal: Option<String>) -> Result<()> {
    let mut manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      #[cfg(unix)]
      {
        let _ = session; // Prevent unused variable warning
        use nix::sys::signal::{self, Signal};
        use nix::unistd::Pid;

        let signal = match _signal.as_deref() {
          Some("SIGTERM") => Signal::SIGTERM,
          Some("SIGKILL") => Signal::SIGKILL,
          Some("SIGINT") => Signal::SIGINT,
          _ => Signal::SIGTERM,
        };

        signal::kill(Pid::from_raw(self.pid as i32), signal)
          .map_err(|e| Error::from_reason(format!("Kill failed: {e}")))?;
      }

      #[cfg(windows)]
      {
        session
          .child
          .kill()
          .map_err(|e| Error::from_reason(format!("Kill failed: {e}")))?;
      }
    }

    Ok(())
  }

  #[napi]
  pub fn read_output(&self, timeout_ms: Option<u32>) -> Result<Option<Buffer>> {
    let manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get(&self.session_id) {
      // Try to receive from the channel
      let result = if let Some(timeout) = timeout_ms {
        // With timeout
        session
          .output_receiver
          .recv_timeout(Duration::from_millis(timeout as u64))
      } else {
        // Non-blocking
        match session.output_receiver.try_recv() {
          Ok(data) => Ok(data),
          Err(crossbeam_channel::TryRecvError::Empty) => return Ok(None),
          Err(crossbeam_channel::TryRecvError::Disconnected) => {
            return Err(Error::from_reason("Reader thread disconnected"))
          },
        }
      };

      match result {
        Ok(data) => Ok(Some(Buffer::from(data))),
        Err(crossbeam_channel::RecvTimeoutError::Timeout) => Ok(None),
        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
          Err(Error::from_reason("Reader thread disconnected"))
        },
      }
    } else {
      Err(Error::from_reason("Session not found"))
    }
  }

  // Legacy polling method - kept for backwards compatibility
  // New code should use set_on_data for event-driven I/O
  #[napi]
  pub fn read_all_output(&self) -> Result<Option<Buffer>> {
    // Use try_lock to avoid blocking - if we can't get the lock immediately, return None
    let manager = match PTY_MANAGER.try_lock() {
      Some(guard) => guard,
      None => return Ok(None), // Lock is held, return immediately to avoid blocking
    };

    if let Some(session) = manager.sessions.get(&self.session_id) {
      let mut all_data = Vec::new();
      let mut bytes_read = 0;
      const MAX_BYTES_PER_CALL: usize = 65536; // 64KB limit per call

      // Read available data with a limit to prevent blocking too long
      while bytes_read < MAX_BYTES_PER_CALL {
        match session.output_receiver.try_recv() {
          Ok(data) => {
            bytes_read += data.len();
            all_data.extend_from_slice(&data);
          },
          Err(_) => break, // No more data available
        }
      }

      if all_data.is_empty() {
        Ok(None)
      } else {
        Ok(Some(Buffer::from(all_data)))
      }
    } else {
      Err(Error::from_reason("Session not found"))
    }
  }

  #[napi]
  pub fn check_exit_status(&self) -> Result<Option<i32>> {
    let mut manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      // Try to get exit status without blocking
      match session.child.try_wait() {
        Ok(Some(status)) => {
          // Process has exited
          let exit_code = status.exit_code() as i32;
          Ok(Some(exit_code))
        },
        Ok(None) => {
          // Process is still running
          Ok(None)
        },
        Err(e) => Err(Error::from_reason(format!(
          "Failed to check exit status: {e}"
        ))),
      }
    } else {
      Err(Error::from_reason("Session not found"))
    }
  }

  #[napi]
  pub fn destroy(&self) -> Result<()> {
    let mut manager = PTY_MANAGER.lock();

    // Remove session from manager
    if let Some(mut session) = manager.sessions.remove(&self.session_id) {
      // Send shutdown signal to reader thread
      let _ = session.shutdown_sender.send(());

      // Check if process is still running before trying to kill
      match session.child.try_wait() {
        Ok(Some(_)) => {
          // Process already exited, nothing to do
        },
        Ok(None) => {
          // Process still running, kill it
          if let Err(e) = session.child.kill() {
            eprintln!("Failed to kill child process: {e}");
          }
        },
        Err(e) => {
          eprintln!("Failed to check process status: {e}");
        },
      }

      // Wait for the child to fully exit
      let _ = session.child.wait();

      // Wait for reader thread to finish
      if let Some(thread) = session.reader_thread {
        let _ = thread.join();
      }

      // The session will be dropped here, cleaning up all resources
    }

    Ok(())
  }
}

// Initialize PTY system (no-op for now, but required for compatibility)
#[napi]
pub fn init_pty_system() -> Result<()> {
  // Ensure logger is initialized
  lazy_static::initialize(&LOGGER_INIT);
  
  info!("init_pty_system called");
  // No initialization needed for portable-pty
  Ok(())
}

// Activity detection for Claude CLI
#[napi]
pub struct ActivityDetector {
  claude_pattern: regex::Regex,
  ansi_pattern: regex::Regex,
}

#[napi]
impl ActivityDetector {
  #[napi(constructor)]
  pub fn new() -> Result<Self> {
    // Match Claude status lines:
    // Format 1: ✻ Crafting… (205s · ↑ 6.0k tokens · <any text> to interrupt)
    // Format 2: ✻ Measuring… (6s ·  100 tokens · esc to interrupt)
    // Format 3: ⏺ Calculating… (0s) - simpler format without tokens/interrupt
    // Format 4: ✳ Measuring… (120s · ⚒ 671 tokens · esc to interrupt) - with hammer symbol
    // Note: We match ANY non-whitespace character as the indicator since Claude uses many symbols
    Ok(Self {
      claude_pattern: regex::Regex::new(r"(\S)\s+(\w+)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+)\s*k?\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)")
        .map_err(|e| Error::from_reason(format!("Regex error: {e}")))?,
      ansi_pattern: regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]")
        .map_err(|e| Error::from_reason(format!("ANSI regex error: {e}")))?,
    })
  }

  #[napi]
  pub fn detect(&self, data: Buffer) -> Option<Activity> {
    let text = String::from_utf8_lossy(&data);

    // Strip ANSI escape codes for cleaner matching (same as TypeScript version)
    let clean_text = self.ansi_pattern.replace_all(&text, "");

    if let Some(captures) = self.claude_pattern.captures(&clean_text) {
      // Extract captures: indicator, action, duration, direction (optional), tokens (optional)
      let indicator = captures.get(1)?.as_str();
      let action = captures.get(2)?.as_str();
      let duration = captures.get(3)?.as_str();
      let direction = captures.get(4).map(|m| m.as_str());
      let tokens = captures.get(5).map(|m| m.as_str());

      // Format the status string similar to TypeScript version
      let status = action.to_string();

      // Format details based on whether we have token information
      let details = if let (Some(dir), Some(tok)) = (direction, tokens) {
        Some(format!("{duration}s, {dir}{tok}k"))
      } else {
        Some(format!("{duration}s"))
      };

      return Some(Activity {
        timestamp: chrono::Utc::now().timestamp_millis() as f64,
        status: format!("{indicator} {status}"),
        details,
      });
    }

    None
  }
}

#[napi(object)]
pub struct Activity {
  pub timestamp: f64,
  pub status: String,
  pub details: Option<String>,
}

#[cfg(test)]
mod tests {
  // Test only the pure Rust parts that don't require NAPI
  #[test]
  fn test_activity_detector_regex() {
    // Test regex creation
    let claude_pattern = regex::Regex::new(r"(\S)\s+(\w+)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+)\s*k?\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)").unwrap();
    let ansi_pattern = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();

    // Test pattern matching
    let text = "✻ Crafting… (10s)";
    assert!(claude_pattern.is_match(text));

    // Test ANSI stripping
    let ansi_text = "\x1b[32mHello\x1b[0m";
    let clean = ansi_pattern.replace_all(ansi_text, "");
    assert_eq!(clean, "Hello");
  }

  #[test]
  fn test_activity_pattern_variations() {
    let pattern = regex::Regex::new(r"(\S)\s+(\w+)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+)\s*k?\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)").unwrap();

    let test_cases = vec![
      ("✻ Crafting… (10s)", true),
      ("⏺ Calculating… (0s)", true),
      (
        "✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)",
        true,
      ),
      ("Normal text", false),
      ("✻ Missing ellipsis (10s)", false),
    ];

    for (text, should_match) in test_cases {
      assert_eq!(
        pattern.is_match(text),
        should_match,
        "Pattern match failed for: {}",
        text
      );
    }
  }

  #[test]
  fn test_session_id_generation() {
    // Test that we can generate UUIDs
    let id1 = uuid::Uuid::new_v4().to_string();
    let id2 = uuid::Uuid::new_v4().to_string();

    // Should be valid UUIDs
    assert_eq!(id1.len(), 36);
    assert_eq!(id2.len(), 36);

    // Should be different
    assert_ne!(id1, id2);
  }

  #[test]
  fn test_buffer_creation() {
    // Test that we can create buffers
    let data = [0x48, 0x65, 0x6C, 0x6C, 0x6F]; // "Hello"
    assert_eq!(data.len(), 5);
    assert_eq!(data[0], 0x48);
  }
}
