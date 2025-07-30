#![deny(clippy::all)]

use crossbeam_channel::{bounded, Receiver, Sender};
use log::{debug, error, info, warn};
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

// Global PTY manager - only holds the global lock when adding/removing sessions
lazy_static::lazy_static! {
  static ref PTY_MANAGER: Arc<Mutex<PtyManager>> = Arc::new(Mutex::new(PtyManager::new()));
}

struct PtyManager {
  // Store Arc references so we can clone them without holding the global lock
  sessions: HashMap<String, Arc<PtySession>>,
}

// All fields that need concurrent access are wrapped in Mutex/RwLock
struct PtySession {
  master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
  writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,
  child: Mutex<Box<dyn portable_pty::Child + Send>>,
  reader_thread: Mutex<Option<JoinHandle<()>>>,
  output_receiver: Receiver<Vec<u8>>,
  shutdown_sender: Sender<()>,
  // Event-driven callback for data
  data_callback: Mutex<Option<Arc<ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal>>>>,
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

    info!(
      "NativePty::new called with shell={:?}, args={:?}",
      shell, args
    );
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
    let child = pty_pair.slave.spawn_command(cmd).map_err(|e| {
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
    let writer = Arc::new(Mutex::new(pty_pair.master.take_writer().map_err(|e| {
      error!("Failed to take writer: {}", e);
      Error::from_reason(format!("Failed to take writer: {e}"))
    })?));
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
          info!(
            "Reader thread received shutdown signal for session {}",
            reader_session_id
          );
          break;
        }

        match reader.read(&mut buffer) {
          Ok(0) => {
            info!("Reader thread EOF for session {}", reader_session_id);
            break; // EOF
          },
          Ok(n) => {
            total_bytes_read += n;
            debug!(
              "Read {} bytes from PTY (total: {} bytes) for session {}",
              n, total_bytes_read, reader_session_id
            );
            let data = buffer[..n].to_vec();

            // Check if we have a callback to call
            // Note: This is called from the reader thread, so we need to get the session
            // Arc from the global manager. In the future, we could pass the Arc to the thread
            // to avoid this lookup entirely.
            let callback = {
              let manager = PTY_MANAGER.lock();
              manager
                .sessions
                .get(&reader_session_id)
                .and_then(|session| {
                  let cb_lock = session.data_callback.lock();
                  cb_lock.clone()
                })
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
        Arc::new(PtySession {
          master: Mutex::new(pty_pair.master),
          writer,
          child: Mutex::new(child),
          reader_thread: Mutex::new(Some(reader_thread)),
          output_receiver,
          shutdown_sender,
          data_callback: Mutex::new(None),
        }),
      );
    }

    info!(
      "NativePty constructor completed successfully for session {}, PID {}",
      session_id, pid
    );
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

    // Get session Arc and release global lock immediately
    let session = {
      let manager = PTY_MANAGER.lock();
      manager.sessions.get(&self.session_id).cloned()
    };

    if let Some(session) = session {
      let mut callback_lock = session.data_callback.lock();
      *callback_lock = Some(tsfn);
    } else {
      return Err(Error::from_reason("Session not found"));
    }

    Ok(())
  }

  #[napi]
  pub fn write(&self, data: Buffer) -> Result<()> {
    use std::io::Write;

    let data_len = data.len();
    info!(
      "write() called for session {} with {data_len} bytes",
      self.session_id
    );

    // Log the actual data for debugging (limit to first 100 bytes)
    let preview = if data.len() <= 100 {
      String::from_utf8_lossy(&data).to_string()
    } else {
      let preview_str = String::from_utf8_lossy(&data[..100]);
      format!(
        "{preview_str}... ({data_len} bytes total)"
      )
    };
    debug!("Write data: {:?}", preview);

    // Get the writer Arc without holding the global lock during I/O
    let writer = {
      let manager = PTY_MANAGER.lock();
      if let Some(session) = manager.sessions.get(&self.session_id) {
        // Clone the Arc so we can release the global lock
        Some(session.writer.clone())
      } else {
        let session_id = &self.session_id;
        error!("Session {session_id} not found in write()");
        return Err(Error::from_reason("Session not found"));
      }
    };

    // Now we can write without holding the global PTY_MANAGER lock
    if let Some(writer) = writer {
      info!("Found session, writing to PTY");
      // Lock only the writer, not the entire PTY manager
      let mut writer_lock = writer.lock();
      writer_lock.write_all(&data).map_err(|e| {
        error!("Write failed: {}", e);
        Error::from_reason(format!("Write failed: {e}"))
      })?;

      writer_lock.flush().map_err(|e| {
        error!("Flush failed: {}", e);
        Error::from_reason(format!("Flush failed: {e}"))
      })?;

      let session_id = &self.session_id;
      info!("Write successful for session {session_id}");
    }

    Ok(())
  }

  #[napi]
  pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
    info!("resize() called for session {} to {}x{}", self.session_id, cols, rows);
    
    // Get session Arc and release global lock immediately
    let session = {
      let manager = PTY_MANAGER.lock();
      manager.sessions.get(&self.session_id).cloned()
    };

    if let Some(session) = session {
      // Lock only the master PTY for resize
      let master_lock = session.master.lock();
      master_lock
        .resize(PtySize {
          rows,
          cols,
          pixel_width: 0,
          pixel_height: 0,
        })
        .map_err(|e| {
          error!("Resize failed: {}", e);
          Error::from_reason(format!("Resize failed: {e}"))
        })?;
      info!("Resize successful for session {}", self.session_id);
    } else {
      error!("Session {} not found in resize()", self.session_id);
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
    info!("kill() called for session {} with signal {:?}", self.session_id, _signal);
    
    // Get session Arc and release global lock immediately
    let session = {
      let manager = PTY_MANAGER.lock();
      manager.sessions.get(&self.session_id).cloned()
    };

    if let Some(_session) = session {
      #[cfg(unix)]
      {
        use nix::sys::signal::{self, Signal};
        use nix::unistd::Pid;

        let signal = match _signal.as_deref() {
          Some("SIGTERM") => Signal::SIGTERM,
          Some("SIGKILL") => Signal::SIGKILL,
          Some("SIGINT") => Signal::SIGINT,
          _ => Signal::SIGTERM,
        };

        info!("Sending signal {:?} to process {} for session {}", signal, self.pid, self.session_id);
        signal::kill(Pid::from_raw(self.pid as i32), signal)
          .map_err(|e| {
            error!("Kill failed: {}", e);
            Error::from_reason(format!("Kill failed: {e}"))
          })?;
      }

      #[cfg(windows)]
      {
        let mut child_lock = _session.child.lock();
        child_lock
          .kill()
          .map_err(|e| {
            error!("Kill failed: {}", e);
            Error::from_reason(format!("Kill failed: {e}"))
          })?;
      }
      
      info!("Kill successful for session {}", self.session_id);
    } else {
      error!("Session {} not found in kill()", self.session_id);
      return Err(Error::from_reason("Session not found"));
    }

    Ok(())
  }

  #[napi]
  pub fn read_output(&self, timeout_ms: Option<u32>) -> Result<Option<Buffer>> {
    debug!("read_output() called for session {} with timeout {:?}ms", self.session_id, timeout_ms);
    
    // Get session Arc and release global lock immediately
    let session = {
      let manager = PTY_MANAGER.lock();
      manager.sessions.get(&self.session_id).cloned()
    };

    if let Some(session) = session {
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
        Ok(data) => {
          debug!("Read {} bytes from output for session {}", data.len(), self.session_id);
          Ok(Some(Buffer::from(data)))
        },
        Err(crossbeam_channel::RecvTimeoutError::Timeout) => Ok(None),
        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
          error!("Reader thread disconnected for session {}", self.session_id);
          Err(Error::from_reason("Reader thread disconnected"))
        },
      }
    } else {
      error!("Session {} not found in read_output()", self.session_id);
      Err(Error::from_reason("Session not found"))
    }
  }

  // Legacy polling method - kept for backwards compatibility
  // New code should use set_on_data for event-driven I/O
  #[napi]
  pub fn read_all_output(&self) -> Result<Option<Buffer>> {
    debug!("read_all_output() called for session {}", self.session_id);
    
    // Get session Arc - use try_lock to avoid blocking
    let session = {
      let manager = match PTY_MANAGER.try_lock() {
        Some(guard) => guard,
        None => {
          debug!("Global lock held, returning None for session {}", self.session_id);
          return Ok(None); // Lock is held, return immediately to avoid blocking
        }
      };
      manager.sessions.get(&self.session_id).cloned()
    };

    if let Some(session) = session {
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
        debug!("Read {} total bytes for session {}", all_data.len(), self.session_id);
        Ok(Some(Buffer::from(all_data)))
      }
    } else {
      error!("Session {} not found in read_all_output()", self.session_id);
      Err(Error::from_reason("Session not found"))
    }
  }

  #[napi]
  pub fn check_exit_status(&self) -> Result<Option<i32>> {
    debug!("check_exit_status() called for session {}", self.session_id);
    
    // Get session Arc and release global lock immediately
    let session = {
      let manager = PTY_MANAGER.lock();
      manager.sessions.get(&self.session_id).cloned()
    };

    if let Some(session) = session {
      // Lock only the child process
      let mut child_lock = session.child.lock();
      // Try to get exit status without blocking
      match child_lock.try_wait() {
        Ok(Some(status)) => {
          // Process has exited
          let exit_code = status.exit_code() as i32;
          info!("Process exited with code {} for session {}", exit_code, self.session_id);
          Ok(Some(exit_code))
        },
        Ok(None) => {
          // Process is still running
          debug!("Process still running for session {}", self.session_id);
          Ok(None)
        },
        Err(e) => {
          error!("Failed to check exit status: {}", e);
          Err(Error::from_reason(format!(
            "Failed to check exit status: {e}"
          )))
        }
      }
    } else {
      error!("Session {} not found in check_exit_status()", self.session_id);
      Err(Error::from_reason("Session not found"))
    }
  }

  #[napi]
  pub fn destroy(&self) -> Result<()> {
    info!("destroy() called for session {}", self.session_id);
    
    // Remove session from manager and get the Arc
    let session = {
      let mut manager = PTY_MANAGER.lock();
      manager.sessions.remove(&self.session_id)
    };

    if let Some(session) = session {
      // Send shutdown signal to reader thread
      let _ = session.shutdown_sender.send(());
      info!("Sent shutdown signal to reader thread for session {}", self.session_id);

      // Check if process is still running before trying to kill
      {
        let mut child_lock = session.child.lock();
        match child_lock.try_wait() {
          Ok(Some(_)) => {
            // Process already exited, nothing to do
            info!("Process already exited for session {}", self.session_id);
          },
          Ok(None) => {
            // Process still running, kill it
            info!("Killing process for session {}", self.session_id);
            if let Err(e) = child_lock.kill() {
              error!("Failed to kill child process: {}", e);
            }
          },
          Err(e) => {
            error!("Failed to check process status: {}", e);
          },
        }

        // Wait for the child to fully exit
        let _ = child_lock.wait();
      }

      // Wait for reader thread to finish
      {
        let mut thread_lock = session.reader_thread.lock();
        if let Some(thread) = thread_lock.take() {
          info!("Waiting for reader thread to finish for session {}", self.session_id);
          let _ = thread.join();
        }
      }

      info!("Session {} destroyed successfully", self.session_id);
    } else {
      warn!("Session {} not found in destroy()", self.session_id);
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
