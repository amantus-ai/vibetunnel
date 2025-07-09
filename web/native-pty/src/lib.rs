#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
  #[allow(dead_code)]
  child: Box<dyn portable_pty::Child + Send>,
  #[allow(dead_code)]
  reader_thread: Option<std::thread::JoinHandle<()>>,
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

    // Store in global manager
    {
      let mut manager = PTY_MANAGER.lock().unwrap();
      manager.sessions.insert(
        session_id.clone(),
        PtySession {
          master: pty_pair.master,
          writer,
          child,
          reader_thread: None,
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

    let mut manager = PTY_MANAGER.lock().unwrap();

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
    let mut manager = PTY_MANAGER.lock().unwrap();

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
    let mut manager = PTY_MANAGER.lock().unwrap();

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
  pub fn read_output(&self, _timeout_ms: Option<u32>) -> Result<Option<Buffer>> {
    let manager = PTY_MANAGER.lock().unwrap();

    if let Some(session) = manager.sessions.get(&self.session_id) {
      let mut reader = session
        .master
        .try_clone_reader()
        .map_err(|e| Error::from_reason(format!("Failed to clone reader: {}", e)))?;

      drop(manager); // Release lock before blocking read

      let mut buffer = vec![0u8; 4096];

      // Simple blocking read for now
      match reader.read(&mut buffer) {
        Ok(0) => Ok(None), // EOF
        Ok(n) => Ok(Some(Buffer::from(&buffer[..n]))),
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
        Err(e) => Err(Error::from_reason(format!("Read failed: {}", e))),
      }
    } else {
      Err(Error::from_reason("Session not found"))
    }
  }

  #[napi]
  pub fn check_exit_status(&self) -> Result<Option<i32>> {
    let mut manager = PTY_MANAGER.lock().unwrap();

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
    let mut manager = PTY_MANAGER.lock().unwrap();

    // Remove session from manager
    if let Some(mut session) = manager.sessions.remove(&self.session_id) {
      // Kill the child process if still running
      if let Err(e) = session.child.kill() {
        // It's okay if the process is already dead
        eprintln!("Failed to kill child process: {}", e);
      }

      // Wait for the child to fully exit
      let _ = session.child.wait();

      // Note: reader_thread will naturally exit when PTY is closed
      // The session will be dropped here, cleaning up all resources
    }

    Ok(())
  }
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

// Module initialization
#[napi]
pub fn init_pty_system() -> Result<()> {
  // Any global initialization
  Ok(())
}
