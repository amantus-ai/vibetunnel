use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;

/// Configuration for creating a PTY
#[derive(Debug, Clone)]
pub struct PtyConfig {
    pub shell: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: Option<PathBuf>,
    pub cols: u16,
    pub rows: u16,
}

impl Default for PtyConfig {
    fn default() -> Self {
        Self { shell: None, args: Vec::new(), env: HashMap::new(), cwd: None, cols: 80, rows: 24 }
    }
}

/// Handle to a PTY with separated reader/writer
pub struct PtyHandle {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
    pub pid: u32,
}

/// Create a new PTY with the given configuration
pub fn create_pty(config: &PtyConfig) -> Result<PtyHandle> {
    let pty_system = native_pty_system();

    let pty_pair = pty_system
        .openpty(PtySize { rows: config.rows, cols: config.cols, pixel_width: 0, pixel_height: 0 })
        .context("Failed to open PTY")?;

    // Determine shell
    let default_shell = if cfg!(windows) { "cmd.exe" } else { "/bin/bash" };
    let shell = config.shell.as_deref().unwrap_or(default_shell);

    // Build command
    let mut cmd = CommandBuilder::new(shell);
    for arg in &config.args {
        cmd.arg(arg);
    }

    // Set working directory
    if let Some(cwd) = &config.cwd {
        cmd.cwd(cwd);
    }

    // Set environment variables
    for (key, value) in &config.env {
        cmd.env(key, value);
    }

    // Spawn the process
    let child = pty_pair.slave.spawn_command(cmd).context("Failed to spawn command")?;

    let pid = child.process_id().ok_or_else(|| anyhow::anyhow!("Failed to get PID"))?;

    // Take writer and clone reader
    let writer = pty_pair.master.take_writer().context("Failed to take writer")?;

    let reader = pty_pair.master.try_clone_reader().context("Failed to clone reader")?;

    Ok(PtyHandle { master: pty_pair.master, writer, reader, child, pid: pid as u32 })
}

/// Resize the PTY
pub fn resize_pty(master: &dyn MasterPty, cols: u16, rows: u16) -> Result<()> {
    master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .context("Failed to resize PTY")
}
