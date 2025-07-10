use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::io::Write;

use crate::manager::PTY_MANAGER;
use vibetunnel_pty_core::pty::{create_pty, resize_pty};
use vibetunnel_pty_core::{ActivityDetector as CoreActivityDetector, PtyConfig, SessionInfo};

#[napi]
pub struct NativePty {
    session_id: String,
    pid: u32,
    #[allow(dead_code)]
    cols: u16,
    #[allow(dead_code)]
    rows: u16,
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

        let config = PtyConfig {
            shell,
            args: args.unwrap_or_default(),
            env: env.unwrap_or_default(),
            cwd: cwd.map(Into::into),
            cols,
            rows,
        };

        let handle = create_pty(&config)
            .map_err(|e| Error::from_reason(format!("Failed to create PTY: {e}")))?;

        let pid = handle.pid;
        let session_id = uuid::Uuid::new_v4().to_string();

        // Create session info
        let info = SessionInfo {
            id: session_id.clone(),
            name: config.shell.clone().unwrap_or_else(|| "shell".to_string()),
            command: vec![config.shell.unwrap_or_default()],
            pid: Some(pid),
            created_at: chrono::Utc::now(),
            status: "running".to_string(),
            working_dir: config.cwd.map(|p| p.display().to_string()).unwrap_or_default(),
            cols,
            rows,
            exit_code: None,
            title_mode: None,
            is_external_terminal: false,
        };

        // Store in global manager
        {
            let mut manager = PTY_MANAGER.lock().unwrap();
            manager.add_session(session_id.clone(), handle, info);
        }

        Ok(Self { session_id, pid, cols, rows })
    }

    #[napi]
    pub fn write(&self, data: Buffer) -> Result<()> {
        let mut manager = PTY_MANAGER.lock().unwrap();

        if let Some(session) = manager.get_session_mut(&self.session_id) {
            session
                .handle
                .writer
                .write_all(&data)
                .map_err(|e| Error::from_reason(format!("Write failed: {e}")))?;

            session
                .handle
                .writer
                .flush()
                .map_err(|e| Error::from_reason(format!("Flush failed: {e}")))?;
        } else {
            return Err(Error::from_reason("Session not found"));
        }

        Ok(())
    }

    #[napi]
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let mut manager = PTY_MANAGER.lock().unwrap();

        if let Some(session) = manager.get_session_mut(&self.session_id) {
            resize_pty(session.handle.master.as_ref(), cols, rows)
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
    pub fn kill(&self, signal: Option<String>) -> Result<()> {
        let mut manager = PTY_MANAGER.lock().unwrap();

        if let Some(session) = manager.get_session_mut(&self.session_id) {
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
                    .map_err(|e| Error::from_reason(format!("Kill failed: {e}")))?;
            }

            #[cfg(windows)]
            {
                session
                    .handle
                    .child
                    .kill()
                    .map_err(|e| Error::from_reason(format!("Kill failed: {e}")))?;
            }
        }

        Ok(())
    }

    #[napi]
    pub fn read_output(&self, _timeout_ms: Option<u32>) -> Result<Option<Buffer>> {
        use std::io::Read;

        let mut manager = PTY_MANAGER.lock().unwrap();

        if let Some(session) = manager.get_session_mut(&self.session_id) {
            let mut buffer = vec![0u8; 4096];

            // Non-blocking read
            match session.handle.reader.read(&mut buffer) {
                Ok(0) => Ok(None), // EOF
                Ok(n) => Ok(Some(Buffer::from(&buffer[..n]))),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
                Err(e) => Err(Error::from_reason(format!("Read failed: {e}"))),
            }
        } else {
            Err(Error::from_reason("Session not found"))
        }
    }

    #[napi]
    pub fn check_exit_status(&self) -> Result<Option<i32>> {
        let mut manager = PTY_MANAGER.lock().unwrap();

        if let Some(session) = manager.get_session_mut(&self.session_id) {
            // Try to get exit status without blocking
            match session.handle.child.try_wait() {
                Ok(Some(status)) => {
                    // Process has exited
                    let exit_code = status.exit_code() as i32;
                    Ok(Some(exit_code))
                }
                Ok(None) => {
                    // Process is still running
                    Ok(None)
                }
                Err(e) => Err(Error::from_reason(format!("Failed to check exit status: {e}"))),
            }
        } else {
            Err(Error::from_reason("Session not found"))
        }
    }

    #[napi]
    pub fn destroy(&self) -> Result<()> {
        let mut manager = PTY_MANAGER.lock().unwrap();

        // Remove session from manager
        if let Some(mut session) = manager.remove_session(&self.session_id) {
            // Kill the child process if still running
            if let Err(e) = session.handle.child.kill() {
                // It's okay if the process is already dead
                eprintln!("Failed to kill child process: {e}");
            }

            // Wait for the child to fully exit
            let _ = session.handle.child.wait();

            // Resources will be cleaned up when dropped
        }

        Ok(())
    }
}

// Activity detection for Claude CLI
#[napi]
pub struct ActivityDetector {
    detector: CoreActivityDetector,
}

#[napi]
impl ActivityDetector {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        Ok(Self {
            detector: CoreActivityDetector::new()
                .map_err(|e| Error::from_reason(format!("Failed to create detector: {e}")))?,
        })
    }

    #[napi]
    pub fn detect(&self, data: Buffer) -> Option<Activity> {
        self.detector.detect(&data).map(|a| Activity {
            timestamp: a.timestamp,
            status: a.status,
            details: a.details,
        })
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
