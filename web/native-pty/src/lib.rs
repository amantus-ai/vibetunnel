#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use crossbeam_channel::{bounded, Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::io::Read;
use std::time::Duration;

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
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    let pty_system = native_pty_system();

    let pty_pair = pty_system
      .openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
      })
      .map_err(|e| Error::from_reason(format!("Failed to open PTY: {}", e)))?;

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

    let child = pty_pair
      .slave
      .spawn_command(cmd)
      .map_err(|e| Error::from_reason(format!("Failed to spawn: {}", e)))?;

    let pid = child
      .process_id()
      .ok_or_else(|| Error::from_reason("Failed to get PID"))?;

    let session_id = uuid::Uuid::new_v4().to_string();

    // Take the writer once and store it
    let writer = pty_pair
      .master
      .take_writer()
      .map_err(|e| Error::from_reason(format!("Failed to take writer: {}", e)))?;

    // Create channels for output and shutdown
    let (output_sender, output_receiver) = bounded::<Vec<u8>>(100); // Bounded channel for backpressure
    let (shutdown_sender, shutdown_receiver) = bounded::<()>(1);

    // Clone reader for the thread
    let mut reader = pty_pair
      .master
      .try_clone_reader()
      .map_err(|e| Error::from_reason(format!("Failed to clone reader: {}", e)))?;

    // Spawn reader thread
    let reader_thread = thread::spawn(move || {
      let mut buffer = vec![0u8; 4096];
      loop {
        // Check for shutdown signal
        if shutdown_receiver.try_recv().is_ok() {
          break;
        }

        match reader.read(&mut buffer) {
          Ok(0) => break, // EOF
          Ok(n) => {
            let data = buffer[..n].to_vec();
            // Try to send, but don't block if channel is full (backpressure)
            match output_sender.try_send(data) {
              Ok(_) => {},
              Err(crossbeam_channel::TrySendError::Full(_)) => {
                // Channel is full, skip this data to prevent blocking
                eprintln!("PTY output buffer full, dropping data");
              },
              Err(crossbeam_channel::TrySendError::Disconnected(_)) => break,
            }
          }
          Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            // No data available, sleep briefly
            thread::sleep(Duration::from_millis(1));
          }
          Err(_) => break,
        }
      }
    });

    // Store in global manager
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
        },
      );
    }

    Ok(Self {
      session_id,
      pid: pid as u32,
      cols,
      rows,
    })
  }

  #[napi]
  pub fn write(&self, data: Buffer) -> Result<()> {
    use std::io::Write;

    let mut manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      // Use the stored writer - no need to take it
      session
        .writer
        .write_all(&data)
        .map_err(|e| Error::from_reason(format!("Write failed: {}", e)))?;

      session
        .writer
        .flush()
        .map_err(|e| Error::from_reason(format!("Flush failed: {}", e)))?;
    } else {
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
        .map_err(|e| Error::from_reason(format!("Resize failed: {}", e)))?;
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
  pub fn kill(&self, signal: Option<String>) -> Result<()> {
    let mut manager = PTY_MANAGER.lock();

    if let Some(session) = manager.sessions.get_mut(&self.session_id) {
      #[cfg(unix)]
      {
        let _ = session; // Prevent unused variable warning
        use nix::sys::signal::{self, Signal};
        use nix::unistd::Pid;

        let signal = match signal.as_deref() {
          Some("SIGTERM") => Signal::SIGTERM,
          Some("SIGKILL") => Signal::SIGKILL,
          Some("SIGINT") => Signal::SIGINT,
          _ => Signal::SIGTERM,
        };

        signal::kill(Pid::from_raw(self.pid as i32), signal)
          .map_err(|e| Error::from_reason(format!("Kill failed: {}", e)))?;
      }

      #[cfg(windows)]
      {
        session
          .child
          .kill()
          .map_err(|e| Error::from_reason(format!("Kill failed: {}", e)))?;
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
        session.output_receiver.recv_timeout(Duration::from_millis(timeout as u64))
      } else {
        // Non-blocking
        match session.output_receiver.try_recv() {
          Ok(data) => Ok(data),
          Err(crossbeam_channel::TryRecvError::Empty) => return Ok(None),
          Err(crossbeam_channel::TryRecvError::Disconnected) => {
            return Err(Error::from_reason("Reader thread disconnected"))
          }
        }
      };

      match result {
        Ok(data) => Ok(Some(Buffer::from(data))),
        Err(crossbeam_channel::RecvTimeoutError::Timeout) => Ok(None),
        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
          Err(Error::from_reason("Reader thread disconnected"))
        }
      }
    } else {
      Err(Error::from_reason("Session not found"))
    }
  }

  // TODO: This polling approach is fundamentally flawed for Node.js performance.
  // The correct solution is to use NAPI ThreadsafeFunction to push data from
  // the reader thread directly to JavaScript callbacks, eliminating polling entirely.
  // This would require:
  // 1. Store a ThreadsafeFunction callback in NativePty
  // 2. Call it from the reader thread when data arrives
  // 3. Remove the polling setInterval from native-addon-adapter.ts
  // Current implementation minimizes blocking but doesn't eliminate the architectural issue.
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
          }
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
          "Failed to check exit status: {}",
          e
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

      // Kill the child process if still running
      if let Err(e) = session.child.kill() {
        // It's okay if the process is already dead
        eprintln!("Failed to kill child process: {}", e);
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
  // No initialization needed for portable-pty
  Ok(())
}

// Activity detection for Claude CLI
#[napi]
pub struct ActivityDetector {
  claude_pattern: regex::Regex,
}

#[napi]
impl ActivityDetector {
  #[napi(constructor)]
  pub fn new() -> Result<Self> {
    Ok(Self {
      claude_pattern: regex::Regex::new(r"✻\s+([^(]+)\s*\(([^)]+)\)")
        .map_err(|e| Error::from_reason(format!("Regex error: {}", e)))?,
    })
  }

  #[napi]
  pub fn detect(&self, data: Buffer) -> Option<Activity> {
    let text = String::from_utf8_lossy(&data);

    if let Some(captures) = self.claude_pattern.captures(&text) {
      let status = captures.get(1)?.as_str().to_string();
      let details = captures.get(2)?.as_str().to_string();

      return Some(Activity {
        timestamp: chrono::Utc::now().timestamp_millis() as f64,
        status,
        details: Some(details),
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

